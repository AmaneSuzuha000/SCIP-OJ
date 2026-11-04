import { supabase } from '@/lib/supabase';

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

interface RosterRow {
  id: string;
  student_no: string;
  display_name: string;
  github_login: string | null;
  status: 'pending' | 'matched';
  matched_user_id: string | null;
}

/** The invitation code for a course. Teachers only; RLS hides other courses. */
export async function getInviteCode(courseId: string): Promise<string | null> {
  const { data, error } = await supabase()
    .from('courses')
    .select('invite_code')
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { invite_code: string | null } | null)?.invite_code ?? null;
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
export async function listRoster(courseId: string): Promise<RosterEntry[]> {
  const client = supabase();
  const [roster, verified] = await Promise.all([
    client
      .from('roster_pending')
      .select('id,student_no,display_name,github_login,status,matched_user_id')
      .eq('course_id', courseId)
      .order('student_no', { ascending: true }),
    client.rpc('get_course_verified_roster', { p_course_id: courseId }),
  ]);
  if (roster.error) throw new Error(roster.error.message);
  if (verified.error) throw new Error(verified.error.message);

  const stamps = new Map<string, string>();
  for (const row of (verified.data ?? []) as { roster_id: string; verified_at: string }[]) {
    stamps.set(row.roster_id, row.verified_at);
  }
  return ((roster.data ?? []) as RosterRow[]).map((row) => ({
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

/** Parse the CSV the guide documents: 学号,真实姓名[,GitHub用户名], optional header. */
export function parseRosterCsv(text: string): { studentNo: string; displayName: string; githubLogin?: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,;\t]/).map((cell) => cell.trim()))
    // A header row is any first cell that is not a number.
    .filter((cells) => cells.length >= 2 && /^\d+$/.test(cells[0] ?? ''))
    .map((cells) => ({
      studentNo: cells[0] as string,
      displayName: cells[1] ?? '',
      githubLogin: cells[2] || undefined,
    }));
}
