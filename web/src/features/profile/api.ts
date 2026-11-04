import { supabase } from '@/lib/supabase';

/**
 * Profile writes.
 *
 * The row itself is created by a trigger when the account is first seen, so
 * this only ever updates two user-owned fields. student_no is UNIQUE: two
 * accounts cannot claim the same number, and the database rejects it rather
 * than silently letting the second one win.
 */
export interface ProfilePatch {
  display_name: string;
  student_no: string | null;
}

export async function updateProfile(patch: ProfilePatch): Promise<void> {
  const client = supabase();
  const { data: auth } = await client.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('请先登录');

  const { error } = await client
    .from('profiles')
    .update({
      display_name: patch.display_name.trim(),
      // Empty means "a teacher, or a student who has not been given a number
      // yet" -- store NULL rather than an empty string so UNIQUE stays sane.
      student_no: patch.student_no?.trim() ? patch.student_no.trim() : null,
    })
    .eq('user_id', userId);
  if (error) {
    // 23505 is UNIQUE; the message the database returns is not readable.
    if (error.code === '23505') throw new Error('这个学号已经被另一个账号绑定');
    throw new Error(error.message);
  }
}
