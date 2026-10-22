# Supabase Edge Functions — SCIP-OJ 判分平台

本目录包含 SCIP-OJ 平台 Phase 1 的三个 Supabase Edge Functions（Deno/TypeScript）。

---

## 函数列表

| 函数名 | 路径 | 说明 |
|--------|------|------|
| `submit-assignment` | `/functions/v1/submit-assignment` | 学生提交作业代码，触发自动判分 |
| `grade-callback` | `/functions/v1/grade-callback` | 接收 GitHub Actions 判分结果的回调 |
| `regrade` | `/functions/v1/regrade` | 教师发起重新评分 |

---

## 环境变量

所有函数均依赖以下环境变量（通过 Supabase Dashboard 或 CLI 配置）：

| 变量名 | 说明 | 必须 |
|--------|------|------|
| `SUPABASE_URL` | Supabase 项目 URL（Supabase 自动注入） | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端密钥，用于绕过 RLS 操作数据库（Supabase 自动注入） | ✅ |
| `GRADE_CALLBACK_SECRET` | HMAC-SHA256 共享密钥，用于验证 `grade-callback` 请求来源 | ✅ |
| `GITHUB_TOKEN` | GitHub Personal Access Token，用于触发 Actions workflow | ✅ |
| `GITHUB_REPO` | GitHub 仓库，格式为 `owner/repo`（如 `AmaneSuzuha000/scip-oj`） | ✅ |
| `GRADE_RUNNER` | 设为 `mock` 可跳过 GitHub 触发，直接返回模拟评分结果（仅开发用） | ❌ |

---

## 部署

### 前置条件

1. 安装 [Supabase CLI](https://supabase.com/docs/guides/cli)
2. 登录 Supabase：`supabase login`
3. 关联项目：`supabase link --project-ref <your-project-ref>`

### 设置环境变量（Secrets）

```bash
supabase secrets set GRADE_CALLBACK_SECRET="your-strong-random-secret"
supabase secrets set GITHUB_TOKEN="<github-personal-access-token>"
supabase secrets set GITHUB_REPO="AmaneSuzuha000/scip-oj"
```

> **注意**：`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 运行时自动注入，无需手动设置。

### 部署单个函数

```bash
supabase functions deploy submit-assignment
supabase functions deploy grade-callback
supabase functions deploy regrade
```

### 部署全部函数

```bash
supabase functions deploy submit-assignment && \
supabase functions deploy grade-callback && \
supabase functions deploy regrade
```

---

## 本地开发与测试

### 启动本地函数服务

```bash
supabase functions serve
```

这将在本地启动所有 Edge Functions，默认监听 `http://localhost:54321/functions/v1/`。

### 配置本地环境变量

创建 `supabase/.env.local` 文件（已加入 `.gitignore`）：

```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<your-local-service-role-key>
GRADE_CALLBACK_SECRET=test-secret-for-local-dev
GITHUB_TOKEN=<github-personal-access-token>
GITHUB_REPO=AmaneSuzuha000/scip-oj
GRADE_RUNNER=mock
```

> **提示**：本地开发时建议设置 `GRADE_RUNNER=mock`，这样提交后会直接返回模拟分数（score=85, passed=false），无需配置真实的 GitHub Actions。

### 测试 submit-assignment

```bash
curl -X POST http://localhost:54321/functions/v1/submit-assignment \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "assignment_id": "uuid-of-assignment",
    "code_text": "from pyscipopt import Model\ndef solve(instance):\n    return {}"
  }'
```

### 测试 grade-callback

先计算 HMAC 签名：

```bash
# 请求体
BODY='{"submission_id":"uuid","score":95,"passed":true,"report":{"messages":["OK"]},"status":"done"}'

# 计算签名（macOS / Linux）
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "test-secret-for-local-dev" | awk '{print $2}')

curl -X POST http://localhost:54321/functions/v1/grade-callback \
  -H "X-Grade-Signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

### 测试 regrade

```bash
curl -X POST http://localhost:54321/functions/v1/regrade \
  -H "Authorization: Bearer <teacher-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "submission_id": "uuid-of-submission",
    "reason": "学生申诉，重新评分"
  }'
```

---

## Mock 模式

设置环境变量 `GRADE_RUNNER=mock` 后：

- `submit-assignment` 和 `regrade` 将**跳过 GitHub Actions 触发**
- 直接将评分结果更新为 `score=85, passed=false`
- 适用于前端开发联调，无需配置真实的 GitHub Token 和 Actions workflow

---

## 函数详细说明

### submit-assignment

**端点**：`POST /functions/v1/submit-assignment`

**请求头**：
- `Authorization: Bearer <supabase-jwt>` — 学生身份认证
- `Content-Type: application/json`

**请求体**：
```json
{
  "assignment_id": "uuid",
  "code_text": "def solve(instance): ..."
}
```

**处理流程**：
1. 验证 JWT，提取 user_id
2. 检查用户是否选修了该作业所属课程
3. 查询作业是否存在，检查截止时间（迟交标记但允许提交）
4. 计算代码 SHA-256 哈希
5. 写入 `submissions` 表
6. 写入 `gradings` 表（status=queued）
7. 触发 GitHub Actions `grade-submission.yml`（或 Mock 直接完成）
8. 返回提交 ID 和状态

**响应**：
```json
{
  "submission_id": "uuid",
  "public_code": "A1B2C3D4",
  "status": "queued",
  "warning": "已超过截止时间，本次提交标记为迟交"  // 仅迟交时出现
}
```

### grade-callback

**端点**：`POST /functions/v1/grade-callback`

**请求头**：
- `X-Grade-Signature: <hmac-sha256-hex>` — HMAC 签名（body + GRADE_CALLBACK_SECRET）

**请求体**：
```json
{
  "submission_id": "uuid",
  "score": 95,
  "passed": true,
  "report": { "messages": ["全部测例通过"] },
  "status": "done",
  "error_message": null
}
```

**安全机制**：
- 使用 HMAC-SHA256 验证请求来源，防止伪造回调
- 常量时间比较，防止 timing attack
- 签名不匹配返回 403

**status 取值**：
- `done` — 正常评分完成，写入 score / passed / report_json
- `system_error` — 系统错误，**不将 score 设为 0**，保留为 null，记录 error_message

### regrade

**端点**：`POST /functions/v1/regrade`

**请求头**：
- `Authorization: Bearer <teacher-jwt>` — 教师身份认证

**请求体**：
```json
{
  "submission_id": "uuid",
  "reason": "学生申诉，重新评分"
}
```

**权限**：
- 仅允许该课程的教师（enrollments 表中 role=teacher）操作

**处理流程**：
1. 验证教师身份和课程权限
2. 创建新 `gradings` 行（status=queued）
3. 写入 `grade_audits` 审计记录（old_score → new_score=null）
4. 触发 GitHub Actions 重新判分

**响应**：
```json
{
  "grading_id": "uuid",
  "status": "queued"
}
```

---

## 数据库表依赖

这些函数假设以下数据库表已存在：

- `assignments` — 作业定义（含 course_id, problem_id, due_at）
- `enrollments` — 选课记录（含 user_id, course_id, role）
- `submissions` — 学生提交记录
- `gradings` — 评分记录
- `grade_audits` — 评分审计日志

详见数据库迁移文件。
