import { supabase, type Assignment, type Grading, type Submission } from '@/lib/supabase';

export interface SubmitReceipt {
  ok: boolean;
  submission_id: string;
  public_code: string;
  attempt_no: number;
  grading_id: string;
  status: string;
  late?: boolean;
}

export interface ClientIntegritySignals {
  elapsed_seconds: number;
  input_events: number;
  paste_events: number;
  blocked_pastes: number;
  copy_events: number;
  drop_events: number;
  hidden_events: number;
}

export interface LeaderboardEntry {
  course_id: string;
  problem_id: string | null;
  student_no_masked: string;
  display_name: string | null;
  best_score: number;
  passed: boolean | null;
  attempt_count: number;
  last_submitted_at: string | null;
}

export interface RegradeReceipt {
  ok?: boolean;
  grading_id: string;
  submission_id: string;
  status: string;
  message?: string;
}

export interface BatchRegradeItemResult {
  id: string;
  success: boolean;
  grading_id?: string;
  error?: string;
}

export interface BatchRegradeResult {
  ok: boolean;
  total: number;
  success_count: number;
  results: BatchRegradeItemResult[];
}

export async function extractEdgeError(error: unknown): Promise<string> {
  const errObj = error as { message?: unknown; context?: unknown } | null;
  const ctx = errObj?.context;
  if (ctx && typeof (ctx as Response).clone === 'function') {
    try {
      const payload = (await (ctx as Response).clone().json()) as {
        error?: unknown;
        message?: unknown;
      };
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
      if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
    } catch {
      // Non-JSON body (e.g. HTML gateway error); fall back to error.message cleanly.
    }
  }
  return typeof errObj?.message === 'string' && errObj.message ? errObj.message : '请求失败';
}

/** Edge functions return { error } with a non-2xx status; surface the real JSON message. */
export async function invokeEdge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (error) throw new Error(await extractEdgeError(error));
  return data as T;
}

export async function getAssignment(assignmentId: string): Promise<Assignment | null> {
  const { data, error } = await supabase()
    .from('assignments')
    .select('id,course_id,problem_id,pass_score,n_instances,due_at,score_policy,integrity_policy')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Assignment | null) ?? null;
}

export async function listAssignments(courseId: string): Promise<Assignment[]> {
  const { data, error } = await supabase()
    .from('assignments')
    .select('id,course_id,problem_id,pass_score,n_instances,due_at,score_policy,integrity_policy')
    .eq('course_id', courseId)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Assignment[];
}

export function submitCode(input: {
  assignmentId: string;
  codeText: string;
  requestKey: string;
  clientIntegrity?: ClientIntegritySignals;
}): Promise<SubmitReceipt> {
  return invokeEdge<SubmitReceipt>('submit-assignment', {
    assignment_id: input.assignmentId,
    code_text: input.codeText,
    request_key: input.requestKey,
    client_integrity: input.clientIntegrity,
  });
}

export async function listSubmissions(assignmentId: string): Promise<Submission[]> {
  const { data, error } = await supabase()
    .from('submissions')
    .select('id,assignment_id,attempt_no,created_at,public_code,metadata')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Submission[];
}

export async function latestGrading(submissionId: string): Promise<Grading | null> {
  const { data, error } = await supabase()
    .from('gradings')
    .select('id,submission_id,status,score,passed,report_json,error_message,created_at,started_at,finished_at')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Grading | null) ?? null;
}

/** The list view never needs the full report blob, so it is not selected. */
export type GradingSummary = Pick<
  Grading,
  'id' | 'submission_id' | 'status' | 'score' | 'passed'
> & { created_at?: string };

/** One row of a student's submission history, with its gradings. */
export interface SubmissionRow extends Submission {
  gradings: GradingSummary[];
}

export interface SubmissionDetail extends Submission {
  code_text: string;
  gradings: Grading[];
}

export async function getSubmissionDetail(submissionId: string): Promise<SubmissionDetail | null> {
  const { data, error } = await supabase()
    .from('submissions')
    .select(
      'id,assignment_id,attempt_no,created_at,public_code,metadata,code_text,' +
        'gradings(id,submission_id,status,score,passed,report_json,error_message,created_at,started_at,finished_at)',
    )
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as SubmissionDetail | null) ?? null;
}

/**
 * The most recent submissions across every assignment. Row level security
 * already restricts this to the caller's own submissions, so no user filter is
 * applied here on purpose: the server, not the client, decides visibility.
 */
