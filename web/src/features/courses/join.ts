import { supabase } from '@/lib/supabase';

/**
 * Joining a course by invitation code.
 *
 * The work happens in join_course_by_code, not here: it locks the course row,
 * checks expiry, revocation and the seat limit, and decides the enrolled role.
 * Doing any of that in the browser would be advisory only, so this is a thin
 * wrapper that turns its jsonb result into either a value or an Error.
 */
export interface JoinResult {
  courseId: string;
  courseName: string;
  alreadyEnrolled: boolean;
  role: string;
}

interface JoinPayload {
  ok?: boolean;
  error?: string;
  code?: string;
  course_id?: string;
  course_name?: string;
  already_enrolled?: boolean;
  role?: string;
}

export async function joinCourseByCode(code: string): Promise<JoinResult> {
  const { data, error } = await supabase().rpc('join_course_by_code', {
    p_code: code.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);

  const payload = (data ?? {}) as JoinPayload;
  if (!payload.ok) {
    // The function returns Chinese text meant to be shown as-is.
    throw new Error(payload.error ?? '无法加入课程');
  }
  return {
    courseId: payload.course_id ?? '',
    courseName: payload.course_name ?? '',
    alreadyEnrolled: payload.already_enrolled === true,
    role: payload.role ?? 'student',
  };
}
