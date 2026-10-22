// supabase/functions/_shared/cors.ts
// 统一 CORS 响应与 JSON 返回工具

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-grade-signature",
};

/** 处理 CORS 预检请求（OPTIONS） */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
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
