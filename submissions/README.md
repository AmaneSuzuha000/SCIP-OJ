# 学生提交目录（L2）

布局：

```
submissions/<github_login>/<PROBLEM_ID>.py
```

- `<PROBLEM_ID>` 与 `meta.json` 的 `id` 一致，如 `P001`、`P002`
- 文件必须提供 `solve(instance) -> {"status","objective","solution"}`

打开 PR 后由 `.github/workflows/l2-grade.yml` 自动重判并评论。
