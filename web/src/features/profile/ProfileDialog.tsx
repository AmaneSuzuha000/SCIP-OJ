import { useEffect, useState } from 'react';
import { Dialog, DialogActions, Field, TextInput } from '@/components/Dialog';
import { updateProfile } from '@/features/profile/api';
import { useSession } from '@/store/session';

/**
 * Asks for the student number the roster is keyed on.
 *
 * Shown once, on the first session that has no student_no and is a student:
 * every screen that shows a grade attributes it by this number, so a student
 * who skips it sees their own work as unattributed. It stays dismissible --
 * a teacher has no student number, and forcing the form on them would be a
 * dead end with no way past it.
 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useSession((s) => s.profile);
  const setProfile = useSession((s) => s.setProfile);
  const [studentNo, setStudentNo] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isStudent = !profile || profile.role === 'student';

  // Seed from the current profile each time it opens, so a dismissed edit does
  // not leave half-typed values behind on the next open.
  useEffect(() => {
    if (!open) return;
    setStudentNo(profile?.student_no ?? '');
    setDisplayName(profile?.display_name ?? '');
    setError(null);
  }, [open, profile]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = studentNo.trim();
    const cleanName = displayName.trim();
    if (isStudent && !trimmed) {
      setError('请填写学号');
      return;
    }
    if (!cleanName) {
      setError('请填写真实姓名');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const storedNo = trimmed || null;
      await updateProfile({ display_name: cleanName, student_no: storedNo });
      if (profile) {
        setProfile({ ...profile, student_no: storedNo, display_name: cleanName });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={isStudent ? '绑定学号与姓名' : '个人资料'}
      description={
        isStudent
          ? '成绩按学号归档。学号填写后不能和其他账号重复。'
          : '更新姓名设置；教师或管理员无需绑定学号。'
      }
      onClose={onClose}
      busy={busy}
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field
          label="学号"
          hint={isStudent ? '例如 20260001' : '教师或助教可留空'}
          error={error ?? undefined}
        >
          <TextInput
            value={studentNo}
            onChange={(event) => setStudentNo(event.target.value)}
            placeholder={isStudent ? '20260001' : '可选'}
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        <Field label="真实姓名" hint="教师按这个名字核对花名册">
          <TextInput
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="李同学"
            autoComplete="name"
            disabled={busy}
          />
        </Field>
        <DialogActions confirmLabel="保存" busy={busy} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
