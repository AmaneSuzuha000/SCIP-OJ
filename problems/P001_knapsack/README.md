# P001 · 0-1 背包

给定 `n` 件物品，第 `i` 件重量 `weights[i]`、价值 `values[i]`，背包容量 `capacity`。  
选择 0/1 变量使总价值最大且不超过容量。

## 输入 `instance`

```json
{
  "n": 5,
  "weights": [2, 3, 4, 5, 9],
  "values": [3, 4, 8, 8, 10],
  "capacity": 20,
  "optimal_value": 28
}
```

`optimal_value` 仅供判分参考；正式提交时实例由随机种子生成，请用建模求解，不要硬编码。

## 输出

```python
{
  "status": "optimal",
  "objective": float,
  "solution": {0: 0.0, 1: 1.0, ...}  # 或长度为 n 的 list
}
```

## 提示

可用动态规划或枚举验证小规模结果，课程建模使用 PySCIPOpt。
