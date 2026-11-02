import { supabase } from '@/lib/supabase';

export interface EnrolledCourse {
  id: string;
  name: string;
  code: string | null;
  role: 'student' | 'teacher';
}

interface EnrollmentRow {
  role: 'student' | 'teacher';
  courses: { id: string; name: string; code: string | null } | null;
}

/** Courses the caller is enrolled in. RLS scopes both students and teachers. */
export async function listMyCourses(): Promise<EnrolledCourse[]> {
  const { data, error } = await supabase()
    .from('enrollments')
    .select('role,courses(id,name,code)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as EnrollmentRow[];
  return rows
    .filter((row): row is EnrollmentRow & { courses: NonNullable<EnrollmentRow['courses']> } =>
      row.courses !== null)
    .map((row) => ({
      id: row.courses.id,
      name: row.courses.name,
      code: row.courses.code,
      role: row.role,
    }));
}
