// supabase/functions/join-course/index.ts
// 学生输入课程邀请码选课 Edge Function
// ────────────────────────────────────────────
// POST { invite_code: string }
// 认证：Authorization header 中的 Supabase JWT
// 流程：解析用户 -> 校验邀请码 -> 写入 enrollments -> 关联花名册 -> 返回课程信息

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "仅支持 POST 请求" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "缺少 Authorization 头，请先登录" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return jsonResponse({ error: "身份认证失败或登录已过期" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const rawCode = body.invite_code;
    if (!rawCode || typeof rawCode !== "string" || !rawCode.trim()) {
      return jsonResponse({ error: "请输入有效的课程邀请码" }, 400);
    }

    const code = rawCode.trim();

    // 1. 查询 course_invites 表
    let courseId: string | null = null;
    let courseName: string | null = null;
    let courseCode: string | null = null;
    let inviteRole = "student";
    let inviteId: string | null = null;

    const { data: inviteData } = await supabase
      .from("course_invites")
      .select("id, course_id, code, role, expires_at, max_uses, uses_count, courses(id, name, code)")
      .ilike("code", code)
      .maybeSingle();

    if (inviteData) {
      // 检查有效期
      if (inviteData.expires_at && new Date() > new Date(inviteData.expires_at)) {
        return jsonResponse({ error: "该课程邀请码已过期" }, 400);
      }
      // 检查上限
      if (inviteData.max_uses != null && inviteData.uses_count >= inviteData.max_uses) {
        return jsonResponse({ error: "该课程邀请码已达到使用人数上限" }, 400);
      }
      inviteId = inviteData.id;
      courseId = inviteData.course_id;
      inviteRole = inviteData.role || "student";
      const c = inviteData.courses as any;
      if (c) {
        courseName = c.name;
        courseCode = c.code;
      }
    } else {
      // 2. 回退匹配 courses.invite_code 或 courses.code
      const { data: courseData } = await supabase
        .from("courses")
        .select("id, name, code, invite_code")
        .or(`code.ilike.${code},invite_code.ilike.${code}`)
        .maybeSingle();

      if (courseData) {
        courseId = courseData.id;
        courseName = courseData.name;
        courseCode = courseData.code;
      }
    }

    if (!courseId) {
      return jsonResponse({ error: "未找到匹配的课程，请核对邀请码" }, 404);
    }

    // 3. 写入 enrollments
    const { error: enrollError } = await supabase
      .from("enrollments")
      .upsert(
        {
          course_id: courseId,
          user_id: user.id,
          role: inviteRole,
        },
        { onConflict: "course_id,user_id" },
      );

    if (enrollError) {
      console.error("写入 enrollments 失败:", enrollError);
      return jsonResponse({ error: "加入课程失败: " + enrollError.message }, 500);
    }

    // 4. 更新邀请码使用计数
    if (inviteId) {
      await supabase
        .from("course_invites")
        .update({ uses_count: (inviteData?.uses_count || 0) + 1 })
        .eq("id", inviteId);
    }

    // 5. 自动匹配预设花名册（若学生已有学号）
    const { data: profile } = await supabase
      .from("profiles")
      .select("student_no")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.student_no) {
      await supabase
        .from("roster_pending")
        .update({ status: "matched", matched_user_id: user.id })
        .eq("course_id", courseId)
        .ilike("student_no", profile.student_no);
    }

    return jsonResponse({
      ok: true,
      message: `成功加入课程：${courseCode || ""} ${courseName || ""}`,
      course_id: courseId,
      course_name: courseName,
      course_code: courseCode,
      role: inviteRole,
    });
  } catch (err: any) {
    console.error("join-course 异常:", err);
    return jsonResponse({ error: "选课服务处理异常: " + (err.message || String(err)) }, 500);
  }
});
