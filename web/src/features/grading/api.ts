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

/** Edge functions return { error } with a non-2xx status; surface the message. */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (error) throw new Error(error.message || '请求失败');
  return data as T;
}

export async function listAssignments(courseId: string): Promise<Assignment[]> {
  const { data, error } = await supabase()
    .from('assignments')
    .select('id,course_id,problem_id,pass_score,n_instances,due_at,integrity_policy')
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
  return invoke<SubmitReceipt>('submit-assignment', {
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
    .select('id,submission_id,status,score,passed,report_json')
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
