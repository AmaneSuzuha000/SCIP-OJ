// supabase/functions/submit-assignment/index.ts
// 学生提交正式作业 Edge Function
// ────────────────────────────────────────────
// POST { assignment_id, code_text }
// 认证：Authorization header 中的 Supabase JWT

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient, getPlatformSecret } from "../_shared/secrets.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { dispatchGitHubWorkflow } from "../_shared/github.ts";

/** 计算字符串的 SHA-256 十六进制摘要 */
async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return encodeHex(new Uint8Array(hashBuffer));
}

interface SubmitBody {
  assignment_id: string;
  code_text: string;
  client_integrity?: unknown;
}

serve(async (req: Request): Promise<Response> => {
  // 1. CORS 预检
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("仅支持 POST 请求", 405);
  }

  try {
    const { supabase, supabaseUrl } = createServiceClient();

    // 2. 身份认证
    const auth = await getAuthenticatedUser(req, supabase);
    if (!auth) {
      return errorResponse("身份认证失败或登录已过期，请重新登录", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    // 3. 解析请求体
    let body: SubmitBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("请求体必须为合法 JSON 格式", 400, "INVALID_JSON");
    }

    const { assignment_id, code_text, client_integrity } = body;
    if (!assignment_id || typeof assignment_id !== "string") {
      return errorResponse("缺少有效 assignment_id", 400, "MISSING_ASSIGNMENT_ID");
    }
    if (!code_text || typeof code_text !== "string" || !code_text.trim()) {
      return errorResponse("提交代码不能为空", 400, "EMPTY_CODE");
    }
    // 限制单次提交体积，防止超大 payload 拖垮数据库与评测队列
    if (new TextEncoder().encode(code_text).byteLength > 200_000) {
      return errorResponse("提交代码过长（上限 200 KB UTF-8）", 413, "CODE_TOO_LARGE");
    }

    // 4. 查询作业及课程信息
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("*")
      .eq("id", assignment_id)
      .maybeSingle();

    if (assignmentError || !assignment) {
      return errorResponse("指定的作业不存在或已被删除", 404, "ASSIGNMENT_NOT_FOUND");
    }

    // 5. 校验用户是否已选修该课程
    const { data: enrollment, error: enrollError } = await supabase
      .from("enrollments")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("course_id", assignment.course_id)
      .maybeSingle();

    if (enrollError || !enrollment) {
      return errorResponse("您未选修该课程，请先输入邀请码加入课程", 403, "NOT_ENROLLED");
    }

    // 6. 学号门禁校验（学生身份必须已绑定学号）
    const isTeacher = enrollment.role === "teacher" || enrollment.role === "admin" || enrollment.role === "ta";
    if (!isTeacher) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("student_no, display_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile?.student_no || !profile.student_no.trim()) {
        return errorResponse("请先在个人资料中绑定真实学号与姓名再提交作业", 403, "STUDENT_NO_REQUIRED");
      }
    }

    // 7. 检查截止时间（允许迟交但打上 late 标记）
    const isLate = assignment.due_at ? new Date() > new Date(assignment.due_at) : false;
    const submissionMeta: Record<string, unknown> = {};
    if (isLate) {
      submissionMeta.late = true;
      submissionMeta.submitted_after_due = true;
    }

    // The policy is read from the DB. Client-side paste blocking is bypassable:
    // the following bounded counters are self-reported review leads, NOT proof.
    const configuredPolicy = ["standard", "exam_warn", "exam_block"].includes(assignment.integrity_policy)
      ? assignment.integrity_policy : "standard";
    if (configuredPolicy !== "standard") {
      const raw = client_integrity && typeof client_integrity === "object" && !Array.isArray(client_integrity)
        ? client_integrity as Record<string, unknown> : {};
      const counterFields = [
        "elapsed_seconds", "input_events", "paste_events",
        "blocked_pastes", "copy_events", "drop_events", "hidden_events",
      ];
      const counts: Record<string, number> = {};
      for (const key of counterFields) {
        const value = raw[key];
        counts[key] = typeof value === "number" && Number.isSafeInteger(value)
          ? Math.min(1_000_000, Math.max(0, value)) : 0;
      }
      submissionMeta.integrity = {
        policy: configuredPolicy,
        client_reported: true,
        client_policy_matches: raw.reported_policy === configuredPolicy,
        received_at: new Date().toISOString(),
        counters: counts,
        notice: "浏览器自报；可篡改。禁止仅凭该数据判断作弊。",
      };
    }

    // 8. 计算代码 SHA-256 哈希（仅用于审计/查重）
    const codeHash = await sha256Hex(code_text);

    // 9. 写入 submissions 表
    // 注意：public_code 由数据库触发器生成随机唯一值，绝不能从 code_hash 派生：
    // public_code 有 UNIQUE 约束，相同代码二次提交（或两名学生提交同一模板）会触发
    // 唯一键冲突，导致“提交记录保存失败”的 500 错误。
    const { data: submission, error: insertSubErr } = await supabase
      .from("submissions")
      .insert({
        user_id: user.id,
        assignment_id,
        code_text,
        code_hash: codeHash,
        metadata: submissionMeta,
      })
      .select("id, public_code, attempt_no")
      .single();

    if (insertSubErr || !submission) {
      // The PostgreSQL trigger is the authoritative, transaction-safe
      // quota gate, including requests that bypass UI cooldowns.
      const rejection = String(insertSubErr?.message || "");
      const quotaReason = [
        "SUBMISSION_RATE_LIMIT_COOLDOWN",
        "SUBMISSION_RATE_LIMIT_HOURLY",
        "SUBMISSION_RATE_LIMIT_DAILY",
      ].find(reason => rejection.includes(reason));
      if (quotaReason) {
        const message = quotaReason.endsWith("COOLDOWN")
          ? "两次正式提交需至少间隔 20 秒，请检查代码后再提交"
          : quotaReason.endsWith("HOURLY")
          ? "本作业一小时内正式提交已达到 12 次，请稍后重试"
          : "今日正式提交已达到 60 次，请明天再试";
        return errorResponse(message, 429, quotaReason);
      }
      console.error("[Submit] 插入 submission 失败:", insertSubErr?.code || "unknown");
      return errorResponse("提交记录保存失败，请稍后重试", 500, "DB_INSERT_FAILED");
    }

    // 10. 写入 gradings 初始状态 (queued)
    const { data: grading, error: insertGradingErr } = await supabase
      .from("gradings")
      .insert({
        submission_id: submission.id,
        status: "queued",
      })
      .select("id")
      .single();

    if (insertGradingErr || !grading) {
      console.error("[Submit] 插入 grading 失败:", insertGradingErr?.message);
      // 回滚孤立的 submission，避免产生永远没有评分记录的“幽灵提交”
      await supabase.from("submissions").delete().eq("id", submission.id);
      return errorResponse("评分记录初始化失败，请稍后重试", 500, "DB_GRADING_INIT_FAILED");
    }

    // 11. 触发判分调度（Mock 模式或 GitHub Actions）
    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");

    if (gradeRunner === "mock") {
      // Mock 模式：快速出分测试
      await supabase
        .from("gradings")
        .update({
          status: "done",
          score: 90,
          passed: true,
          report_json: {
            message: "Mock 模式本地测试出分",
            score: 90,
            passed: true,
            breakdown: { F: 10, C: 35, I: 10, O: 35, R: 0 },
          },
          finished_at: new Date().toISOString(),
        })
        .eq("id", grading.id);
    } else {
      const callbackUrl = `${supabaseUrl}/functions/v1/grade-callback`;
      const ghToken = await getPlatformSecret(supabase, "GITHUB_TOKEN");
      const ghRepo = await getPlatformSecret(supabase, "GITHUB_REPO");

      try {
        await dispatchGitHubWorkflow(
          submission.id,
          assignment.problem_id,
          callbackUrl,
          ghToken ?? "",
          ghRepo ?? "",
          grading.id,
        );
      } catch (dispatchErr: any) {
        // Actions 触发失败：隔离为 system_error，绝不给学生打 0 分！
        console.error("[Submit] GitHub Actions dispatch 异常:", dispatchErr?.message);
        await supabase
          .from("gradings")
          .update({
            status: "system_error",
            error_message: "自动化评测任务调度异常，等待系统重试或联系教师",
            finished_at: new Date().toISOString(),
          })
          .eq("id", grading.id);

        return jsonResponse({
          ok: true,
          submission_id: submission.id,
          public_code: submission.public_code,
          attempt_no: submission.attempt_no,
          status: "system_error",
          warning: "自动化评测调度暂时遇到系统波动，已记录提交并等待重试",
        });
      }
    }

    // 12. 成功响应
    return jsonResponse({
      ok: true,
      submission_id: submission.id,
      public_code: submission.public_code,
      attempt_no: submission.attempt_no,
      status: "queued",
      ...(isLate ? { warning: "已超过截止时间，本次提交已标记为迟交" } : {}),
    });
  } catch (err: any) {
    console.error("[Submit] 未捕获异常:", err?.message || err);
    return errorResponse("服务器内部处理异常", 500, "INTERNAL_ERROR");
  }
});
