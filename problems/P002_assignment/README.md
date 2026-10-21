# P002 · 指派问题（Assignment）

把 \(n\) 个工人一对一指派到 \(n\) 个任务，最小化总费用。

## 模型（MIP）

- 决策：\(x_{ij} \in \{0,1\}\) 表示工人 \(i\) 是否做任务 \(j\)
- \(\min \sum_{i,j} c_{ij} x_{ij}\)
- 每个工人恰好一个任务：\(\sum_j x_{ij} = 1\)
- 每个任务恰好一个人：\(\sum_i x_{ij} = 1\)

## `solve(instance)` 契约

输入 `instance`：

| 字段 | 含义 |
|------|------|
| `n` | 规模 |
| `costs` | `n×n` 费用矩阵（整数） |
| `optimal_value` | 仅判题侧使用；学生代码**不应依赖** |

返回：

```python
{"status": "optimal"|"feasible", "objective": float, "solution": ...}
```

`solution` 可为：

- 嵌套列表 `n×n`，或
- 扁平长度 `n*n` 的列表，或
- 字典键 `"i,j"` / `(i,j)`

值为 0/1。`objective` 须等于 \(\sum c_{ij}x_{ij}\)。

## 判分（L1）

性质验证：格式 → 行/列和为 1 → 整数性 → 目标相对最优 gap。多实例**算术平均**，通过线 **90**。
