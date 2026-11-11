import {
  loadKernel,
  resetKernelNamespace,
  runCell,
  type KernelProgress,
} from '@/features/notebook/kernel';

export interface SelfTestResult {
  ok: boolean;
  summary: string;
  stdout: string;
  error: string | null;
}

const MARKER = '__SCIP_OJ_SELFTEST__=';

function buildHarness(problemId: string | undefined, code: string): string {
  return [
    'import itertools, json, math',
    '_student_code = ' + JSON.stringify(code),
    '_pid = ' + JSON.stringify(problemId ?? ''),
    '_ns = {"__name__": "submission"}',
    '_report = {"ok": False, "summary": ""}',
    'exec(compile(_student_code, "<submission>", "exec"), _ns)',
    'if "solve" not in _ns or not callable(_ns["solve"]):',
    '    raise ValueError("未找到可调用函数 solve(instance)")',
    '_solve = _ns["solve"]',
    'if _pid == "P001":',
    '    _inst = {"n": 5, "weights": [2, 3, 4, 5, 9], "values": [3, 4, 5, 8, 10], "capacity": 10}',
    '    _opt = max(sum(v*b for v, b in zip(_inst["values"], bits)) for bits in itertools.product((0, 1), repeat=5) if sum(w*b for w, b in zip(_inst["weights"], bits)) <= _inst["capacity"])',
    '    _res = _solve({k: (list(v) if isinstance(v, list) else v) for k, v in _inst.items()})',
    '    assert isinstance(_res, dict), "返回值必须是 dict"',
    '    _sol = _res.get("solution")',
    '    _vec = [float(_sol[i] if i in _sol else _sol.get(str(i), 0.0)) for i in range(5)] if isinstance(_sol, dict) else [float(v) for v in _sol]',
    '    assert len(_vec) == 5, f"solution 长度应为 5，收到 {len(_vec)}"',
    '    assert all(abs(v - round(v)) <= 1e-5 and -1e-5 <= v <= 1 + 1e-5 for v in _vec), "解必须为 0-1 整数"',
    '    _load = sum(_inst["weights"][i] * _vec[i] for i in range(5))',
    '    assert _load <= _inst["capacity"] + 1e-5, f"超出背包容量: {_load} > {_inst[\'capacity\']}"',
    '    _val = sum(_inst["values"][i] * _vec[i] for i in range(5))',
    '    _obj = float(_res["objective"])',
    '    assert math.isfinite(_obj) and abs(_obj - _val) <= 1e-4, f"objective={_obj} 与解价值={_val} 不一致"',
    '    _report["ok"] = abs(_obj - _opt) <= 1e-4',
    '    _report["summary"] = f"教学样例通过（目标={_obj:g}，最优={_opt:g}，载重={_load:g}/10）" if _report["ok"] else f"可行解但未达样例最优（目标={_obj:g}，最优={_opt:g}）"',
    'elif _pid == "P002":',
    '    _inst = {"n": 3, "costs": [[4, 2, 8], [2, 3, 7], [5, 8, 3]]}',
    '    _opt = min(sum(_inst["costs"][i][p[i]] for i in range(3)) for p in itertools.permutations(range(3)))',
    '    _res = _solve({"n": 3, "costs": [row[:] for row in _inst["costs"]]})',
    '    assert isinstance(_res, dict), "返回值必须是 dict"',
    '    _sol = _res.get("solution")',
    '    _mat = [[0.0]*3 for _ in range(3)]',
    '    if isinstance(_sol, dict):',
    '        for i in range(3):',
    '            for j in range(3):',
    '                for k in ((i, j), f"{i},{j}", f"{i}-{j}", i*3+j, str(i*3+j)):',
    '                    if k in _sol:',
    '                        _mat[i][j] = float(_sol[k])',
    '                        break',
    '                else:',
    '                    _r = _sol.get(i, _sol.get(str(i)))',
    '                    if isinstance(_r, dict) and (j in _r or str(j) in _r):',
    '                        _mat[i][j] = float(_r[j] if j in _r else _r[str(j)])',
    '    else:',
    '        _seq = list(_sol)',
    '        if len(_seq) == 3 and all(isinstance(r, (list, tuple)) and len(r) == 3 for r in _seq):',
    '            _mat = [[float(v) for v in r] for r in _seq]',
    '        elif len(_seq) == 9:',
    '            _mat = [[float(_seq[i*3+j]) for j in range(3)] for i in range(3)]',
    '        else:',
    '            raise AssertionError("solution 形状应为 3x3 矩阵或长度为 9 的列表")',
    '    for i in range(3):',
    '        assert all(-1e-5 <= v <= 1 + 1e-5 and abs(v - round(v)) <= 1e-5 for v in _mat[i]), "解矩阵必须为 0-1 整数"',
    '        assert abs(sum(_mat[i]) - 1.0) <= 1e-5, f"第 {i} 行和不为 1"',
    '    for j in range(3):',
    '        assert abs(sum(_mat[i][j] for i in range(3)) - 1.0) <= 1e-5, f"第 {j} 列和不为 1"',
    '    _cost = sum(_inst["costs"][i][j] * _mat[i][j] for i in range(3) for j in range(3))',
    '    _obj = float(_res["objective"])',
    '    assert math.isfinite(_obj) and abs(_obj - _cost) <= 1e-4, f"objective={_obj} 与指派成本={_cost} 不一致"',
    '    _report["ok"] = abs(_obj - _opt) <= 1e-4',
    '    _report["summary"] = f"教学样例通过（成本={_obj:g}，最优={_opt:g}）" if _report["ok"] else f"可行解但未达样例最优（成本={_obj:g}，最优={_opt:g}）"',
    'else:',
    '    _report["ok"] = True',
    '    _report["summary"] = "语法检查通过，已定义 solve(instance) 函数"',
    'print(' + JSON.stringify(MARKER) + ' + json.dumps(_report, ensure_ascii=False))',
  ].join('\n');
}

export async function runLocalSelfTest(
  problemId: string | undefined,
  code: string,
  onProgress?: (progress: KernelProgress) => void,
): Promise<SelfTestResult> {
  await resetKernelNamespace();
  const kernel = await loadKernel(onProgress);
  const res = await runCell(kernel, buildHarness(problemId, code));
  const lines = res.stdout ? res.stdout.split('\n') : [];
  let markerReport: { ok?: boolean; summary?: string } | null = null;
  const userLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(MARKER)) {
      try {
        markerReport = JSON.parse(line.slice(MARKER.length)) as { ok?: boolean; summary?: string };
      } catch {
        // ignore malformed marker
      }
    } else if (line !== '') {
      userLines.push(line);
    }
  }
  const stdout = userLines.join('\n');
  if (!res.ok) {
    return {
      ok: false,
      summary: '本地自测未通过',
      stdout,
      error: res.error ?? '执行异常',
    };
  }
  return {
    ok: Boolean(markerReport?.ok),
    summary: markerReport?.summary || '自测运行完成',
    stdout,
    error: null,
  };
}
