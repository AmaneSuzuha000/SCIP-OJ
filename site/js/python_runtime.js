/**
 * python_runtime.js
 * In-browser execution engine for student Python code in SCIP-OJ.
 * Runs code via WebAssembly (Pyodide Worker with main-thread fallback).
 */
(function () {
  let worker = null;
  let workerReady = false;
  let workerInitPromise = null;
  let reqCounter = 0;
  const pendingRequests = new Map();

  // Fallback in-thread Pyodide state
  let inThreadPyodide = null;
  let inThreadInitPromise = null;
  let inThreadHarnessReady = false;

  const PYODIDE_BASE_URLS = [
    "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    "https://fastly.jsdelivr.net/pyodide/v0.26.4/full/"
  ];

  function getWorkerScriptUrl() {
    return new URL("pyodide_worker.js", document.currentScript ? document.currentScript.src : window.location.href).href;
  }

  function initWorker(onProgress) {
    if (workerReady && worker) return Promise.resolve();
    if (workerInitPromise) return workerInitPromise;

    workerInitPromise = new Promise((resolve, reject) => {
      try {
        if (onProgress) onProgress("正在启动 Web Worker Python 运行沙箱...");
        const workerUrl = getWorkerScriptUrl();
        worker = new Worker(workerUrl);

        worker.onmessage = function (e) {
          const { type, id, resultJson, error } = e.data || {};
          if (type === "init_ok") {
            workerReady = true;
            if (onProgress) onProgress("Python WASM 运行环境就绪");
            resolve();
            return;
          }
          if (type === "init_error") {
            workerReady = false;
            reject(new Error(error || "Worker init error"));
            return;
          }
          if (type === "solve_ok" || type === "solve_error") {
            const cb = pendingRequests.get(id);
            if (cb) {
              pendingRequests.delete(id);
              if (type === "solve_ok") {
                try {
                  cb.resolve(JSON.parse(resultJson));
                } catch (pe) {
                  cb.reject(new Error("JSON 解析返回值失败: " + pe.message));
                }
              } else {
                cb.reject(new Error(error || "运行错误"));
              }
            }
          }
        };

        worker.onerror = function (err) {
          console.warn("Worker error:", err);
          if (!workerReady) {
            reject(new Error("Web Worker 创建或运行异常"));
          }
        };

        if (onProgress) onProgress("正在下载并初始化 Python WASM 解释器（首次约 6MB）...");
        worker.postMessage({ type: "init" });
      } catch (err) {
        reject(err);
      }
    });

    return workerInitPromise;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => resolve();
      s.onerror = (e) => reject(new Error("脚本加载失败: " + url));
      document.head.appendChild(s);
    });
  }

  async function initInThread(onProgress) {
    if (inThreadPyodide) return inThreadPyodide;
    if (inThreadInitPromise) return inThreadInitPromise;

    inThreadInitPromise = (async () => {
      let lastErr = null;
      for (const baseUrl of PYODIDE_BASE_URLS) {
        try {
          if (onProgress) onProgress("正在通过主线程加载 Pyodide CDN...");
          await loadScript(baseUrl + "pyodide.js");
          if (typeof window.loadPyodide !== "function") {
            throw new Error("loadPyodide 未定义");
          }
          if (onProgress) onProgress("正在初始化 Python 解释器...");
          inThreadPyodide = await window.loadPyodide({ indexURL: baseUrl });
          return inThreadPyodide;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("主线程 Pyodide 初始化失败");
    })();

    return inThreadInitPromise;
  }

  async function ensureReady(onProgress) {
    // Try Worker first
    try {
      await initWorker(onProgress);
      return "worker";
    } catch (workerErr) {
      console.warn("Worker 初始化失败，切换为主线程模式:", workerErr);
      if (onProgress) onProgress("Web Worker 不可用，切换至主线程 Python 运行时...");
      await initInThread(onProgress);
      return "main-thread";
    }
  }

  async function runSolve(userCode, instance, timeoutSec = 10) {
    const mode = await ensureReady();
    const instJson = JSON.stringify(instance);

    if (mode === "worker" && worker && workerReady) {
      return new Promise((resolve, reject) => {
        const id = ++reqCounter;
        let timer = null;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          pendingRequests.delete(id);
        };

        timer = setTimeout(() => {
          cleanup();
          try {
            worker.terminate();
          } catch (_) {}
          worker = null;
          workerReady = false;
          workerInitPromise = null;
          reject(new Error(`执行超时（超过 ${timeoutSec} 秒限制）`));
        }, timeoutSec * 1000);

        pendingRequests.set(id, {
          resolve: (res) => {
            cleanup();
            resolve(res);
          },
          reject: (err) => {
            cleanup();
            reject(err);
          },
        });

        worker.postMessage({
          type: "solve",
          id,
          code: userCode,
          instanceJson: instJson,
        });
      });
    }

    // In-thread fallback
    const py = await initInThread();
    if (!inThreadHarnessReady) {
      py.runPython(`
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
      inThreadHarnessReady = true;
    }

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`执行超时（超过 ${timeoutSec} 秒限制）`));
      }, timeoutSec * 1000);
    });

    const executionPromise = (async () => {
      py.globals.set("__code_str__", userCode);
      py.globals.set("__inst_json__", instJson);
      try {
        const outJson = py.runPython("__run_student_solve__(__code_str__, __inst_json__)");
        return JSON.parse(outJson);
      } catch (err) {
        const msg = String(err?.message || err);
        if (msg.includes("No module named 'pyscipopt'") || msg.includes("No module named pyscipopt")) {
          throw new Error("缺少模块 pyscipopt：当前纯 Python Web 评测环境未包含 C 扩展库。本题若使用了 PySCIPOpt，请在顶部「JupyterLab (PySCIPOpt)」打开并测试；当前页面模板提供纯 Python / DP 算法，可直接运行评分。");
        }
        throw new Error(msg);
      } finally {
        py.globals.delete("__code_str__");
        py.globals.delete("__inst_json__");
      }
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  window.ScipOJRuntime = {
    ensureReady,
    runSolve,
    isReady: () => workerReady || !!inThreadPyodide,
  };
})();
