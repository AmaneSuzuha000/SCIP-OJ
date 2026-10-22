// supabase/functions/regrade/index.ts
// 教师单条重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_id, reason }
// 权限：仅限该课程的教师/助教/管理员
// 流程：创建新 grading 行 → 写入 grade_audits → 触发 GitHub Actions

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient, getPlatformSecret } from "../_shared/secrets.ts";
import { getAuthenticatedUser, isTeacherOrAdmin } from "../_shared/auth.ts";
import { dispatchGitHubWorkflow } from "../_shared/github.ts";

interface RegradeBody {
  submission_id: string;
  reason?: string;
}

serve(async (req: Request): Promise<Response> => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("仅支持 POST 请求", 405);
  }

  try {
    const { supabase, supabaseUrl } = createServiceClient();

    // 1. 身份认证
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth) {
      return errorResponse("请先使用教师或助教账号登录系统", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    // 2. 解析请求体
    let body: RegradeBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("请求体必须为合法 JSON 格式", 400, "INVALID_JSON");
    }

    const { submission_id, reason = "教师手动复判" } = body;
    if (!submission_id || typeof submission_id !== "string") {
      return errorResponse("缺少有效的 submission_id", 400, "MISSING_SUBMISSION_ID");
    }

    // 3. 查询提交记录与所属课程/作业
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
      .maybeSingle();

    if (subError || !submission) {
      return errorResponse("未找到指定的提交记录", 404, "SUBMISSION_NOT_FOUND");
    }

    const assignment = (submission as any).assignments;
    const courseId = assignment.course_id;
    const problemId = assignment.problem_id;

    // 4. 校验教师权限
    const isTeacher = await isTeacherOrAdmin(supabase, user.id, courseId);
    if (!isTeacher) {
      return errorResponse("权限不足：仅该课程的任课教师或助教可发起复判", 403, "TEACHER_ROLE_REQUIRED");
    }

    // 5. 查询最近一次评分记录（用于审计）
    const { data: lastGrading } = await supabase
      .from("gradings")
      .select("id, score")
      .eq("submission_id", submission_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const oldScore = lastGrading?.score ?? null;

    // 6. 创建新的待评测行 (status: queued)
    const { data: newGrading, error: insertGradingErr } = await supabase
      .from("gradings")
      .insert({
        submission_id,
        status: "queued",
      })
      .select("id")
      .single();

    if (insertGradingErr || !newGrading) {
      console.error("[Regrade] 插入新 grading 失败:", insertGradingErr?.message);
      return errorResponse("创建复判记录失败", 500, "DB_INSERT_FAILED");
    }

    // 7. 写入审计日志 grade_audits
    await supabase.from("grade_audits").insert({
      grading_id: newGrading.id,
      submission_id,
      actor_id: user.id,
      old_score: oldScore,
      new_score: null,
      reason: String(reason).slice(0, 500),
    });

    // 8. 调度评测任务
    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");

    if (gradeRunner === "mock") {
      await supabase
        .from("gradings")
        .update({
          status: "done",
          score: 95,
          passed: true,
          report_json: {
            message: "Mock 复判测试出分",
            score: 95,
            passed: true,
            breakdown: { F: 10, C: 35, I: 10, O: 35, R: 5 },
          },
          finished_at: new Date().toISOString(),
        })
        .eq("id", newGrading.id);

      await supabase
        .from("grade_audits")
        .update({ new_score: 95 })
        .eq("grading_id", newGrading.id);
    } else {
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
      } catch (dispatchErr: any) {
        console.error("[Regrade] dispatch 异常:", dispatchErr?.message);
        await supabase
          .from("gradings")
          .update({
            status: "system_error",
            error_message: "复判自动化评测调度异常，请重试",
            finished_at: new Date().toISOString(),
          })
          .eq("id", newGrading.id);

        return errorResponse("自动化评测任务分发失败，请重试", 502, "DISPATCH_FAILED");
      }
    }

    return jsonResponse({
      ok: true,
      message: "复判请求已成功提交至评测队列",
      grading_id: newGrading.id,
      submission_id,
      status: "queued",
    });
  } catch (err: any) {
    console.error("[Regrade] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
