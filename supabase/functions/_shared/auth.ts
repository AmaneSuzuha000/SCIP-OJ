// supabase/functions/_shared/auth.ts
// 统一身份认证与角色鉴权助手

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  user: any;
  jwt: string;
}

/**
 * 校验并提取当前请求的 Supabase 认证用户
 */
export async function getAuthenticatedUser(
  req: Request,
  supabase: ReturnType<typeof createClient>,
): Promise<AuthResult | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(jwt);

  if (error || !user) {
    return null;
  }

  return { user, jwt };
}

/**
 * 校验用户是否为某课程的任课教师、助教或管理员
 */
export async function isTeacherOrAdmin(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  courseId: string,
): Promise<boolean> {
  try {
    // 1. 查询全局角色
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    if (profile?.role === "teacher" || profile?.role === "admin") {
      return true;
    }

    // 2. 查询课程角色
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("role")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .maybeSingle();

    if (
      enrollment &&
      (enrollment.role === "teacher" ||
        enrollment.role === "admin" ||
        enrollment.role === "ta")
    ) {
      return true;
    }
  } catch (err) {
    console.warn("[Auth] 检查教师权限异常:", err);
  }

  return false;
}
