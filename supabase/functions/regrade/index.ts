// supabase/functions/regrade/index.ts
// 教师单条重新评分 Edge Function
// ────────────────────────────────────────────
// POST { submission_id, reason }
// 权限：仅限该课程的教师/助教/管理员
// 流程：创建新 grading 行 → 写入 grade_audits → 触发 GitHub Actions


import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser, isTeacherOrAdmin } from "../_shared/auth.ts";
import { dispatchQueued, gradingRevision, gradingError, UUID_RE } from "../_shared/grading.ts";

interface RegradeBody {
  submission_id: string;
  reason?: string;
  request_key?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("仅支持 POST 请求", 405);
  }

  try {
    const { supabase, supabaseUrl } = createServiceClient();

    // 1. 身份认证
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth) {
      return errorResponse("请先使用教师或助教账号登录系统", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    // 2. 解析请求体
    let body: RegradeBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("请求体必须为合法 JSON 格式", 400, "INVALID_JSON");
    }

    const { submission_id, reason = "教师手动复判" } = body;
    if (!submission_id || typeof submission_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submission_id)) {
      return errorResponse("缺少有效的 submission_id", 400, "MISSING_SUBMISSION_ID");
    }

    // 3. 查询提交记录与所属课程/作业
    const { data: submission, error: subError } = await supabase
      .from("submissions")
      .select(`
        id,
        assignment_id,
        assignments!inner (
          id,
          course_id,
          problem_id
        )
      `)
      .eq("id", submission_id)
      .maybeSingle();

    if (subError || !submission) {
      return errorResponse("未找到指定的提交记录", 404, "SUBMISSION_NOT_FOUND");
    }

    const assignment = (submission as any).assignments;
    const courseId = assignment.course_id;
    const problemId = assignment.problem_id;

    // 4. 校验教师权限
    const isTeacher = await isTeacherOrAdmin(supabase, user.id, courseId);
    if (!isTeacher) {
      return errorResponse("权限不足：仅该课程的任课教师或助教可发起复判", 403, "TEACHER_ROLE_REQUIRED");
    }

    const requestKey = body.request_key || crypto.randomUUID();
    if (!UUID_RE.test(requestKey)) return errorResponse("请求编号无效",400,"INVALID_REQUEST_KEY");
    let revision: string | null = null;
    try { revision = await gradingRevision(supabase); }
    catch { /* A replay returns the committed receipt even during a GitHub outage. */ }
    const { data: accepted, error } = await supabase.rpc("enqueue_grading", {
      p_user_id: user.id, p_assignment_id: null, p_submission_id: submission_id,
      p_code_text: null, p_request_key: requestKey, p_grader_ref: revision,
      p_metadata: {}, p_reason: String(reason).slice(0,500),
    });
    if (error) return gradingError(error);
    await dispatchQueued(supabase, supabaseUrl, accepted.grading_id);
    return jsonResponse({ ...accepted, message: "复判已保存，系统将自动调度评测" });
  } catch (err: any) {
    console.error("[Regrade] request failed");
    return errorResponse("复判请求未被确认，请重试",503,"GRADING_UNAVAILABLE");
  }
});
