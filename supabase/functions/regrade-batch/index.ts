// supabase/functions/regrade-batch/index.ts
// 教师批量重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_ids: string[], reason?: string }
//   或 { course_id: string, problem_id: string, reason?: string } (整题一键重判)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient, getPlatformSecret } from "../_shared/secrets.ts";
import { getAuthenticatedUser, isTeacherOrAdmin } from "../_shared/auth.ts";
import { dispatchGitHubWorkflow } from "../_shared/github.ts";

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
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || "教师批量复判").slice(0, 500);

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let targetSubmissionIds: string[] = [];

    if (Array.isArray(body.submission_ids) && body.submission_ids.length > 0) {
      targetSubmissionIds = Array.from(new Set(
        body.submission_ids.filter((x: unknown) => typeof x === "string" && UUID_RE.test(x)),
      ));
      if (targetSubmissionIds.length === 0) {
        return errorResponse("submission_ids 中没有合法的提交记录 ID", 400, "INVALID_SUBMISSION_IDS");
      }
    } else if (body.course_id && body.problem_id) {
      // 整题重判模式
      const isTeacher = await isTeacherOrAdmin(supabase, user.id, body.course_id);
      if (!isTeacher) {
        return errorResponse("权限不足：仅任课教师可发起整题重判", 403, "FORBIDDEN");
      }

      const cleanProblemId = String(body.problem_id).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,32}$/.test(cleanProblemId)) {
        return errorResponse("problem_id 格式不正确", 400, "INVALID_PROBLEM_ID");
      }

      const { data: assignment } = await supabase
        .from("assignments")
        .select("id")
        .eq("course_id", body.course_id)
        .eq("problem_id", cleanProblemId)
        .maybeSingle();

      if (!assignment) {
        return errorResponse("该课程尚未配置该作业", 404, "ASSIGNMENT_NOT_FOUND");
      }

      const { data: subs } = await supabase
        .from("submissions")
        .select("id")
        .eq("assignment_id", assignment.id);

      targetSubmissionIds = (subs || []).map((s: any) => s.id);
    }

    if (targetSubmissionIds.length === 0) {
      return errorResponse("未找到任何待复判的提交记录", 400, "NO_SUBMISSIONS");
    }

    // 限制单次批量调度上限，防止超载
    if (targetSubmissionIds.length > 50) {
      return errorResponse("单次批量复判上限为 50 条，请缩小筛选范围", 400, "BATCH_LIMIT_EXCEEDED");
    }

    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");
    const callbackUrl = `${supabaseUrl}/functions/v1/grade-callback`;
    const ghToken = await getPlatformSecret(supabase, "GITHUB_TOKEN");
    const ghRepo = await getPlatformSecret(supabase, "GITHUB_REPO");

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const subId of targetSubmissionIds) {
      let newGradingId: string | null = null;
      try {
        const { data: submission } = await supabase
          .from("submissions")
          .select("id, assignment_id, assignments!inner(id, course_id, problem_id)")
          .eq("id", subId)
          .maybeSingle();

        if (!submission) {
          results.push({ id: subId, success: false, error: "提交记录不存在" });
          continue;
        }

        const assignment = (submission as any).assignments;
        const courseId = assignment.course_id;
        const problemId = assignment.problem_id;

        // 校验权限
        const hasPerm = await isTeacherOrAdmin(supabase, user.id, courseId);
        if (!hasPerm) {
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
        const { data: newGrading, error: gradingErr } = await supabase
          .from("gradings")
          .insert({ submission_id: subId, status: "queued" })
          .select("id")
          .single();

        if (gradingErr || !newGrading) {
          console.error("[RegradeBatch] 创建评分记录失败:", gradingErr?.message);
          results.push({ id: subId, success: false, error: "创建评分记录失败" });
          continue;
        }
        newGradingId = newGrading.id;

        // 记录审计日志
        const { error: auditErr } = await supabase.from("grade_audits").insert({
          grading_id: newGrading.id,
          submission_id: subId,
          actor_id: user.id,
          old_score: oldScore,
          new_score: null,
          reason,
        });
        if (auditErr) console.error("[RegradeBatch] 写入 grade_audits 失败:", auditErr.message);

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
          await supabase
            .from("grade_audits")
            .update({ new_score: 90 })
            .eq("grading_id", newGrading.id);
        } else {
          try {
            await dispatchGitHubWorkflow(
              subId,
              problemId,
              callbackUrl,
              ghToken ?? "",
              ghRepo ?? "",
            );
          } catch (dispatchErr: any) {
            // 单条调度失败必须把该 grading 标记为 system_error，
            // 否则会留下永远 queued 的“僵尸任务”。
            console.error("[RegradeBatch] dispatch 失败:", dispatchErr?.message);
            await supabase
              .from("gradings")
              .update({
                status: "system_error",
                error_message: "复判评测任务调度失败，请重试",
                finished_at: new Date().toISOString(),
              })
              .eq("id", newGrading.id);
            results.push({ id: subId, success: false, error: "评测任务调度失败" });
            continue;
          }
        }

        results.push({ id: subId, success: true });
      } catch (e: any) {
        if (newGradingId) {
          await supabase
            .from("gradings")
            .update({
              status: "system_error",
              error_message: e?.message || "复判异常",
              finished_at: new Date().toISOString(),
            })
            .eq("id", newGradingId);
        }
        results.push({ id: subId, success: false, error: e?.message || String(e) });
      }
    }

    return jsonResponse({
      ok: true,
      total: targetSubmissionIds.length,
      success_count: results.filter((r) => r.success).length,
      results,
    });
  } catch (err: any) {
    console.error("[RegradeBatch] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
