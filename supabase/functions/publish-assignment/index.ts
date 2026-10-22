// supabase/functions/publish-assignment/index.ts
// 教师发布/调整课程作业 Edge Function
// ────────────────────────────────────────────
// POST { course_id, problem_id, due_at, pass_score, n_instances, score_policy }
// 权限：仅限该课程的教师/助教/管理员
// 流程：验证教师身份 -> 校验作业配置参数 -> 写入/更新 assignments 表

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
      return jsonResponse({ error: "身份认证失败" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const {
      course_id,
      problem_id,
      due_at,
      pass_score = 90,
      n_instances = 3,
      score_policy = "highest_before_due",
    } = body;

    if (!course_id || !problem_id) {
      return jsonResponse({ error: "请求缺少 course_id 或 problem_id" }, 400);
    }

    // 1. 校验操作人是否为教师
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("role")
      .eq("user_id", user.id)
      .eq("course_id", course_id)
      .single();

    if (!enrollment || (enrollment.role !== "teacher" && enrollment.role !== "admin" && enrollment.role !== "ta")) {
      return jsonResponse({ error: "无权限：仅授课教师可发布或修改课程作业" }, 403);
    }

    // 2. 校验参数
    const validPolicies = ["highest_before_due", "latest", "highest"];
    if (!validPolicies.includes(score_policy)) {
      return jsonResponse({ error: `计分规则无效，必须为 ${validPolicies.join(", ")} 之一` }, 400);
    }

    const passScoreNum = parseInt(pass_score, 10);
    if (isNaN(passScoreNum) || passScoreNum < 0 || passScoreNum > 100) {
      return jsonResponse({ error: "及格分数线必须在 0 到 100 之间" }, 400);
    }

    const nInstancesNum = parseInt(n_instances, 10);
    if (isNaN(nInstancesNum) || nInstancesNum < 1 || nInstancesNum > 20) {
      return jsonResponse({ error: "测试实例数必须在 1 到 20 之间" }, 400);
    }

    let parsedDueAt: string | null = null;
    if (due_at) {
      const d = new Date(due_at);
      if (isNaN(d.getTime())) {
        return jsonResponse({ error: "截止时间格式不正确" }, 400);
      }
      parsedDueAt = d.toISOString();
    }

    // 3. 写入 / 更新 assignments
    const { data: assignment, error: upsertErr } = await supabase
      .from("assignments")
      .upsert(
        {
          course_id,
          problem_id: String(problem_id).trim().toUpperCase(),
          due_at: parsedDueAt,
          pass_score: passScoreNum,
          n_instances: nInstancesNum,
          score_policy,
        },
        { onConflict: "course_id,problem_id" },
      )
      .select()
      .single();

    if (upsertErr) {
      console.error("发布作业失败:", upsertErr);
      return jsonResponse({ error: "作业保存失败: " + upsertErr.message }, 500);
    }

    return jsonResponse({
      ok: true,
      message: `作业 ${problem_id} 发布成功`,
      assignment,
    });
  } catch (err: any) {
    console.error("publish-assignment 未捕获错误:", err);
    return jsonResponse({ error: "服务器内部错误: " + (err.message || String(err)) }, 500);
  }
});
