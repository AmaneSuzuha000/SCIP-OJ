import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GradingReport } from '@/components/GradingReport';
import { ProfileDialog } from '@/features/profile/ProfileDialog';
import { useSession } from '@/store/session';
import type { Profile } from '@/lib/supabase';

const updateProfileMock = vi.fn();

vi.mock('@/features/profile/api', () => ({
  updateProfile: (...args: unknown[]) => updateProfileMock(...args),
}));

describe('GradingReport', () => {
  it('returns null when there is no report data or diagnostic error', () => {
    const { container } = render(<GradingReport report={{}} errorMessage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders diagnostic banner, breakdown metrics, messages, instance details and grader metadata', () => {
    render(
      <GradingReport
        errorMessage="自定义诊断信息"
        report={{
          breakdown: { F: 20, C: 30, I: 20, O: 30, R: 100 },
          messages: ['全部约束满足', '目标到达最优'],
          instances: [
            { score: 100, passed: true, messages: ['样例 1 优解一致'] },
            { score: 80, passed: false, messages: ['目标偏移 5%'] },
          ],
          execution: {
            grader_ref: '0123456789abcdef0123456789abcdef01234567',
            image_digest: 'sha256:abc',
          },
        }}
      />,
    );

    expect(screen.getByText('自定义诊断信息')).toBeInTheDocument();
    expect(screen.getByText('格式 F')).toBeInTheDocument();
    expect(screen.getByText('约束 C')).toBeInTheDocument();
    expect(screen.getByText('整数性 I')).toBeInTheDocument();
    expect(screen.getByText('目标 O')).toBeInTheDocument();
    expect(screen.queryByText('R')).toBeNull();
    expect(screen.getByText('私有实例明细（2 组）')).toBeInTheDocument();
    expect(screen.getByText('100 分')).toBeInTheDocument();
    expect(screen.getByText('80 分')).toBeInTheDocument();
    expect(screen.getByText(/评分器版本 01234567 · 容器校验已记录/)).toBeInTheDocument();
  });
});

describe('ProfileDialog', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function openWithProfile(profile: Profile) {
    useSession.setState({
      session: { user: { id: profile.user_id } } as never,
      profile,
      access: 'granted',
    });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ProfileDialog open onClose={onClose} />
      </QueryClientProvider>,
    );
    return onClose;
  }

  beforeEach(() => {
    updateProfileMock.mockReset();
    updateProfileMock.mockResolvedValue(undefined);
  });

  it('requires student_no for student accounts before saving', async () => {
    const onClose = openWithProfile({
      user_id: 'u-stu',
      display_name: '李同学',
      student_no: null,
      role: 'student',
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('请填写学号')).toBeInTheDocument();
    expect(updateProfileMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows staff accounts (teacher/admin) to save without a student_no', async () => {
    const onClose = openWithProfile({
      user_id: 'u-teacher',
      display_name: '王老师',
      student_no: '20200001',
      role: 'teacher',
    });

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: '' } });
    fireEvent.change(inputs[1]!, { target: { value: '王老师（已更新）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1));
    expect(updateProfileMock).toHaveBeenCalledWith({
      display_name: '王老师（已更新）',
      student_no: null,
    });
    expect(useSession.getState().profile).toMatchObject({
      student_no: null,
      display_name: '王老师（已更新）',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
