// supabase/functions/_shared/cors.ts
// 统一 CORS 响应与 JSON 返回工具

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-grade-signature",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

/** 处理 CORS 预检请求（OPTIONS） */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    // 204 + 空 body：部分浏览器/代理对 200 "ok" 的预检响应兼容性较差
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

/** 统一成功 JSON 响应 */
export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** 统一错误 JSON 响应 { ok: false, error: string, code?: string } */
export function errorResponse(
  message: string,
  status = 400,
  code?: string,
): Response {
  const payload: Record<string, unknown> = {
    ok: false,
    error: message,
  };
  if (code) payload.code = code;
  return jsonResponse(payload, status);
}
