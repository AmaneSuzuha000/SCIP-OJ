// supabase/functions/regrade-batch/index.ts
// 教师批量重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_ids: string[], reason?: string }
//   或 { course_id: string, problem_id: string, reason?: string } (整题重判)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "仅支持 POST 请求" }, 405);
  }

  try {
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

    const body = await req.json().catch(() => ({}));
    const reason = body.reason || "教师批量复判";
    let targetSubmissionIds: string[] = [];

    if (Array.isArray(body.submission_ids) && body.submission_ids.length > 0) {
      targetSubmissionIds = body.submission_ids;
    } else if (body.course_id && body.problem_id) {
      // 整题重判模式：查询该课程该题目的所有学生的最新或全部提交
      const { data: assignments } = await supabase
        .from("assignments")
        .select("id")
        .eq("course_id", body.course_id)
        .eq("problem_id", body.problem_id)
        .maybeSingle();

      if (!assignments) {
        return jsonResponse({ error: "未找到该课程对应的作业" }, 404);
      }

      const { data: subs } = await supabase
        .from("submissions")
        .select("id")
        .eq("assignment_id", assignments.id);

      targetSubmissionIds = (subs || []).map((s: any) => s.id);
    }

    if (targetSubmissionIds.length === 0) {
      return jsonResponse({ error: "未指定待复判的提交记录" }, 400);
    }

    // 限制单次批量上限，防止 runner 超载
    if (targetSubmissionIds.length > 50) {
      return jsonResponse({ error: "单次批量复判上限为 50 条" }, 400);
    }

    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");
    const callbackUrl = `${supabaseUrl}/functions/v1/grade-callback`;
    const ghToken = await getPlatformSecret(supabase, "GITHUB_TOKEN");
    const ghRepo = await getPlatformSecret(supabase, "GITHUB_REPO");

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const subId of targetSubmissionIds) {
      try {
        // 校验权限与作业信息
        const { data: submission } = await supabase
          .from("submissions")
          .select("id, assignment_id, assignments!inner(id, course_id, problem_id)")
          .eq("id", subId)
          .single();

        if (!submission) {
          results.push({ id: subId, success: false, error: "提交记录不存在" });
          continue;
        }

        const assignment = (submission as any).assignments;
        const courseId = assignment.course_id;
        const problemId = assignment.problem_id;

        // 校验操作者是否为教师
        const { data: enrollment } = await supabase
          .from("enrollments")
          .select("role")
          .eq("user_id", user.id)
          .eq("course_id", courseId)
          .single();

        if (!enrollment || (enrollment.role !== "teacher" && enrollment.role !== "admin" && enrollment.role !== "ta")) {
          results.push({ id: subId, success: false, error: "无权限操作该提交" });
          continue;
        }

        // 获取上次分数
        const { data: lastGrading } = await supabase
          .from("gradings")
          .select("id, score")
          .eq("submission_id", subId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const oldScore = lastGrading?.score ?? null;

        // 插入新 grading
        const { data: newGrading } = await supabase
          .from("gradings")
          .insert({ submission_id: subId, status: "queued" })
          .select("id")
          .single();

        if (!newGrading) {
          results.push({ id: subId, success: false, error: "创建评分记录失败" });
          continue;
        }

        // 记录审计
        await supabase.from("grade_audits").insert({
          grading_id: newGrading.id,
          submission_id: subId,
          actor_id: user.id,
          old_score: oldScore,
          new_score: null,
          reason,
        });

        // 调度评测
        if (gradeRunner === "mock") {
          await supabase
            .from("gradings")
            .update({
              status: "done",
              score: 90,
              passed: true,
              report_json: { message: "Mock 批量复判出分" },
              finished_at: new Date().toISOString(),
            })
            .eq("id", newGrading.id);
        } else {
          await dispatchGitHubWorkflow(
            subId,
            problemId,
            callbackUrl,
            ghToken ?? "",
            ghRepo ?? "",
          );
        }

        results.push({ id: subId, success: true });
      } catch (e: any) {
        results.push({ id: subId, success: false, error: e.message || String(e) });
      }
    }

    return jsonResponse({
      ok: true,
      total: targetSubmissionIds.length,
      success_count: results.filter((r) => r.success).length,
      results,
    });
  } catch (err: any) {
    console.error("regrade-batch 未捕获错误:", err);
    return jsonResponse({ error: "服务器内部错误: " + (err.message || String(err)) }, 500);
  }
});
