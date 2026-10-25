/** One xeus/PySCIPOpt runtime for course code and notebook views.
 * Browser results are practice only; formal grades use the isolated server.
 */
(function () {
  'use strict';
  const runtimeURL = new URL('../notebooks/lab/index.html', document.currentScript.src);
  let readyApp, frame, appPromise, busy = false, generation = 0, notebook, changed;
  const managedWidgets = new Map();
  function getFrame() {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = '课程建模实验';
      frame.style.cssText = 'width:100%;height:650px;border:0';
      frame.hidden = true;
      frame.src = runtimeURL.href;
      document.getElementById('notebook-host').appendChild(frame);
    }
    return frame;
  }
  function detachNotebook() {
    if (notebook && changed) notebook.content.model.contentChanged.disconnect(changed);
    notebook = changed = null;
  }
  function reset() {
    generation++;
    managedWidgets.clear();
    detachNotebook();
    frame?.remove(); frame = null; appPromise = null; readyApp = null;
    window.dispatchEvent(new Event('scip-runtime-reset'));
  }
  function ensureReady(onProgress) {
    if (appPromise) return appPromise;
    onProgress?.('正在加载建模环境，首次使用需要下载…');
    const f = getFrame(), epoch = generation;
    appPromise = new Promise((resolve, reject) => {
      const started = Date.now();
      const inspect = async () => {
        if (epoch !== generation) return reject(new Error('运行环境已重置'));
        try {
          const app = f.contentWindow?.jupyterapp;
          if (app) {
            let readinessTimer;
            try {
              await Promise.race([
                Promise.all([app.started, app.restored, app.serviceManager.ready]),
                new Promise((_, reject) => { readinessTimer=setTimeout(() => reject(new Error('建模环境初始化超时')),120000); })
              ]);
            } finally { clearTimeout(readinessTimer); }
            // Lite starts before asynchronous kernel providers finish registration.
            await app.serviceManager.kernelspecs.refreshSpecs();
            const specs = app.serviceManager.kernelspecs.specs;
            if (!Object.keys(specs?.kernelspecs || {}).length) {
              if (Date.now() - started > 120000) throw new Error('Python 内核未能加载');
              setTimeout(inspect,150); return;
            }
            if (epoch !== generation) return reject(new Error('运行环境已重置'));
            onProgress?.('建模环境已就绪');
            readyApp = app;
            return resolve(app);
          }
          if (Date.now() - started > 120000) throw new Error('建模环境加载超时，请检查网络后重试');
          setTimeout(inspect, 150);
        } catch (e) { reset(); reject(e); }
      };
      inspect();
    });
    return appPromise;
  }
  function encode(value) {
    return btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), c => String.fromCharCode(c)).join(''));
  }
  async function runSolve(code, instance, seconds = 15) {
    if (busy) throw new Error('请等待当前运行结束');
    busy = true;
    let kernel, timer;
    try {
      const app = await ensureReady();
      const specs = app.serviceManager.kernelspecs.specs;
      const name = Object.keys(specs.kernelspecs).find(n => /xpython|xeus/i.test(n)) || specs.default;
      const execution = (async () => {
        const epoch = generation;
        kernel = await app.serviceManager.kernels.startNew({name});
        if (epoch !== generation) { await kernel.shutdown(); throw new Error('运行已取消'); }
        const payload = encode({code, instance});
        const source = `import json as __j, base64 as __b\n__p=__j.loads(__b.b64decode('${payload}'))\n__scope={'__name__':'__student__'}\nexec(compile(__p['code'], 'solution.py', 'exec'), __scope)\n__scip_result=__scope['solve'](__p['instance'])`;
        const future = kernel.requestExecute({code:source,stop_on_error:true,store_history:false,user_expressions:{result:"__import__('base64').b64encode(__import__('json').dumps(__scip_result,allow_nan=False).encode()).decode()"}});
        const reply = await future.done;
        if (reply.content.status !== 'ok') throw new Error(reply.content.evalue || '代码运行失败');
        const result = reply.content.user_expressions.result;
        if (result.status !== 'ok') throw new Error(result.evalue || '返回值不能转换为 JSON');
        const encoded = result.data['text/plain'];
        if (!/^['"][A-Za-z0-9+/=]*['"]$/.test(encoded)) throw new Error('返回值格式错误');
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.slice(1,-1)), c=>c.charCodeAt(0))));
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { reset(); reject(new Error('运行超时，环境已重置；作业代码已保留。')); }, Math.max(.01, Math.min(Number(seconds) || 15, 60))*1000);
      });
      return await Promise.race([execution, timeout]);
    } finally {
      clearTimeout(timer);
      // A timed-out iframe is destroyed, which terminates its kernel workers.
      if (frame && kernel) kernel.shutdown().catch(()=>{});
      busy = false;
    }
  }
  function readCode() {
    const cells = notebook?.content.model.toJSON().cells || [];
    const sources = cells.filter(c=>c.cell_type==='code' && c.metadata?.tags?.includes('submission')).map(c=>Array.isArray(c.source)?c.source.join(''):c.source);
    if (sources.length !== 1) throw new Error('请保留唯一的作业代码单元（submission）');
    return sources[0];
  }
  async function openNotebook(id, code, instance, onChange) {
    const app = await ensureReady();
    detachNotebook();
    const contents = app.serviceManager.contents;
    const path = `SCIP_${id}_assignment.ipynb`;
    const specs = app.serviceManager.kernelspecs.specs;
    const name = Object.keys(specs.kernelspecs).find(n=>/xpython|xeus/i.test(n)) || specs.default;
    const model = {nbformat:4,nbformat_minor:5,metadata:{kernelspec:{name,display_name:'Python · PySCIPOpt',language:'python'},scip_oj:{problem_id:id}},cells:[
      {cell_type:'markdown',metadata:{},source:`# ${id} 课程作业\n作业代码单元与代码视图同步。实验输出不计入正式成绩。`},
      {cell_type:'code',metadata:{tags:['submission']},execution_count:null,outputs:[],source:code},
      {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:`import json\ninstance = json.loads(${JSON.stringify(JSON.stringify(instance))})\nsolve(instance)`}
    ]};
    // Save/close the previous widget before replacing its content from the canonical draft.
    const old = managedWidgets.get(path);
    if (old && !old.isDisposed) { await old.context.save(); old.dispose(); }
    await contents.save(path,{type:'notebook',format:'json',content:model});
    notebook = await app.commands.execute('docmanager:open',{path,factory:'Notebook'});
    await notebook.context.ready;
    managedWidgets.set(path,notebook);
    changed = () => { try { onChange(readCode(),null); } catch(e) { onChange(null,e); } };
    notebook.content.model.contentChanged.connect(changed);
    getFrame().hidden = false;
    return notebook;
  }
  function hideNotebook() { if (frame) frame.hidden = true; }
  window.ScipOJRuntime = {ensureReady,runSolve,openNotebook,readCode,hideNotebook,detachNotebook,reset,isReady:()=>!!readyApp};
})();
