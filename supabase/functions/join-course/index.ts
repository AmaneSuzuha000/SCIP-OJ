// supabase/functions/join-course/index.ts
// 学生输入课程邀请码选课 Edge Function
// ────────────────────────────────────────────
// POST { invite_code: string }
// 认证：Authorization header 中的 Supabase JWT

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";

serve(async (req: Request): Promise<Response> => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("仅支持 POST 请求", 405);
  }

  try {
    const { supabase } = createServiceClient();

    // 1. 身份认证
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth) {
      return errorResponse("请先使用 GitHub 账号登录系统后再进行选课", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    // 2. 解析请求体
    const body = await req.json().catch(() => ({}));
    const rawCode = body.invite_code;
    if (!rawCode || typeof rawCode !== "string" || !rawCode.trim()) {
      return errorResponse("请输入有效的课程邀请码", 400, "INVALID_INVITE_CODE");
    }

    const code = rawCode.trim();

    // 3. 优先匹配 course_invites 表
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
        return errorResponse("该课程邀请码已过期", 400, "INVITE_EXPIRED");
      }
      // 检查上限
      if (inviteData.max_uses != null && inviteData.uses_count >= inviteData.max_uses) {
        return errorResponse("该课程邀请码已达到使用人数上限", 400, "INVITE_USAGE_EXCEEDED");
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
      // 4. 回退匹配 courses.invite_code 或 courses.code
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
      return errorResponse("邀请码无效，未找到对应课程，请向任课教师确认", 404, "COURSE_NOT_FOUND");
    }

    // 5. 写入 enrollments（幂等 upsert）
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
      console.error("[JoinCourse] 写入 enrollments 失败:", enrollError.message);
      return errorResponse("加入课程失败: " + enrollError.message, 500, "ENROLL_FAILED");
    }

    // 6. 递增邀请码使用计数
    if (inviteId) {
      await supabase
        .from("course_invites")
        .update({ uses_count: (inviteData?.uses_count || 0) + 1 })
        .eq("id", inviteId);
    }

    // 7. 若学生已绑定学号，自动将预设花名册对齐为 matched
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
        .ilike("student_no", profile.student_no.trim());
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
    console.error("[JoinCourse] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
