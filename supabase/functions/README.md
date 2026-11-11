# Supabase Edge Functions — SCIP-OJ 判分平台

本目录包含 SCIP-OJ 平台全部 6 个 Supabase Edge Functions（Deno / TypeScript）。

---

## 函数列表

| 函数名 | 路径 | 说明 |
|---|---|---|
| `submit-assignment` | `/functions/v1/submit-assignment` | 学生提交作业代码，原子入队并派发隔离评测 |
| `grade-callback` | `/functions/v1/grade-callback` | 接收 GitHub Actions 判分结果的 HMAC 签名回调 |
| `regrade` | `/functions/v1/regrade` | 教师/助教发起单条提交重新评分 |
| `regrade-batch` | `/functions/v1/regrade-batch` | 教师/助教批量重判选中的提交或整题一键重判 |
| `join-course` | `/functions/v1/join-course` | 服务端转发选课并原子匹配预置花名册 |
| `publish-assignment` | `/functions/v1/publish-assignment` | 教师/助教发布或更新作业（`P001`、`P002`）与防作弊策略 |

> **安全边界**：所有用户入口均通过 `_shared/auth.ts` 验证 JWT 并调用数据库白名单 RPC；`submit-assignment`、`regrade`、`regrade-batch` 通过原子事务 RPC `enqueue_grading` 入队并持久化 outbox 重试记录，明确禁止 `GRADE_RUNNER=mock`。

---

## 环境变量与密钥

所有函数依赖以下环境变量（优先读取 `Deno.env`，未命中时由服务角色回退查询 `public.platform_secrets`）：

| 变量名 | 说明 | 必须 |
|---|---|---|
| `SUPABASE_URL` | Supabase 项目 URL（运行时自动注入） | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端密钥，用于调用服务角色 RPC（运行时自动注入） | 是 |
| `GRADE_CALLBACK_SECRET` | HMAC-SHA256 共享密钥，用于验证 `grade-callback` 请求签名 | 是 |
| `GITHUB_TOKEN` | GitHub Access Token，用于解析评分器版本并触发 Actions workflow | 是 |
| `GITHUB_REPO` | GitHub 仓库（如 `AmaneSuzuha000/SCIP-OJ`） | 是 |

---

## 部署

### 前置条件

1. 安装 [Supabase CLI](https://supabase.com/docs/guides/cli)
2. 登录并关联项目：

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 设置密钥（Secrets）

```bash
supabase secrets set GRADE_CALLBACK_SECRET="your-strong-random-secret"
supabase secrets set GITHUB_TOKEN="<github-access-token>"
supabase secrets set GITHUB_REPO="AmaneSuzuha000/SCIP-OJ"
```

### 部署全部 Edge Functions

```bash
for fn in submit-assignment grade-callback regrade regrade-batch join-course publish-assignment; do
  supabase functions deploy "$fn"
done
```

### 本地类型检查（与 CI 一致）

```bash
deno check --node-modules-dir=manual \
  supabase/functions/submit-assignment/index.ts \
  supabase/functions/regrade/index.ts \
  supabase/functions/regrade-batch/index.ts \
  supabase/functions/grade-callback/index.ts \
  supabase/functions/join-course/index.ts \
  supabase/functions/publish-assignment/index.ts
```

---

## 关键接口契约

- **`submit-assignment`**：校验课程选修、学号绑定、考试身份核验与请求幂等键 `request_key`，写入不可变 `submissions` 与排队 `gradings`，派发 `.github/workflows/grade-submission.yml`。
- **`grade-callback`**：校验 `X-Grade-Signature`（恒定时间 HMAC-SHA256），调用 `complete_grading` 对同一 `grading_id` + `runner_ref` 幂等落库；runner 异常仅记 `status=system_error` 且 `score=null`，绝不误计 0 分。
- **`regrade` / `regrade-batch`**：校验 `teacher` / `ta` / `admin` 权限，支持指定最多 50 条 `submission_ids`（前端对超过 50 条自动去重排序并确定性分片）或整题 `course_id + problem_id` 一键重判，并自动记录 `grade_audits`。
- **`publish-assignment`**：仅允许当前授权题库 `P001`、`P002`，支持设置截止时间、`pass_score`、`n_instances`、`score_policy` 与 `integrity_policy`。
