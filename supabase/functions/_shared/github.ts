// supabase/functions/_shared/github.ts
// GitHub Actions workflow_dispatch 触发助手

export async function dispatchGitHubWorkflow(
  submissionId: string,
  problemId: string,
  callbackUrl: string,
  token: string,
  repo: string,
  gradingId: string,
): Promise<void> {
  if (!token || !repo) {
    throw new Error("GitHub 配置缺失：GITHUB_TOKEN 或 GITHUB_REPO 未设置");
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/grade-submission.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        submission_id: submissionId,
        grading_id: gradingId,
        problem_id: problemId,
        callback_url: callbackUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // 日志不泄露 token
    console.error(`[GitHub] workflow_dispatch 失败 HTTP ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`GitHub Actions 评测任务触发失败 (${res.status})`);
  }
}
