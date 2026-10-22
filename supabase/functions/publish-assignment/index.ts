// supabase/functions/publish-assignment/index.ts
// 教师发布/调整课程作业 Edge Function
// ────────────────────────────────────────────
// POST { course_id, problem_id, due_at, pass_score, n_instances, score_policy }
// 权限：仅限该课程的教师/助教/管理员

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/secrets.ts";
import { getAuthenticatedUser, isTeacherOrAdmin } from "../_shared/auth.ts";

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
      return errorResponse("请先使用教师账号登录系统", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    // 2. 解析请求体
    const body = await req.json().catch(() => ({}));
    const {
      course_id,
      problem_id,
      due_at,
      pass_score = 90,
      n_instances = 3,
      score_policy = "highest_before_due",
      integrity_policy = "standard",
    } = body;

    if (!course_id || !problem_id) {
      return errorResponse("请求缺少必要的 course_id 或 problem_id", 400, "MISSING_PARAMS");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(course_id))) {
      return errorResponse("course_id 格式不正确", 400, "INVALID_COURSE_ID");
    }
    const cleanProblemId = String(problem_id).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,32}$/.test(cleanProblemId)) {
      return errorResponse("problem_id 只能包含字母、数字、下划线和短横线（1-32 位）", 400, "INVALID_PROBLEM_ID");
    }

    // 3. 校验教师权限
    const hasPerm = await isTeacherOrAdmin(supabase, user.id, course_id);
    if (!hasPerm) {
      return errorResponse("权限不足：仅该课程授课教师可发布或修改作业要求", 403, "FORBIDDEN");
    }

    // 4. 参数严格校验
    const validPolicies = ["highest_before_due", "latest", "highest"];
    if (!validPolicies.includes(score_policy)) {
      return errorResponse(`计分规则无效，必须为 ${validPolicies.join(", ")} 之一`, 400, "INVALID_POLICY");
    }

    if (!["standard", "exam_warn", "exam_block"].includes(integrity_policy)) {
      return errorResponse("考试完整性策略无效", 400, "INVALID_INTEGRITY_POLICY");
    }

    const passScoreNum = parseInt(String(pass_score), 10);
    if (isNaN(passScoreNum) || passScoreNum < 0 || passScoreNum > 100) {
      return errorResponse("及格分数线必须在 0 到 100 之间", 400, "INVALID_PASS_SCORE");
    }

    const nInstancesNum = parseInt(String(n_instances), 10);
    if (isNaN(nInstancesNum) || nInstancesNum < 1 || nInstancesNum > 20) {
      return errorResponse("测试实例数必须在 1 到 20 之间", 400, "INVALID_INSTANCES");
    }

    let parsedDueAt: string | null = null;
    if (due_at) {
      const d = new Date(due_at);
      if (isNaN(d.getTime())) {
        return errorResponse("截止时间格式不正确", 400, "INVALID_DUE_AT");
      }
      parsedDueAt = d.toISOString();
    }

    // 5. 写入 / 更新 assignments 表
    const { data: assignment, error: upsertErr } = await supabase
      .from("assignments")
      .upsert(
        {
          course_id,
          problem_id: cleanProblemId,
          due_at: parsedDueAt,
          pass_score: passScoreNum,
          n_instances: nInstancesNum,
          score_policy,
          integrity_policy,
        },
        { onConflict: "course_id,problem_id" },
      )
      .select()
      .single();

    if (upsertErr) {
      console.error("[PublishAssignment] 保存作业失败:", upsertErr.message);
      if (upsertErr.code === "23503") {
        return errorResponse("课程不存在或已被删除", 404, "COURSE_NOT_FOUND");
      }
      return errorResponse("作业保存失败，请稍后重试", 500, "DB_SAVE_FAILED");
    }

    return jsonResponse({
      ok: true,
      message: `作业 ${cleanProblemId} 配置发布成功`,
      assignment,
    });
  } catch (err: any) {
    console.error("[PublishAssignment] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
