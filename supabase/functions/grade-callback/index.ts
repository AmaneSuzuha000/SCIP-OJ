// supabase/functions/grade-callback/index.ts
// 判分回调 Edge Function
// ────────────────────────────────────────────
// POST from GitHub Actions runner
// 安全：通过 HMAC-SHA256 签名验证请求来源
// 更新 gradings 表的评分结果

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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
  score: number | null;
  passed: boolean;
  report: Record<string, unknown> | null;
  status: "done" | "system_error";
  error_message?: string;
}

serve(async (req: Request): Promise<Response> => {
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

    const { submission_id, score, passed, report, status, error_message } = body;
    if (!submission_id || !status) {
      return errorResponse("缺少必要参数 submission_id 或 status", 400, "INVALID_PARAMS");
    }

    if (status !== "done" && status !== "system_error") {
      return errorResponse("status 必须为 'done' 或 'system_error'", 400, "INVALID_STATUS");
    }

    // 4. 构建入库更新
    const updateData: Record<string, unknown> = {
      status,
      finished_at: new Date().toISOString(),
    };

    if (status === "done") {
      updateData.score = score;
      updateData.passed = !!passed;
      updateData.report_json = report || null;
      updateData.error_message = null;
    } else {
      // 核心硬边界：系统故障 != 学生 0 分，score 必须置为 null
      updateData.score = null;
      updateData.passed = false;
      updateData.error_message = error_message || "评测环境系统故障";
      if (report) updateData.report_json = report;
    }

    // 5. 更新待评分行（幂等处理：优先更新 queued/running）
    const { data: updated, error: updateError } = await supabase
      .from("gradings")
      .update(updateData)
      .eq("submission_id", submission_id)
      .in("status", ["queued", "running"])
      .select("id");

    if (updateError) {
      console.error("[GradeCallback] 更新 grading 记录失败:", updateError.message);
      return errorResponse("更新评测结果失败", 500, "DB_UPDATE_FAILED");
    }

    if (!updated || updated.length === 0) {
      // 若未找到处于 queued/running 的记录，可能是重复回调或已被人工复判
      console.info(`[GradeCallback] 提交 ${submission_id} 未找到等待中的评分记录，幂等返回`);
      return jsonResponse({ ok: true, duplicate: true });
    }

    return jsonResponse({ ok: true, grading_id: updated[0].id });
  } catch (err: any) {
    console.error("[GradeCallback] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