export async function listMySubmissions(limit = 50): Promise<SubmissionRow[]> {
  const { data, error } = await supabase()
    .from('submissions')
    .select('id,assignment_id,attempt_no,created_at,public_code,metadata,gradings(id,submission_id,status,score,passed,created_at)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  // PostgREST types the embedded relation structurally; the shape matches
  // GradingSummary exactly, so the assertion is narrow rather than a bypass.
  return (data ?? []) as unknown as SubmissionRow[];
}

/** Every attempt on one assignment, with each attempt's gradings attached. */
export async function listAssignmentSubmissions(
  assignmentId: string,
): Promise<SubmissionRow[]> {
  const { data, error } = await supabase()
    .from('submissions')
    .select('id,assignment_id,attempt_no,created_at,public_code,metadata,gradings(id,submission_id,status,score,passed,created_at)')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SubmissionRow[];
}

export async function listCourseLeaderboard(
  courseId: string,
  problemId?: string,
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase().rpc('get_course_leaderboard', {
    p_course_id: courseId,
    p_problem_id: problemId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeaderboardEntry[];
}

export function regradeSubmission(input: {
  submissionId: string;
  reason?: string;
  requestKey?: string;
}): Promise<RegradeReceipt> {
  return invokeEdge<RegradeReceipt>('regrade', {
    submission_id: input.submissionId,
    reason: input.reason,
    request_key: input.requestKey ?? newRequestKey(),
  });
}

async function deriveUuid(seed: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = new Uint8Array(
      await subtle.digest('SHA-256', new TextEncoder().encode(seed)),
    );
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  return newRequestKey();
}

export async function regradeBatch(input: {
  submissionIds?: string[];
  courseId?: string;
  problemId?: string;
  reason?: string;
  requestKey?: string;
}): Promise<BatchRegradeResult> {
  const masterKey = input.requestKey ?? newRequestKey();
  if (input.submissionIds && input.submissionIds.length > 0) {
    // Deduplicate and sort so retrying the same selection in another order
    // reproduces the same slice boundaries and request_key per slice.
    const uniqueIds = Array.from(new Set(input.submissionIds.filter(Boolean))).sort();
    const chunkSize = 50;
    const merged: BatchRegradeItemResult[] = [];
    for (let offset = 0, chunkIdx = 0; offset < uniqueIds.length; offset += chunkSize, chunkIdx += 1) {
      const slice = uniqueIds.slice(offset, offset + chunkSize);
      const chunkKey = chunkIdx === 0 ? masterKey : await deriveUuid(`${masterKey}:chunk:${chunkIdx}`);
      const res = await invokeEdge<BatchRegradeResult>('regrade-batch', {
        submission_ids: slice,
        reason: input.reason,
        request_key: chunkKey,
      });
      merged.push(...(res.results ?? []));
    }
    return {
      ok: true,
      total: merged.length,
      success_count: merged.filter((r) => r.success).length,
      results: merged,
    };
  }
  return invokeEdge<BatchRegradeResult>('regrade-batch', {
    course_id: input.courseId,
    problem_id: input.problemId,
    reason: input.reason,
    request_key: masterKey,
  });
}

/** Newest grading wins; a submission can accumulate several attempts. */
export function latestOf<T extends { created_at?: string }>(gradings: readonly T[]): T | null {
  let best: T | null = null;
  for (const grading of gradings) {
    if (!best || (grading.created_at ?? '') > (best.created_at ?? '')) best = grading;
  }
  return best;
}

/** A fresh idempotency key per submission attempt; retries reuse it. */
export function newRequestKey(): string {
  return crypto.randomUUID();
}

/**
 * Reuse an idempotency key across network failures for the same draft
 * (assignmentId + codeText), and rotate once an edit happens or a receipt was
 * committed and the student explicitly submits a subsequent attempt.
 */
export function createRequestKeyManager() {
  let lastFingerprint: string | null = null;
  let currentKey: string | null = null;

  return {
    keyFor(assignmentId: string, codeText: string): string {
      const fingerprint = `${assignmentId}\0${codeText.length}\0${codeText}`;
      if (fingerprint !== lastFingerprint || !currentKey) {
        lastFingerprint = fingerprint;
        currentKey = newRequestKey();
      }
      return currentKey;
    },
    confirmAndRotate(): void {
      lastFingerprint = null;
      currentKey = null;
    },
  };
}
