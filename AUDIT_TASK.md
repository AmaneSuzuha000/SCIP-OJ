# SCIP-OJ 整仓完美审计与优化研究（2026-10-28）

工作目录：`/workspace/SCIP-OJ-push`（已与 `origin/main` @ `4ed981b` 同步）。
线上：https://AmaneSuzuha000.github.io/SCIP-OJ/  
仓库：https://github.com/AmaneSuzuha000/SCIP-OJ  
Supabase：scip-oj / `epblgjexfkspizbbelbq`（只读核对；**不要**改线上库 / **不要** deploy Edge / **不要** git push）

## 产品目标（审计时以此为准）
西南交大「系统建模与优化」课程全链路作业平台：
- 学生：GitHub OAuth → Web 写代码 → L1 练习评分（不计正式分）→ 正式提交 → 服务端权威评测入库 → 看历史
- 教师：花名册、邀请码、发作业、成绩表、证据台、复判、导出
- 栈：GitHub Pages + 模块化前端（`site/src/**`）+ JupyterLite/Notebook bridge + Supabase Auth/Postgres/RLS/Edge + Actions 判题（含 sandbox 隔离）

## 相对旧版的重要结构变化（必须按新结构审，勿按已删除文件下结论）
- 前端已从单体 `site/js/{app,platform,teacher}.js` 迁到 `site/src/{platform,student,teacher}/**` + assemble/build
- 新增：`notebook/` 消息桥、`judge/sandbox*`、`scripts/grading_transport.py`、`tests/**` 大量契约测试
- migrations 已到 `007`…`014` 与 `20261026054644_reliable_grading_lifecycle.sql`
- 已有文档：`docs/ARCHITECTURE.md`、`GRADING_CONTRACT.md`、`ANTI_CHEATING_*`、`SECURITY_VALIDATION_V3..V6`、`PRODUCT_READINESS_AUDIT.md`、`RELEASE_20261024.md`
  - 先读这些作为基线，但**不要照抄当结论**；对代码与测试做独立验证，标出「已宣称但未证实 / 已证实 / 仍缺口」

## 已知已修（勿当新发现，但要回归是否复发）
- 教师成绩表 TDZ / 缓存穿透（`e8571dc`）
- 教师试交被 `course_gradebook` 滤掉（`007` / `ca9432e`）
- 若干 UI/安全/邀请码并发修复（见近期 commit 历史）

## 审计范围（必须全覆盖）
1. **架构与构建**：`scripts/assemble_site.py`、`build_portal.mjs`、`package.json`、Pages `deploy.yml`；产物是否与源一致；缓存 bust；密钥是否进静态站
2. **学生端** `site/src/student/**` + workbench/runtime：认证、学号、选课、L1 vs 正式提交边界、提交轮询、排行榜、考试诚信 `exam-integrity.js`
3. **教师端** `site/src/teacher/**`：成绩表/证据/花名册/邀请码/发作业；试交标记；空态与错误可见性
4. **平台层** `site/src/platform/**` + `grading-api.js` / `grading-state.js`：RPC、错误处理、竞态
5. **Supabase**：migrations 001–014 + lifecycle；RLS、SECURITY DEFINER、RPC、邀请码原子性、提交配额、默认权限；与 `tests/test_*security*.py` 对照
6. **Edge Functions**：submit / callback / regrade* / join / publish / `_shared`；HMAC、幂等、僵尸 queued、错误泄露
7. **判题** `judge/**` + `problems/**`：L1/L2 一致性、sandbox 隔离、私有测例、防作弊/相似度 `scripts/audit_similarity.py`
8. **CI**：`grade-submission`、`judge-regression`、`recover-gradings`、`ui-visual-smoke`；权限与密钥
9. **产品/文档一致性**：指南是否仍暴露实现细节或过时路径；与 `PRODUCT_READINESS_AUDIT` 对照遗留项
10. **优化研究**（单独一章）：性能（成绩表 RPC、轮询）、可观测性、可维护性（模块边界）、课程运营（考试模式、配额、复判）、路线图优先级（P0–P3 落地顺序与工作量粗估）

## 方法
- 先读 ARCHITECTURE / GRADING_CONTRACT / 最近 SECURITY_VALIDATION / 关键测试，再按模块读代码
- 能跑的本地测试尽量跑（`node`/`python` 单测）；失败如实记录
- **禁止编造**未读文件内容或未跑测试的结果
- P0/P1 能安全本地修的直接改并 `git commit`（**禁止 push**）；P2/P3 写入报告

## 交付
1. 主报告：`/workspace/SCIP-OJ-push/docs/整仓审计优化报告-20261028.md`
2. 副本：`/workspace/scip-oj-full-audit-20261028/REPORT.md` 与 `/tmp/scip-oj-full-audit-report.md`
3. 报告结构（中文）：
   - 执行摘要（现状成熟度一句话 + Top 风险）
   - 范围与方法
   - 发现清单（P0/P1/P2/P3；每条：位置、现象、根因、证据、建议或已修 commit）
   - 「文档已宣称 vs 代码实测」对照表
   - 优化路线图（按 1 周 / 1 月 / 学期 分层）
   - 已修清单
4. stdout 中文摘要 + 报告路径
