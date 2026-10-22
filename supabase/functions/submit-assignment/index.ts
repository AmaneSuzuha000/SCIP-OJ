// supabase/functions/submit-assignment/index.ts
// 学生提交作业 Edge Function
// ────────────────────────────────────────────
// POST { assignment_id, code_text }
// 认证：Authorization header 中的 Supabase JWT
// 流程：校验选课 → 检查截止时间 → 计算 code_hash → 写入 submissions + gradings → 触发 GitHub Actions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

// ── CORS 头（浏览器直接调用需要） ──
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** 统一 JSON 响应工具 */
function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** 计算字符串的 SHA-256 十六进制摘要 */
async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return encodeHex(new Uint8Array(hashBuffer));
}

/** Resolve secret: Deno.env first, then platform_secrets (service_role only). */
async function getPlatformSecret(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  const { data, error } = await supabase
    .from("platform_secrets")
    .select("value")
    .eq("key", name)
    .maybeSingle();
  if (error) {
    console.error(`platform_secrets read failed for ${name}:`, error.message);
    return null;
  }
  return data?.value ?? null;
}

/** 触发 GitHub Actions workflow_dispatch */
async function dispatchGitHubWorkflow(
  submissionId: string,
  problemId: string,
  callbackUrl: string,
  token: string,
  repo: string,
): Promise<void> {
  if (!token || !repo) {
    throw new Error("GitHub 配置缺失：GITHUB_TOKEN 或 GITHUB_REPO 未设置");
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/grade-submission.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        submission_id: submissionId,
        problem_id: problemId,
        callback_url: callbackUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Actions 触发失败 (${res.status}): ${errText}`);
  }
}

// ── 请求体类型 ──
interface SubmitBody {
  assignment_id: string;
  code_text: string;
}

serve(async (req: Request): Promise<Response> => {
  // ── 处理 CORS 预检请求 ──
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "仅支持 POST 请求" }, 405);
  }

  try {
    // ── 1. 提取并验证 JWT ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "缺少 Authorization 头" }, 401);
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

    // ── 2. 解析请求体 ──
    const body: SubmitBody = await req.json();
    const { assignment_id, code_text } = body;

    if (!assignment_id || !code_text) {
      return jsonResponse(
        { error: "请求体缺少 assignment_id 或 code_text" },
        400,
      );
    }

    // ── 3. 查询作业信息 ──
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("id, course_id, problem_id, due_at")
      .eq("id", assignment_id)
      .single();

    if (assignmentError || !assignment) {
      return jsonResponse({ error: "作业不存在" }, 404);
    }

    // ── 4. 校验用户是否选课（enrolled in the course） ──
    const { data: enrollment, error: enrollError } = await supabase
      .from("enrollments")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", assignment.course_id)
      .single();

    if (enrollError || !enrollment) {
      return jsonResponse({ error: "您未选修该课程" }, 403);
    }

    // ── 5. 检查截止时间（允许迟交但标记） ──
    const isLate = assignment.due_at
      ? new Date() > new Date(assignment.due_at)
      : false;
    const submissionMeta: Record<string, unknown> = {};
    if (isLate) {
      submissionMeta.late = true;
      submissionMeta.submitted_after_due = true;
    }

    // ── 6. 计算代码哈希 ──
    const codeHash = await sha256Hex(code_text);

    // ── 7. 生成提交短码（public_code），用于学生查看 ──
    const publicCode = `SUB-${codeHash.substring(0, 8).toUpperCase()}`;

    // ── 8. 插入 submissions 表 ──
    const { data: submission, error: insertSubErr } = await supabase
      .from("submissions")
      .insert({
        user_id: user.id,
        assignment_id,
        code_text,
        code_hash: codeHash,
        public_code: publicCode,
        metadata: submissionMeta,
      })
      .select("id, public_code")
      .single();

    if (insertSubErr || !submission) {
      console.error("插入 submission 失败:", insertSubErr);
      return jsonResponse({ error: "提交保存失败" }, 500);
    }

    // ── 9. 插入 gradings 表（初始状态 queued） ──
    const { error: insertGradingErr } = await supabase
      .from("gradings")
      .insert({
        submission_id: submission.id,
        status: "queued",
      });

    if (insertGradingErr) {
      console.error("插入 grading 失败:", insertGradingErr);
      return jsonResponse({ error: "评分记录创建失败" }, 500);
    }

    // ── 10. 触发判分（Mock 模式或 GitHub Actions） ──
    const gradeRunner = await getPlatformSecret(supabase, "GRADE_RUNNER");

    if (gradeRunner === "mock") {
      // Mock 模式：直接更新为完成状态，方便前端开发调试
      await supabase
        .from("gradings")
        .update({
          status: "done",
          score: 85,
          passed: false,
          report_json: { message: "Mock 判分结果（非真实评分）" },
          finished_at: new Date().toISOString(),
        })
        .eq("submission_id", submission.id)
        .eq("status", "queued");
    } else {
      // 真实模式：触发 GitHub Actions workflow
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
        );
      } catch (dispatchErr) {
        // 触发失败不影响提交记录，但记录错误并通知用户
        console.error("GitHub Actions 触发失败:", dispatchErr);
        await supabase
          .from("gradings")
          .update({
            status: "system_error",
            error_message: "判分任务触发失败，请联系教师",
            finished_at: new Date().toISOString(),
          })
          .eq("submission_id", submission.id)
          .eq("status", "queued");
      }
    }

    // ── 11. 返回结果 ──
    return jsonResponse({
      submission_id: submission.id,
      public_code: publicCode,
      status: "queued",
      ...(isLate ? { warning: "已超过截止时间，本次提交标记为迟交" } : {}),
    });
  } catch (err) {
    console.error("submit-assignment 未捕获错误:", err);
    return jsonResponse({ error: "服务器内部错误" }, 500);
  }
});
