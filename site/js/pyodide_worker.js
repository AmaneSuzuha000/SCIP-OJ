// Dedicated Web Worker for running student Python code in Pyodide WASM.

let pyodide = null;
let harnessInitialized = false;

const PYODIDE_BASE_URLS = [
  "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
  "https://fastly.jsdelivr.net/pyodide/v0.26.4/full/"
];

async function initPyodideWorker() {
  let lastError = null;
  for (const baseUrl of PYODIDE_BASE_URLS) {
    try {
      importScripts(baseUrl + "pyodide.js");
      if (typeof loadPyodide !== "function") {
        throw new Error("loadPyodide is not defined");
      }
      pyodide = await loadPyodide({ indexURL: baseUrl });
      pyodide.runPython(`
import json

def __run_student_solve__(code_str, inst_json):
    user_ns = {"__name__": "__main__"}
    exec(code_str, user_ns)
    if "solve" not in user_ns or not callable(user_ns["solve"]):
        raise NameError("代码中未找到 def solve(instance): 函数定义，请按题目模板实现。")
    inst = json.loads(inst_json)
    res = user_ns["solve"](inst)
    if not isinstance(res, dict):
        raise TypeError(f"solve(instance) 的返回值必须是 Python 字典 dict，实际得到 {type(res).__name__}")
    return json.dumps(res)
`);
      harnessInitialized = true;
      return;
    } catch (err) {
      console.warn("Pyodide worker init failed from " + baseUrl, err);
      lastError = err;
    }
  }
  throw lastError || new Error("Failed to initialize Pyodide in worker");
}

self.onmessage = async function (e) {
  const { type, id, code, instanceJson } = e.data || {};
  if (type === "init") {
    try {
      if (!pyodide) {
        await initPyodideWorker();
      }
      postMessage({ type: "init_ok" });
    } catch (err) {
      postMessage({ type: "init_error", error: String(err?.message || err) });
    }
    return;
  }

  if (type === "solve") {
    try {
      if (!pyodide || !harnessInitialized) {
        await initPyodideWorker();
      }
      pyodide.globals.set("__code_str__", code);
      pyodide.globals.set("__inst_json__", instanceJson);
      const outJson = pyodide.runPython("__run_student_solve__(__code_str__, __inst_json__)");
      pyodide.globals.delete("__code_str__");
      pyodide.globals.delete("__inst_json__");
      postMessage({ type: "solve_ok", id, resultJson: outJson });
    } catch (err) {
      const msg = String(err?.message || err);
      let formattedMsg = msg;
      if (msg.includes("No module named 'pyscipopt'") || msg.includes("No module named pyscipopt")) {
        formattedMsg = "缺少模块 pyscipopt：当前纯 Python Web 评测环境未包含 C 扩展库。本题若使用了 PySCIPOpt，请在顶部「JupyterLab (PySCIPOpt)」打开并测试；当前页面模板提供纯 Python / DP 算法，可直接运行评分。";
      }
      postMessage({ type: "solve_error", id, error: formattedMsg });
    }
  }
};
