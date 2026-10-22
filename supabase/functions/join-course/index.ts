// Atomic course enrollment gateway.
// Authentication is checked by service role but the actual join is executed
// with the student's JWT, so auth.uid() is derived from the verified user.
// Business logic, revocation and seat counts all live in one PostgreSQL RPC.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";

const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("仅支持 POST 请求",405);
  try {
    const { supabase, supabaseUrl } = createServiceClient();
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth) return errorResponse("请先登录",401,"UNAUTHORIZED");
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.invite_code === "string" ? body.invite_code.trim() : "";
    if (!CODE_RE.test(code)) return errorResponse("邀请码格式不正确",400,"INVALID_CODE");

    // Fail closed if the environment doesn't provide a public API key.
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) {
      console.error("[JoinCourse] Missing SUPABASE_ANON_KEY");
      return errorResponse("选课服务配置缺失",503,"SERVICE_UNAVAILABLE");
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${auth.jwt}` } },
    });
    const { data, error } = await userClient.rpc("join_course_by_code",{p_code:code});
    if (error) {
      console.error("[JoinCourse] Atomic enrollment RPC error:", error.code || "unknown");
      return errorResponse("选课服务暂时不可用",503,"JOIN_RPC_FAILED");
    }
    if (!data?.ok) {
      const reason = String(data?.code || "INVALID_INVITE");
      const status = reason === "UNAUTHORIZED" ? 401 : reason === "INVITE_FULL" ? 409 : 400;
      return errorResponse(String(data?.error || "邀请码无效"), status, reason);
    }
    return jsonResponse(data);
  } catch (err: any) {
    console.error("[JoinCourse] unhandled:", err?.message || err);
    return errorResponse("选课服务内部异常",500,"INTERNAL_ERROR");
  }
});
