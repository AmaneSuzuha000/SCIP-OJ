// supabase/functions/join-course/index.ts
// 学生输入课程邀请码选课 Edge Function
// ────────────────────────────────────────────
// POST { invite_code: string }
// 认证：Authorization header 中的 Supabase JWT

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";

/** 邀请码只允许安全字符，避免 PostgREST 过滤器注入（逗号/括号/%/_ 等） */
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{2,64}$/;

/** 转义 LIKE 模式中的通配符 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

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
    if (!INVITE_CODE_RE.test(code)) {
      return errorResponse("邀请码格式不正确（仅支持字母、数字、下划线与短横线）", 400, "INVALID_INVITE_CODE");
    }

    // 3. 优先匹配 course_invites 表
    let courseId: string | null = null;
    let courseName: string | null = null;
    let courseCode: string | null = null;
    let inviteRole = "student";
    let inviteId: string | null = null;
    let inviteUsesCount = 0;

    const { data: inviteRows, error: inviteErr } = await supabase
      .from("course_invites")
      .select("id, course_id, code, role, expires_at, max_uses, uses_count, courses(id, name, code)")
      .ilike("code", code)
      .limit(1);

    if (inviteErr) {
      console.error("[JoinCourse] 查询 course_invites 失败:", inviteErr.message);
    }

    const inviteData = (inviteRows && inviteRows[0]) || null;

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
      inviteRole = inviteData.role === "ta" ? "ta" : "student";
      inviteUsesCount = Number(inviteData.uses_count || 0);
      const c = inviteData.courses as any;
      if (c) {
        courseName = c.name;
        courseCode = c.code;
      }
    } else {
      // 4. 回退匹配 courses.invite_code（不再把公开的 courses.code 当作邀请码，
      //    否则任何能看到课程代码的登录用户都能绕过邀请码直接加入课程）
      const { data: courseRows, error: courseErr } = await supabase
        .from("courses")
        .select("id, name, code, invite_code")
        .ilike("invite_code", code)
        .limit(1);

      if (courseErr) {
        console.error("[JoinCourse] 查询 courses 失败:", courseErr.message);
      }
      const courseData = (courseRows && courseRows[0]) || null;
      if (courseData) {
        courseId = courseData.id;
        courseName = courseData.name;
        courseCode = courseData.code;
      }
    }

    if (!courseId) {
      return errorResponse("邀请码无效，未找到对应课程，请向任课教师确认", 404, "COURSE_NOT_FOUND");
    }

    // 5. 写入 enrollments（幂等；已选课不改变原有角色）
    const { data: existing, error: existingErr } = await supabase
      .from("enrollments")
      .select("id, role")
      .eq("course_id", courseId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingErr) {
      console.error("[JoinCourse] 查询 enrollments 失败:", existingErr.message);
      return errorResponse("选课服务暂时不可用，请稍后重试", 500, "ENROLL_LOOKUP_FAILED");
    }

    let effectiveRole = existing?.role || inviteRole;
    let newlyEnrolled = false;

    if (!existing) {
      const { error: enrollError } = await supabase
        .from("enrollments")
        .insert({
          course_id: courseId,
          user_id: user.id,
          role: inviteRole,
        });

      if (enrollError) {
        console.error("[JoinCourse] 写入 enrollments 失败:", enrollError.message);
        return errorResponse("加入课程失败，请稍后重试或联系任课教师", 500, "ENROLL_FAILED");
      }
      newlyEnrolled = true;
      effectiveRole = inviteRole;
    }

    // 6. 仅在新选课时递增邀请码使用计数（避免重复点击/重复加入把次数刷满）
    if (inviteId && newlyEnrolled) {
      const { error: countErr } = await supabase
        .from("course_invites")
        .update({ uses_count: inviteUsesCount + 1 })
        .eq("id", inviteId);
      if (countErr) {
        console.error("[JoinCourse] 更新邀请码使用次数失败:", countErr.message);
      }
    }

    // 7. 若学生已绑定学号，自动将预设花名册对齐为 matched
    const { data: profile } = await supabase
      .from("profiles")
      .select("student_no")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.student_no) {
      const { error: rosterErr } = await supabase
        .from("roster_pending")
        .update({ status: "matched", matched_user_id: user.id })
        .eq("course_id", courseId)
        .ilike("student_no", escapeLike(profile.student_no.trim()));
      if (rosterErr) {
        console.error("[JoinCourse] 花名册自动对齐失败:", rosterErr.message);
      }
    }

    return jsonResponse({
      ok: true,
      already_enrolled: !newlyEnrolled,
      message: newlyEnrolled
        ? `成功加入课程：${courseCode || ""} ${courseName || ""}`
        : `您已在该课程中：${courseCode || ""} ${courseName || ""}`,
      course_id: courseId,
      course_name: courseName,
      course_code: courseCode,
      role: effectiveRole,
    });
  } catch (err: any) {
    console.error("[JoinCourse] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
