/** One xeus/PySCIPOpt runtime for course code and notebook views.
 * Browser results are practice only; formal grades use the isolated server.
 */
(function () {
  'use strict';
  let readyApp, frame, appPromise, busy = false, generation = 0, notebook, changed;
  const managedWidgets = new Map();
  let notebookRequest = 0, notebookQueue = Promise.resolve();
  let preparedKernel = null;
  // Runs inside the Lite document. Only the host owns the actual iframe.
  function getFrame() {
    if (!frame) frame = {contentWindow:window,remove(){},hidden:true};
    return frame;
  }
  function detachNotebook() {
    notebookRequest++;
    disconnectNotebook();
  }
  function disconnectNotebook() {
    if (notebook && changed) notebook.content.model.contentChanged.disconnect(changed);
    notebook = changed = null;
  }
  function reset(reason) {
    generation++;
    notebookQueue = Promise.resolve();
    managedWidgets.clear();
    preparedKernel = null;
    detachNotebook();
    frame?.remove(); frame = null; appPromise = null; readyApp = null;
    const event = new Event('scip-runtime-reset');
    event.message = reason?.message;
    window.dispatchEvent(event);
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
        } catch (e) { if (epoch === generation) reset(e); reject(e); }
      };
      inspect();
    });
    return appPromise;
  }
  function encode(value) {
    return btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), c => String.fromCharCode(c)).join(''));
  }
  function bounded(task, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new Error(message); reset(error); reject(error); }, milliseconds);
    });
    return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
  }
  function prepare() {
    if (preparedKernel) return preparedKernel;
    const epoch = generation;
    preparedKernel = (async () => {
      let kernel;
      try {
        const app = await ensureReady();
        const specs = app.serviceManager.kernelspecs.specs;
        const name = Object.keys(specs.kernelspecs).find(n => /xpython|xeus/i.test(n));
        if (!name) throw new Error('课程 Python 内核不可用');
        await bounded((async () => {
          kernel = await app.serviceManager.kernels.startNew({name});
          if (epoch !== generation) { await kernel.shutdown(); throw new Error('运行环境已重置'); }
          await kernel.info;
          if (epoch !== generation) throw new Error('运行环境已重置');
          // Verify the actual Python/SCIP installation, not just a registered spec.
          const probe = kernel.requestExecute({store_history:false,stop_on_error:true,code:
            "from pyscipopt import Model as __SCIP_Check\n__scip_check=__SCIP_Check()\n__scip_check.hideOutput()\n__scip_x=__scip_check.addVar(lb=0,ub=1,obj=1)\n__scip_check.setMaximize()\n__scip_check.optimize()\nassert str(__scip_check.getStatus()) == 'optimal' and abs(__scip_check.getObjVal()-1) < 1e-6\ndel __scip_x, __scip_check, __SCIP_Check"});
          const reply = await probe.done;
          if (reply.content.status !== 'ok') throw new Error('Python / SCIP 环境检测失败：' + (reply.content.evalue || '求解器不可用'));
        })(), 120000, '运行环境准备超时，请重试。');
        if (epoch !== generation) throw new Error('运行环境已重置');
        return kernel;
      } catch (error) {
        kernel?.shutdown().catch(()=>{});
        if (epoch === generation) reset(error);
        throw error;
      }
    })();
    return preparedKernel;
  }
  async function runSolve(code, instance, seconds = 15, onProgress) {
    if (busy) throw new Error('请等待当前运行结束');
    busy = true;
    let kernel;
    try {
      const epoch = generation;
      const prepared = prepare();
      kernel = await prepared;
      if (epoch !== generation) throw new Error('运行已取消');
      if (preparedKernel === prepared) preparedKernel = null;
      onProgress?.('正在执行代码…');
      const execution = (async () => {
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
      return await bounded(execution, Math.max(.01, Math.min(Number(seconds) || 15, 60))*1000,
        '运行超时，环境已重置；作业代码已保留。');
    } finally {
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
  function openNotebook(id, code, instance, onChange) {
    detachNotebook();
    const request = notebookRequest, epoch = generation;
    const check = () => {
      if (request !== notebookRequest || epoch !== generation) {
        const error = new Error('Notebook 打开已取消');
        error.code = 'NOTEBOOK_CANCELLED';
        throw error;
      }
    };
    // Serialize file operations: a cancelled save cannot overwrite a newer open.
    const task = notebookQueue.catch(()=>{}).then(()=>openNotebookSession(id,code,instance,onChange,check));
    notebookQueue = task.catch(()=>{});
    return task;
  }
  async function openNotebookSession(id, code, instance, onChange, check) {
    check();
    const app = await ensureReady();
    check();
    const contents = app.serviceManager.contents;
    const path = `SCIP_${id}_assignment.ipynb`;
    const specs = app.serviceManager.kernelspecs.specs;
    const name = Object.keys(specs.kernelspecs).find(n=>/xpython|xeus/i.test(n)) || specs.default;
    let model = {nbformat:4,nbformat_minor:5,metadata:{kernelspec:{name,display_name:'Python · PySCIPOpt',language:'python'},scip_oj:{problem_id:id}},cells:[
      {cell_type:'markdown',metadata:{},source:`# ${id} 课程作业\n作业代码单元与代码视图同步。实验输出不计入正式成绩。`},
      {cell_type:'code',metadata:{tags:['submission']},execution_count:null,outputs:[],source:code},
      {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:`import json\ninstance = json.loads(${JSON.stringify(JSON.stringify(instance))})\nsolve(instance)`}
    ]};
    // Save/close the previous widget before replacing its content from the canonical draft.
    const old = managedWidgets.get(path);
    if (old && !old.isDisposed) { await old.context.save(); check(); old.dispose(); }
    try {
      const existing = await contents.get(path,{content:true});
      check();
      if (existing.type !== 'notebook' || !Array.isArray(existing.content?.cells)) throw new Error('作业文件格式错误');
      model = existing.content;
      const submissions = model.cells.filter(c=>c.cell_type==='code' && c.metadata?.tags?.includes('submission'));
      if (submissions.length === 1) {
        submissions[0].source = code;
        submissions[0].outputs = []; submissions[0].execution_count = null;
      }
    } catch (e) {
      if (e.response?.status !== 404) throw e;
    }
    check();
    await contents.save(path,{type:'notebook',format:'json',content:model});
    check();
    const widget = await app.commands.execute('docmanager:open',{path,factory:'Notebook'});
    try { await widget.context.ready; check(); }
    catch (error) { widget.dispose(); throw error; }
    notebook = widget;
    managedWidgets.set(path,notebook);
    changed = () => {
      if (notebook !== widget) return;
      try { check(); } catch { return; }
      try { onChange(readCode(),null); } catch(e) { onChange(null,e); }
    };
    notebook.content.model.contentChanged.connect(changed);
    changed();
    app.shell.collapseLeft?.();
    app.shell.collapseRight?.();
    getFrame().hidden = false;
    getFrame().contentWindow.dispatchEvent(new Event('resize'));
    return notebook;
  }
  function hideNotebook() { if (frame) frame.hidden = true; }
  function openStudyNotebook(path) {
    detachNotebook();
    const request=notebookRequest, epoch=generation;
    const check=()=>{if(request!==notebookRequest||epoch!==generation){const e=new Error('Notebook 打开已取消');e.code='NOTEBOOK_CANCELLED';throw e;}};
    const task=notebookQueue.catch(()=>{}).then(async()=>{
      const app=await ensureReady();check();
      const widget=await app.commands.execute('docmanager:open',{path,factory:'Notebook'});
      if(!widget)throw new Error('无法打开该课程 Notebook');
      try {await widget.context.ready;check();} catch(error){widget.dispose();throw error;}
      app.shell.collapseLeft?.();app.shell.collapseRight?.();
      window.dispatchEvent(new Event('resize'));
    });
    notebookQueue=task.catch(()=>{});return task;
  }
  window.ScipOJRuntime = {ensureReady,prepare,runSolve,openNotebook,openStudyNotebook,readCode,hideNotebook,detachNotebook,reset,isReady:()=>!!readyApp};
})();
