// supabase/functions/grade-callback/index.ts
// 判分回调 Edge Function
// ────────────────────────────────────────────
// POST from GitHub Actions runner
// 安全：通过 HMAC-SHA256 签名验证请求来源
// 更新 gradings 表的评分结果

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

/**
 * 使用 Web Crypto API 验证 HMAC-SHA256 签名（Deno 兼容）
 * @param body   原始请求体（字符串）
 * @param signature 请求头中的 hex 签名
 * @param secret  共享密钥
 */
async function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  // 导入密钥
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // 计算 HMAC
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  );

  // 将计算结果转为 hex 字符串
  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // 常量时间比较，防止 timing attack
  if (computedHex.length !== signature.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── 回调请求体类型 ──
interface GradeCallbackBody {
  submission_id: string;
  score: number | null;
  passed: boolean;
  report: Record<string, unknown> | null;
  status: "done" | "system_error";
  error_message?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "仅支持 POST 请求" }, 405);
  }

  try {
    // ── 1. 构建 service client（用于读取 platform_secrets） ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const callbackSecret = await getPlatformSecret(supabase, "GRADE_CALLBACK_SECRET");
    if (!callbackSecret) {
      console.error("GRADE_CALLBACK_SECRET 未配置");
      return jsonResponse({ error: "服务器配置错误" }, 500);
    }

    // ── 2. 验证 HMAC 签名 ──
    const signature = req.headers.get("X-Grade-Signature");
    if (!signature) {
      return jsonResponse({ error: "缺少签名头 X-Grade-Signature" }, 403);
    }

    // 必须先读取原始文本用于签名验证，再解析 JSON
    const rawBody = await req.text();

    const isValid = await verifyHmacSignature(rawBody, signature, callbackSecret);
    if (!isValid) {
      console.warn("HMAC 签名验证失败");
      return jsonResponse({ error: "签名验证失败" }, 403);
    }

    // ── 3. 解析请求体 ──
    const body: GradeCallbackBody = JSON.parse(rawBody);
    const { submission_id, score, passed, report, status, error_message } = body;

    if (!submission_id || !status) {
      return jsonResponse(
        { error: "请求体缺少 submission_id 或 status" },
        400,
      );
    }

    // 校验 status 取值
    if (status !== "done" && status !== "system_error") {
      return jsonResponse(
        { error: "status 取值必须为 done 或 system_error" },
        400,
      );
    }

    // ── 4. 构建更新数据 ──

    // 根据 status 构造不同的更新内容
    // 系统错误时不设置 score 为 0，保留为 null
    const updateData: Record<string, unknown> = {
      status,
      finished_at: new Date().toISOString(),
    };

    if (status === "done") {
      // 正常完成：写入分数和报告
      updateData.score = score;
      updateData.passed = passed;
      updateData.report_json = report;
    } else {
      // system_error：仅设置错误信息，score 必须为 null（系统错误 ≠ 学生 0 分）
      updateData.score = null;
      updateData.passed = false;
      updateData.error_message = error_message || "未知系统错误";
      if (report) {
        updateData.report_json = report;
      }
    }

    // ── 5. 更新 gradings 行（匹配 submission_id + queued/running 状态） ──
    const { error: updateError, count } = await supabase
      .from("gradings")
      .update(updateData)
      .eq("submission_id", submission_id)
      .in("status", ["queued", "running"])
      .select("id", { count: "exact" });

    if (updateError) {
      console.error("更新 grading 失败:", updateError);
      return jsonResponse({ error: "评分更新失败" }, 500);
    }

    if (count === 0) {
      console.warn(
        `未找到 submission_id=${submission_id} 对应的待评分记录（queued/running）`,
      );
      // 仍返回 200，因为签名验证已通过，可能是重复回调
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("grade-callback 未捕获错误:", err);
    return jsonResponse({ error: "服务器内部错误" }, 500);
  }
});
