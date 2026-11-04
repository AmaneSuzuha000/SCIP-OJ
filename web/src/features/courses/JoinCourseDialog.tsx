import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogActions, Field, TextInput } from '@/components/Dialog';
import { joinCourseByCode } from '@/features/courses/join';

/**
 * Enrolment by invitation code.
 *
 * The code is the only thing the teacher hands out, so a failed join has to say
 * which kind of failure it was: revoked, expired and full all look identical
 * from the outside, and "邀请码无效" would send a student to ask for a new code
 * when the real problem is that the class is full.
 */
export function JoinCourseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setError('请输入邀请码');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await joinCourseByCode(code);
      setDone(result.courseName || '课程');
      // The course list is what decides which courses the home page shows.
      await queryClient.invalidateQueries({ queryKey: ['my-courses'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加入失败');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setCode('');
    setError(null);
    setDone(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      title="加入课程"
      description="输入任课教师发放的邀请码。"
      onClose={busy ? () => undefined : close}
      busy={busy}
    >
      {done ? (
        <>
          <p className="text-sm text-secondary">已加入《{done}》。</p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={close}
              className="rounded-[var(--radius-md)] bg-[var(--brand-500)] px-3 py-1.5 text-sm text-[var(--text-inverse)]"
            >
              完成
            </button>
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Field label="邀请码" hint="不区分大小写" error={error ?? undefined}>
            <TextInput
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="例如 ab12cd"
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </Field>
          <DialogActions confirmLabel="加入" busy={busy} onCancel={close} />
        </form>
      )}
    </Dialog>
  );
}
