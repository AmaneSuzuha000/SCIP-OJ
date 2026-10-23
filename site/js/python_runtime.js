/**
 * SCIP-OJ L1 Python runtime.
 *
 * Student code MUST run in a dedicated Worker, never synchronously on the UI
 * thread. A Promise timeout cannot interrupt py.runPython() on the main thread.
 * L1 is untrusted/local practice; authoritative grades use isolated L2.
 */
(function () {
  "use strict";

  // Capture currentScript during evaluation. It is usually null later when
  // the student clicks Run. The Worker lives beside this file under /js/.
  const scriptUrl = document.currentScript?.src ||
    new URL("js/python_runtime.js", window.location.href).href;
  const workerScriptUrl = new URL("pyodide_worker.js", scriptUrl).href;

  let worker = null;
  let workerReady = false;
  let initPromise = null;
  let requestCounter = 0;
  const pending = new Map();

  function failWorker(error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    const old = worker;
    worker = null;
    workerReady = false;
    initPromise = null;
    if (old) {
      try { old.terminate(); } catch (_) { /* worker already gone */ }
    }
    for (const callback of pending.values()) callback.reject(reason);
    pending.clear();
  }

  function initWorker(onProgress) {
    if (worker && workerReady) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = new Promise(function (resolve, reject) {
      let initTimer = null;
      let settled = false;
      function rejectInit(error) {
        if (settled) return;
        settled = true;
        if (initTimer) clearTimeout(initTimer);
        failWorker(error);
        reject(error);
      }

      try {
        if (onProgress) onProgress("正在启动隔离的 Python Web Worker...");
        const created = new Worker(workerScriptUrl);
        worker = created;
        created.onmessage = function (event) {
          if (worker !== created) return;
          const data = event.data || {};
          if (data.type === "init_ok") {
            if (settled) return;
            settled = true;
            if (initTimer) clearTimeout(initTimer);
            workerReady = true;
            if (onProgress) onProgress("Python WASM 运行环境就绪");
            resolve();
            return;
          }
          if (data.type === "init_error") {
            rejectInit(new Error(data.error || "Python Worker 初始化失败"));
            return;
          }
          const callback = pending.get(data.id);
          if (!callback) return;
          if (data.type === "solve_ok") {
            try {
              callback.resolve(JSON.parse(data.resultJson));
            } catch (error) {
              callback.reject(new Error("Python 返回值 JSON 解析失败: " + error.message));
            }
          } else if (data.type === "solve_error") {
            const message = String(data.error || "Python 运行失败");
            callback.reject(new Error(/No module named [\u0027\u0022]?pyscipopt/i.test(message)
              ? "当前 L1 Pyodide 不含 PySCIPOpt；请到顶部 JupyterLab 使用完整的 PySCIPOpt 环境。本地运行未计入正式成绩。"
              : message));
          }
        };
        created.onerror = function () {
          const error = new Error("Python Worker 运行异常，请刷新页面重试");
          if (!workerReady) rejectInit(error);
          else failWorker(error);
        };
        initTimer = setTimeout(function () {
          rejectInit(new Error("Python Worker 初始化超过 120 秒，请检查网络后重试"));
        }, 120000);
        if (onProgress) onProgress("正在加载浏览器 Python WASM（首次需要下载运行时）...");
        created.postMessage({ type: "init" });
      } catch (error) {
        rejectInit(error);
      }
    }).catch(function (error) {
      initPromise = null;
      throw error;
    });
    return initPromise;
  }

  async function ensureReady(onProgress) {
    try {
      await initWorker(onProgress);
      return "worker";
    } catch (error) {
      throw new Error("安全的 Worker 运行环境不可用，已停止本地执行以避免卡死浏览器。请检查网络或在 JupyterLab 中练习。原因：" + (error.message || error));
    }
  }

  async function runSolve(userCode, instance, timeoutSec = 10) {
    await ensureReady();
    if (!worker || !workerReady) throw new Error("Python Worker 未就绪");
    const limit = Number(timeoutSec);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 120) {
      throw new RangeError("Python 运行超时设置须在 0–120 秒内");
    }
    const instanceJson = JSON.stringify(instance);
    return new Promise(function (resolve, reject) {
      const id = ++requestCounter;
      const timer = setTimeout(function () {
        failWorker(new Error("执行超时（超过 " + limit + " 秒），已终止隔离 Worker"));
      }, limit * 1000);
      pending.set(id, {
        resolve: function (result) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(result);
        },
        reject: function (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
      try {
        worker.postMessage({ type: "solve", id, code: userCode, instanceJson });
      } catch (error) {
        failWorker(error);
      }
    });
  }

  window.ScipOJRuntime = {
    ensureReady,
    runSolve,
    isReady: function () { return workerReady && !!worker; }
  };
})();
