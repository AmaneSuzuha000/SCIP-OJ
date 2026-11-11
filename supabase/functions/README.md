# Supabase Edge Functions — SCIP-OJ 服务端接口

本目录包含 SCIP-OJ 平台的 6 个 Supabase Edge Functions（Deno / TypeScript）。

---

## 函数概览

| 函数名 | 路径 | 说明 |
|---|---|---|
| `submit-assignment` | `/functions/v1/submit-assignment` | 校验选课及考试要求并入队异步评测 |
| `grade-callback` | `/functions/v1/grade-callback` | 校验回调签名并将隔离容器评分结果写回数据库 |
| `regrade` | `/functions/v1/regrade` | 教师/助教发起单条提交复判 |
| `regrade-batch` | `/functions/v1/regrade-batch` | 教师/助教批量或整题一键重判 |
| `join-course` | `/functions/v1/join-course` | 邀请码加入班级与名额/身份核对 |
| `publish-assignment` | `/functions/v1/publish-assignment` | 教师/助教发布及维护作业配置（`P001`、`P002`） |

---

## 运行环境变量

函数优先读取运行时 `Deno.env`，未命中时由服务端安全配置表回退读取：

| 变量名 | 说明 | 必须 |
|---|---|---|
| `SUPABASE_URL` | Supabase 项目 URL（运行时自动注入） | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端密钥（运行时自动注入） | 是 |
| `GRADE_CALLBACK_SECRET` | 回调签名校验密钥（HMAC-SHA256） | 是 |
| `GITHUB_TOKEN` | 用于读取评分器版本及触发异步评测任务的访问令牌 | 是 |
| `GITHUB_REPO` | 评测工作流所在仓库（`<owner>/<repo>`） | 是 |

---

## 部署与检查

```bash
# 关联远端项目
supabase login
supabase link --project-ref <your-project-ref>

# 配置运行密钥
supabase secrets set GRADE_CALLBACK_SECRET="<strong-random-secret>"
supabase secrets set GITHUB_TOKEN="<github-token>"
supabase secrets set GITHUB_REPO="<owner>/<repo>"

# 部署全部 Edge Functions
for fn in submit-assignment grade-callback regrade regrade-batch join-course publish-assignment; do
  supabase functions deploy "$fn"
done
```

### 类型检查

```bash
deno check --node-modules-dir=manual \
  supabase/functions/submit-assignment/index.ts \
  supabase/functions/regrade/index.ts \
  supabase/functions/regrade-batch/index.ts \
  supabase/functions/grade-callback/index.ts \
  supabase/functions/join-course/index.ts \
  supabase/functions/publish-assignment/index.ts
```
