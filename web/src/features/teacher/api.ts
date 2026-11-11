import { supabase, type Assignment, type Grading, type Submission } from '@/lib/supabase';
import { invokeEdge } from '@/features/grading/api';

/**
 * Teacher operations.
 *
 * Every call here is checked in the database, not in the browser: the RPCs
 * verify that the caller is a teacher or admin of the course, and the roster
 * tables have no client write policy at all. The UI hides these controls from
 * students as a convenience, not as the boundary.
 */

export interface RosterEntry {
  rosterId: string;
  studentNo: string;
  displayName: string;
  githubLogin: string | null;
  status: 'pending' | 'matched';
  matchedUserId: string | null;
  verifiedAt: string | null;
}

export interface GradebookRow {
  course_id: string;
  user_id: string;
  student_no: string | null;
  display_name: string | null;
  assignment_id: string;
  problem_id: string;
  pass_score: number;
  best_submission_id: string | null;
  best_score: number | null;
  passed: boolean | null;
  submission_count: number;
  attempt_count: number;
  latest_submission_at: string | null;
  last_submitted_at: string | null;
}

export interface TeacherSubmissionRow extends Submission {
  code_text: string;
  gradings: Grading[];
}

interface RosterRow {
  id: string;
  student_no: string;
  display_name: string;
  github_login: string | null;
  status: 'pending' | 'matched';
  matched_user_id: string | null;
}

