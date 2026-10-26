// supabase/functions/submit-assignment/index.ts
// 学生提交正式作业 Edge Function
// ────────────────────────────────────────────
// POST { assignment_id, code_text }
// 认证：Authorization header 中的 Supabase JWT


import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { dispatchQueued, gradingRevision, gradingError, UUID_RE } from "../_shared/grading.ts";

interface SubmitBody {
  assignment_id: string;
  code_text: string;
  client_integrity?: unknown;
  request_key?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS 预检
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("仅支持 POST 请求", 405);
  }

  try {
    const { supabase, supabaseUrl } = createServiceClient();

    // 2. 身份认证
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth) {
      return errorResponse("身份认证失败或登录已过期，请重新登录", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    // 3. 解析请求体
    let body: SubmitBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("请求体必须为合法 JSON 格式", 400, "INVALID_JSON");
    }

    const { assignment_id, code_text, client_integrity } = body;
    const requestKey = body.request_key || crypto.randomUUID();
    if (!UUID_RE.test(requestKey)) return errorResponse("请求编号无效",400,"INVALID_REQUEST_KEY");
    if (!assignment_id || typeof assignment_id !== "string") {
      return errorResponse("缺少有效 assignment_id", 400, "MISSING_ASSIGNMENT_ID");
    }
    if (!code_text || typeof code_text !== "string" || !code_text.trim()) {
      return errorResponse("提交代码不能为空", 400, "EMPTY_CODE");
    }
    // 限制单次提交体积，防止超大 payload 拖垮数据库与评测队列
    if (new TextEncoder().encode(code_text).byteLength > 200_000) {
      return errorResponse("提交代码过长（上限 200 KB UTF-8）", 413, "CODE_TOO_LARGE");
    }

    // 4. 查询作业及课程信息
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("*")
      .eq("id", assignment_id)
      .maybeSingle();

    if (assignmentError || !assignment) {
      return errorResponse("指定的作业不存在或已被删除", 404, "ASSIGNMENT_NOT_FOUND");
    }

    // All authority, exam attestation, quota and timestamp checks occur in
    // enqueue_grading, in the same transaction as the accepted submission.
    const submissionMeta: Record<string, unknown> = {};
    // The policy is read from the DB. Client-side paste blocking is bypassable:
    // the following bounded counters are self-reported review leads, NOT proof.
    const configuredPolicy = ["standard", "exam_warn", "exam_block"].includes(assignment.integrity_policy)
      ? assignment.integrity_policy : "standard";
    if (configuredPolicy !== "standard") {
      const raw = client_integrity && typeof client_integrity === "object" && !Array.isArray(client_integrity)
        ? client_integrity as Record<string, unknown> : {};
      const counterFields = [
        "elapsed_seconds", "input_events", "paste_events",
        "blocked_pastes", "copy_events", "drop_events", "hidden_events",
      ];
      const counts: Record<string, number> = {};
      for (const key of counterFields) {
        const value = raw[key];
        counts[key] = typeof value === "number" && Number.isSafeInteger(value)
          ? Math.min(1_000_000, Math.max(0, value)) : 0;
      }
      submissionMeta.integrity = {
        policy: configuredPolicy,
        client_reported: true,
        client_policy_matches: raw.reported_policy === configuredPolicy,
        received_at: new Date().toISOString(),
        counters: counts,
        notice: "浏览器自报；可篡改。禁止仅凭该数据判断作弊。",
      };
    }

    // Authorization above provides friendly errors; the SQL transaction rechecks
    // it and atomically creates source, grading snapshot and dispatch outbox.
    let revision: string | null = null;
    try { revision = await gradingRevision(supabase); }
    catch { /* An already accepted idempotent replay does not need GitHub. */ }
    const { data: accepted, error } = await supabase.rpc("enqueue_grading", {
      p_user_id: user.id, p_assignment_id: assignment_id, p_submission_id: null,
      p_code_text: code_text, p_request_key: requestKey, p_grader_ref: revision,
      p_metadata: submissionMeta, p_reason: null,
    });
    if (error) return gradingError(error);
    await dispatchQueued(supabase, supabaseUrl, accepted.grading_id);
    return jsonResponse({ ...accepted,
      ...(accepted.late ? { warning: "已超过截止时间，本次提交已标记为迟交" } : {}),
    });
  } catch (err: any) {
    console.error("[Submit] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
