// supabase/functions/regrade/index.ts
// 教师重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_id, reason }
// 权限：仅限 teacher 角色（需是该课程的教师）
// 流程：创建新 grading 行 → 写入 grade_audit → 触发 GitHub Actions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

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
    const assignment = (submission as any).assignments;
    const courseId = assignment.course_id;
    const problemId = assignment.problem_id;

    // ── 4. 校验当前用户是否为该课程的教师或助教 ──
    const { data: enrollment, error: enrollError } = await supabase
      .from("enrollments")
      .select("role")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .single();

    const isTeacher = enrollment &&
      (enrollment.role === "teacher" || enrollment.role === "ta" || enrollment.role === "admin");

    if (enrollError || !isTeacher) {
      return jsonResponse({ error: "无权限：仅该课程的教师可发起复判" }, 403);
    }

    // ── 5. 查询最近一次评分记录（用于审计日志记录 old_score） ──
    const { data: lastGrading } = await supabase
      .from("gradings")
      .select("id, score")
      .eq("submission_id", submission_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const oldScore = lastGrading?.score ?? null;

    // ── 6. 插入新的 grading 行（状态 queued） ──
    const { data: newGrading, error: insertGradingErr } = await supabase
      .from("gradings")
      .insert({
        submission_id,
        status: "queued",
      })
      .select("id")
      .single();

    if (insertGradingErr || !newGrading) {
      console.error("插入新 grading 失败:", insertGradingErr);
      return jsonResponse({ error: "创建新评分记录失败" }, 500);
    }

    // ── 7. 插入 grade_audits 审计日志 ──
    const { error: insertAuditErr } = await supabase
      .from("grade_audits")
      .insert({
        grading_id: newGrading.id,
        submission_id,
        actor_id: user.id,
        old_score: oldScore,
        new_score: null, // 尚未评出新分
        reason,
      });

    if (insertAuditErr) {
      // 审计日志写入失败仅记录日志，不阻断复判流程
      console.error("写入 grade_audits 失败:", insertAuditErr);
    }

    // ── 8. 触发判分（Mock 模式或 GitHub Actions） ──
    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");

    if (gradeRunner === "mock") {
      // Mock 模式：直接更新为完成状态
      await supabase
        .from("gradings")
        .update({
          status: "done",
          score: 95,
          passed: true,
          report_json: { message: "Mock 复判结果：分数更新为 95" },
          finished_at: new Date().toISOString(),
        })
        .eq("id", newGrading.id);

      // 更新审计日志的新分数
      await supabase
        .from("grade_audits")
        .update({ new_score: 95 })
        .eq("grading_id", newGrading.id);
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
            error_message: "复判任务触发失败，请重试",
            finished_at: new Date().toISOString(),
          })
          .eq("id", newGrading.id);
      }
    }

    // ── 9. 返回成功响应 ──
    return jsonResponse({
      message: "复判已提交，已进入评测队列",
      grading_id: newGrading.id,
      submission_id,
      status: "queued",
    });
  } catch (err) {
    console.error("regrade 未捕获错误:", err);
    return jsonResponse({ error: "服务器内部错误" }, 500);
  }
});