/** The invitation code for a course. Uses SECURITY DEFINER RPC (direct column SELECT on invite_code is revoked). */
export async function getInviteCode(courseId: string): Promise<string | null> {
  const { data, error } = await supabase().rpc('get_course_invite_code', {
    p_course_id: courseId,
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

/** Returns the new code. Passing null lets the database generate one. */
export async function rotateInviteCode(courseId: string, next: string | null): Promise<string> {
  const { data, error } = await supabase().rpc('rotate_course_invite_code', {
    p_course_id: courseId,
    p_new_code: next,
  });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

/**
 * The roster with verification state.
 *
 * Two sources are joined here rather than in SQL because a verified student
 * appears in roster_verifications and not in the pending list; without the
 * second read the table would silently drop everyone already checked.
 */
const ROSTER_PAGE = 500;

/**
 * A PostgREST select stops at 1000 rows without saying so. A class roster can
 * exceed that, and the teacher's export is the gradebook of record, so page
 * until a short page comes back rather than trusting the default limit.
 *
 * The page reader is a parameter so the loop can be tested without a client.
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = ROSTER_PAGE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function readAllRoster(courseId: string): Promise<RosterRow[]> {
  return readAllPages<RosterRow>(async (from, to) => {
    const { data, error } = await supabase()
      .from('roster_pending')
      .select('id,student_no,display_name,github_login,status,matched_user_id')
      .eq('course_id', courseId)
      .order('student_no', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as RosterRow[];
  });
}

export async function listRoster(courseId: string): Promise<RosterEntry[]> {
  const client = supabase();
  const [roster, verified] = await Promise.all([
    readAllRoster(courseId),
    client.rpc('get_course_verified_roster', { p_course_id: courseId }),
  ]);
  if (verified.error) throw new Error(verified.error.message);

  const stamps = new Map<string, string>();
  for (const row of (verified.data ?? []) as { roster_id: string; verified_at: string }[]) {
    stamps.set(row.roster_id, row.verified_at);
  }
  return roster.map((row) => ({
    rosterId: row.id,
    studentNo: row.student_no,
    displayName: row.display_name,
    githubLogin: row.github_login,
    status: row.status,
    matchedUserId: row.matched_user_id,
    verifiedAt: stamps.get(row.id) ?? null,
  }));
}

export async function confirmIdentity(rosterId: string, userId: string): Promise<void> {
  const { error } = await supabase().rpc('confirm_student_identity', {
    p_roster_id: rosterId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Import a roster from CSV text.
 *
 * Deliberately not an upsert: re-importing a corrected sheet must not reset a
 * student who has already claimed their row to 'pending', which would silently
 * revoke their access in an exam. Existing numbers are skipped.
 */
export async function importRoster(
  courseId: string,
  rows: { studentNo: string; displayName: string; githubLogin?: string }[],
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const { data, error } = await supabase()
    .from('roster_pending')
    .insert(
      rows.map((row) => ({
        course_id: courseId,
        student_no: row.studentNo,
        display_name: row.displayName,
        github_login: row.githubLogin?.trim() || null,
      })),
    )
    .select('id');
  if (error) {
    if (error.code === '23505') throw new Error('花名册里有重复学号，或这些学号已经导入过');
    throw new Error(error.message);
  }
  const inserted = (data ?? []).length;
  return { inserted, skipped: rows.length - inserted };
}

function unquoteCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

/** Parse the CSV the guide documents: 学号,真实姓名[,GitHub用户名], optional BOM/header. */
export function parseRosterCsv(text: string): { studentNo: string; displayName: string; githubLogin?: string }[] {
  const clean = text.replace(/^\uFEFF/, '');
  return clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,;\t]/).map(unquoteCell))
    // Accept numeric and alphanumeric student IDs (with at least one digit) while dropping headers/prose.
    .filter((cells) => cells.length >= 2 && /^(?=.*\d)[A-Za-z0-9_-]{4,32}$/.test(cells[0] ?? ''))
    .map((cells) => ({
      studentNo: cells[0] as string,
      displayName: cells[1] ?? '',
      githubLogin: cells[2] || undefined,
    }));
}

export async function publishAssignment(input: {
  courseId: string;
  problemId: string;
  dueAt?: string | null;
  passScore?: number;
  nInstances?: number;
  scorePolicy?: 'highest_before_due' | 'latest' | 'highest';
  integrityPolicy?: 'standard' | 'exam_warn' | 'exam_block';
}): Promise<{ ok: boolean; message: string; assignment: Assignment }> {
  return invokeEdge<{ ok: boolean; message: string; assignment: Assignment }>(
    'publish-assignment',
    {
      course_id: input.courseId,
      problem_id: input.problemId,
      due_at: input.dueAt || null,
      pass_score: input.passScore ?? 90,
      n_instances: input.nInstances ?? 3,
      score_policy: input.scorePolicy ?? 'highest_before_due',
      integrity_policy: input.integrityPolicy ?? 'standard',
    },
  );
}

export async function getTeacherGradebook(courseId: string): Promise<GradebookRow[]> {
  const { data, error } = await supabase().rpc('get_teacher_gradebook', {
    p_course_id: courseId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as GradebookRow[];
}

export async function listTeacherAssignmentSubmissions(
  assignmentId: string,
): Promise<TeacherSubmissionRow[]> {
  const { data, error } = await supabase()
    .from('submissions')
    .select(
      'id,assignment_id,attempt_no,created_at,public_code,metadata,code_text,' +
        'gradings(id,submission_id,status,score,passed,report_json,error_message,created_at)',
    )
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TeacherSubmissionRow[];
}

function escapeCsvCell(raw: string | number | boolean | null | undefined): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  // Mitigate Excel/Sheets CSV formula injection on user-supplied names/numbers.
  const neutralized = /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
  if (/[",\r\n]/.test(neutralized)) {
    return '"' + neutralized.replace(/"/g, '""') + '"';
  }
  return neutralized;
}

export function exportGradebookCsv(rows: GradebookRow[]): string {
  const header = ['学号', '姓名', '题目', '最佳得分', '是否通过', '及格线', '提交次数', '最近提交时间'];
  const lines = [
    header.map(escapeCsvCell).join(','),
    ...rows.map((row) =>
      [
        row.student_no ?? '未绑定',
        row.display_name ?? '',
        row.problem_id,
        row.best_score ?? '',
        row.passed === null ? '' : row.passed ? '是' : '否',
        row.pass_score,
        row.submission_count,
        row.last_submitted_at ?? '',
      ]
        .map(escapeCsvCell)
        .join(','),
    ),
  ];
  return '\uFEFF' + lines.join('\r\n');
}
