import { createServiceClient, getPlatformSecret } from "./secrets.ts";
import { dispatchGitHubWorkflow, resolveGraderRevision } from "./github.ts";
import { errorResponse } from "./cors.ts";

type Client = ReturnType<typeof createServiceClient>["supabase"];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function gradingRevision(supabase: Client): Promise<string> {
  // Production never manufactures grades, including teacher and batch paths.
  if (await getPlatformSecret(supabase, "GRADE_RUNNER") === "mock") {
    throw new Error("正式评测禁止 Mock 评分，请联系管理员修复配置");
  }
  return resolveGraderRevision(
    await getPlatformSecret(supabase, "GITHUB_TOKEN") || "",
    await getPlatformSecret(supabase, "GITHUB_REPO") || "",
  );
}

/** Best-effort immediate delivery. The committed outbox owns all retries. */
export async function dispatchQueued(supabase: Client, url: string, gradingId: string): Promise<void> {
  try {
    const { data: jobs, error } = await supabase.rpc("lease_grading_dispatches", {
      p_limit: 1, p_grading_id: gradingId,
    });
    if (error) throw error;
    for (const job of jobs || []) {
      let failure: string | null = null;
      try {
        await dispatchGitHubWorkflow(job.submission_id, job.problem_id, `${url}/functions/v1/grade-callback`,
          await getPlatformSecret(supabase, "GITHUB_TOKEN") || "",
          await getPlatformSecret(supabase, "GITHUB_REPO") || "", job.grading_id);
      } catch {
        // Response loss is ambiguous: never close a potentially running job.
        failure = "派发响应未确认，将自动重试";
      }
      const { error: ackError } = await supabase.rpc("finish_grading_dispatch", {
        p_grading_id: job.grading_id, p_lease_token: job.lease_token, p_error: failure,
      });
      if (ackError) throw ackError;
    }
  } catch {
    console.warn("[Grading] immediate delivery deferred to persistent recovery");
  }
}

export function gradingError(error: { message?: string }): Response {
  const message = error.message || "";
  const quotaReason = ["SUBMISSION_RATE_LIMIT_COOLDOWN", "SUBMISSION_RATE_LIMIT_HOURLY", "SUBMISSION_RATE_LIMIT_DAILY"]
    .find(code => message.includes(code));
  if (quotaReason) {
    const message = quotaReason.endsWith("COOLDOWN") ? "两次正式提交需至少间隔 20 秒，请检查代码后再提交"
      : quotaReason.endsWith("HOURLY") ? "本作业一小时内正式提交已达到 12 次，请稍后重试" : "今日正式提交已达到 60 次，请明天再试";
    return errorResponse(message, 429, quotaReason);
  }
  for (const [code, status, text] of [
    ["IDEMPOTENCY_CONFLICT",409,"请求编号已用于其他内容，请刷新后重试"],
    ["NOT_ENROLLED",403,"您未选修该课程"],
    ["STUDENT_NO_REQUIRED",403,"请先绑定真实学号与姓名"],
    ["IDENTITY_VERIFICATION_REQUIRED",403,"考试身份尚未经教师核验"],
    ["TEACHER_ROLE_REQUIRED",403,"仅本课程教师或助教可发起复判"],
    ["ASSIGNMENT_NOT_FOUND",404,"作业不存在"],
    ["SUBMISSION_NOT_FOUND",404,"提交记录不存在"],
    ["INVALID_GRADING_CONFIG",400,"作业评分配置无效"],
  ] as const) if (message.includes(code)) return errorResponse(text,status,code);
  console.error("[Grading] transaction failed");
  return errorResponse("评分服务暂不可用，提交未被确认，请保留代码并重试",503,"GRADING_UNAVAILABLE");
}

/** Derive stable per-submission UUIDs for a retried batch request. */
export async function batchRequestKey(key: string, id: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${key}:${id}`)));
  const h = Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
