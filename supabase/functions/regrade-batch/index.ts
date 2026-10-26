// supabase/functions/regrade-batch/index.ts
// 教师批量重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_ids: string[], reason?: string }
//   或 { course_id: string, problem_id: string, reason?: string } (整题一键重判)


import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser, isTeacherOrAdmin } from "../_shared/auth.ts";
import { gradingRevision, batchRequestKey, UUID_RE } from "../_shared/grading.ts";

Deno.serve(async (req: Request): Promise<Response> => {
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

    const requestKey = body.request_key || crypto.randomUUID();
    if (!UUID_RE.test(requestKey)) return errorResponse("请求编号无效",400,"INVALID_REQUEST_KEY");
    let revision: string | null = null;
    try { revision = await gradingRevision(supabase); }
    catch { /* Existing per-item receipts can still be replayed. */ }
    // Each item is a complete transaction with its own audit and outbox.
    // Scheduled consumers drain batches, avoiding Edge execution time limits.
    const results: Array<{ id: string; success: boolean; grading_id?: string; error?: string }> = [];
    for (const id of targetSubmissionIds) {
      const { data, error } = await supabase.rpc("enqueue_grading", {
        p_user_id: user.id, p_assignment_id: null, p_submission_id: id,
        p_code_text: null, p_request_key: await batchRequestKey(requestKey,id),
        p_grader_ref: revision, p_metadata: {}, p_reason: reason,
      });
      results.push(error ? { id, success:false, error:"复判保存失败或无权访问，请核对后重试" }
        : { id, success:true, grading_id:data.grading_id });
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
