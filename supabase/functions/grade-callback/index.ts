// supabase/functions/grade-callback/index.ts
// 判分回调 Edge Function
// ────────────────────────────────────────────
// POST from GitHub Actions runner
// 安全：通过 HMAC-SHA256 签名验证请求来源
// 更新 gradings 表的评分结果


import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient, getPlatformSecret } from "../_shared/secrets.ts";

/**
 * 使用 Web Crypto API 验证 HMAC-SHA256 签名
 */
async function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const cleanSig = signature.trim().toLowerCase();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  );

  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();

  // 常量时间比对，防止时序攻击
  if (computedHex.length !== cleanSig.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ cleanSig.charCodeAt(i);
  }
  return mismatch === 0;
}

interface GradeCallbackBody {
  submission_id: string;
  grading_id: string;
  runner_ref: string;
  score: number | null;
  passed: boolean;
  report: Record<string, unknown> | null;
  status: "done" | "system_error";
  error_message?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS 处理（支持 OPTIONS 探测）
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("仅支持 POST 请求", 405);
  }

  try {
    const { supabase } = createServiceClient();

    const callbackSecret = await getPlatformSecret(supabase, "GRADE_CALLBACK_SECRET");
    if (!callbackSecret) {
      console.error("[GradeCallback] 致命：GRADE_CALLBACK_SECRET 密钥未配置");
      return errorResponse("服务器密钥配置缺失", 500, "SECRET_MISSING");
    }

    // 2. 验证 HMAC 签名
    const signature = req.headers.get("X-Grade-Signature");
    if (!signature) {
      return errorResponse("缺少请求签名头 X-Grade-Signature", 403, "MISSING_SIGNATURE");
    }

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength>2_000_000) return errorResponse("报告过大",413,"REPORT_TOO_LARGE");
    const isValid = await verifyHmacSignature(rawBody, signature, callbackSecret);
    if (!isValid) {
      console.warn("[GradeCallback] 签名验证不通过，可能被篡改或密钥不一致");
      return errorResponse("签名校验失败，拒绝处理", 403, "INVALID_SIGNATURE");
    }

    // 3. 解析请求体
    let body: GradeCallbackBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("请求体不是有效 JSON", 400, "INVALID_JSON");
    }

    const { submission_id, grading_id, runner_ref, score, passed, report, status, error_message } = body;
    if (!submission_id || !status) {
      return errorResponse("缺少必要参数 submission_id 或 status", 400, "INVALID_PARAMS");
    }
    if (typeof submission_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submission_id)) {
      return errorResponse("submission_id 格式不正确", 400, "INVALID_SUBMISSION_ID");
    }

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof grading_id !== "string" || !uuidRe.test(grading_id)) {
      return errorResponse("grading_id 格式不正确", 400, "INVALID_GRADING_ID");
    }
    if (typeof runner_ref !== "string" || !/^run_[0-9]+(?:_[0-9]+)?$/.test(runner_ref)) {
      return errorResponse("runner_ref 格式不正确", 400, "INVALID_RUNNER_REF");
    }

    if (status !== "done" && status !== "system_error") {
      return errorResponse("status 必须为 'done' 或 'system_error'", 400, "INVALID_STATUS");
    }

    // done 必须有合法分数：绝不允许把“已完成但无分数”写进成绩表
    if (status === "done") {
      if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
        return errorResponse("status=done 时 score 必须是 0-100 的数字", 400, "INVALID_SCORE");
      }
      if (typeof passed !== "boolean") {
        return errorResponse("status=done 时 passed 必须是布尔值", 400, "INVALID_PASSED");
      }
    }

    // The database applies attempt ownership, terminal idempotency, the
    // frozen pass threshold and teacher audit completion in one transaction.
    const { data, error } = await supabase.rpc("complete_grading", {
      p_grading_id: grading_id, p_submission_id: submission_id, p_runner_ref: runner_ref,
      p_status: status, p_score: score, p_passed: passed,
      p_report: report, p_error: error_message || null,
    });
    if (error) {
      const code = ["GRADING_NOT_FOUND","RUNNER_MISMATCH","CALLBACK_CONFLICT","INVALID_SCORE"]
        .find(c=>error.message.includes(c));
      return errorResponse("评测回调未被接受", code === "GRADING_NOT_FOUND" ? 404 : code ? 409 : 503,
        code || "GRADING_UNAVAILABLE");
    }
    return jsonResponse(data);
  } catch (err: any) {
    console.error("[GradeCallback] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
