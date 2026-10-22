// supabase/functions/regrade/index.ts
// 教师重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_id, reason }
// 权限：仅限 teacher 角色（需是该课程的教师）
// 流程：创建新 grading 行 → 写入 grade_audit → 触发 GitHub Actions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/** Resolve secret: Deno.env first, then platform_secrets (service_role only). */
async function getPlatformSecret(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  const { data, error } = await supabase
    .from("platform_secrets")
    .select("value")
    .eq("key", name)
    .maybeSingle();
  if (error) {
    console.error(`platform_secrets read failed for ${name}:`, error.message);
    return null;
  }
  return data?.value ?? null;
}

/** 统一 JSON 响应 */
function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 触发 GitHub Actions workflow_dispatch（与 submit-assignment 共用逻辑） */
async function dispatchGitHubWorkflow(
  submissionId: string,
  problemId: string,
  callbackUrl: string,
  token: string,
  repo: string,
): Promise<void> {
  if (!token || !repo) {
    throw new Error("GitHub 配置缺失：GITHUB_TOKEN 或 GITHUB_REPO 未设置");
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/grade-submission.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        submission_id: submissionId,
        problem_id: problemId,
        callback_url: callbackUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Actions 触发失败 (${res.status}): ${errText}`);
  }
}

// ── 请求体类型 ──
interface RegradeBody {
  submission_id: string;
  reason: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "仅支持 POST 请求" }, 405);
  }

  try {
    // ── 1. 提取并验证 JWT ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "缺少 Authorization 头" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return jsonResponse({ error: "身份认证失败" }, 401);
    }

    // ── 2. 解析请求体 ──
    const body: RegradeBody = await req.json();
    const { submission_id, reason } = body;

    if (!submission_id || !reason) {
      return jsonResponse(
        { error: "请求体缺少 submission_id 或 reason" },
        400,
      );
    }

    // ── 3. 查询该提交对应的作业和课程信息 ──
    const { data: submission, error: subError } = await supabase
      .from("submissions")
      .select(`
        id,
        assignment_id,
        assignments!inner (
          id,
          course_id,
          problem_id
        )
      `)
      .eq("id", submission_id)
      .single();

    if (subError || !submission) {
      return jsonResponse({ error: "提交记录不存在" }, 404);
    }

    // 从关联查询中提取作业信息
    // deno-lint-ignore no-explicit-any
    const assignmentData = (submission as any).assignments;
    const courseId: string = assignmentData.course_id;
    const problemId: string = assignmentData.problem_id;

    // ── 4. 校验教师权限：用户必须以 teacher 角色选课 ──
    const { data: teacherEnrollment, error: enrollError } = await supabase
      .from("enrollments")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("role", "teacher")
      .single();

    if (enrollError || !teacherEnrollment) {
      return jsonResponse(
        { error: "权限不足：您不是该课程的教师" },
        403,
      );
    }

    // ── 5. 获取上一次评分记录（用于审计） ──
    const { data: previousGrading } = await supabase
      .from("gradings")
      .select("id, score")
      .eq("submission_id", submission_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const oldScore = previousGrading?.score ?? null;

    // ── 6. 创建新的 grading 行（状态为 queued） ──
    const { data: newGrading, error: gradingInsertErr } = await supabase
      .from("gradings")
      .insert({
        submission_id,
        status: "queued",
      })
      .select("id")
      .single();

    if (gradingInsertErr || !newGrading) {
      console.error("创建重评分记录失败:", gradingInsertErr);
      return jsonResponse({ error: "重评分记录创建失败" }, 500);
    }

    // ── 7. 写入 grade_audit 审计记录 ──
    const { error: auditInsertErr } = await supabase
      .from("grade_audits")
      .insert({
        grading_id: newGrading.id,
        submission_id,
        old_score: oldScore,
        new_score: null, // 重评分尚未完成
        reason,
        actor_id: user.id,
      });

    if (auditInsertErr) {
      console.error("写入审计记录失败:", auditInsertErr);
      // 审计失败不阻断重评分流程，但记录错误
    }

    // ── 8. 触发判分（Mock 模式或 GitHub Actions） ──
    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");

    if (gradeRunner === "mock") {
      // Mock 模式：直接更新为完成状态
      await supabase
        .from("gradings")
        .update({
          status: "done",
          score: 85,
          passed: false,
          report_json: { message: "Mock 重评分结果（非真实评分）" },
          finished_at: new Date().toISOString(),
        })
        .eq("id", newGrading.id);
    } else {
      // 真实模式：触发 GitHub Actions workflow
      const callbackUrl = `${supabaseUrl}/functions/v1/grade-callback`;
      const ghToken = await getPlatformSecret(supabase, "GITHUB_TOKEN");
      const ghRepo = await getPlatformSecret(supabase, "GITHUB_REPO");
      try {
        await dispatchGitHubWorkflow(
          submission_id,
          problemId,
          callbackUrl,
          ghToken ?? "",
          ghRepo ?? "",
        );
      } catch (dispatchErr) {
        console.error("GitHub Actions 触发失败:", dispatchErr);
        await supabase
          .from("gradings")
          .update({
            status: "system_error",
            error_message: "重评分任务触发失败，请稍后重试",
            finished_at: new Date().toISOString(),
          })
          .eq("id", newGrading.id);
      }
    }

    // ── 9. 返回结果 ──
    return jsonResponse({
      grading_id: newGrading.id,
      status: "queued",
    });
  } catch (err) {
    console.error("regrade 未捕获错误:", err);
    return jsonResponse({ error: "服务器内部错误" }, 500);
  }
});
