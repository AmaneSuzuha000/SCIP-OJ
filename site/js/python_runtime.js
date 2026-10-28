/* Portal adapter: Jupyter objects stay in the iframe; only scoped messages cross. */
(() => {
 'use strict';
 const url = new URL('../notebooks/lab/index.html', document.currentScript.src);
 url.searchParams.set('scip-runtime', 'prewarm3');
 let frame, port, connection, preparation, busy = false, sequence = 0, epoch = 0;
 let active = null, source = null, invalid = null, rejectConnection, connectionTimer;
 let status = {phase:'idle', error:null};
 const pending = new Map();
 function publish(phase, error = null) {
  status = {phase, error};
  window.dispatchEvent(new Event('scip-runtime-state'));
 }
 function cancelled() { const error = Error('Notebook 打开已取消'); error.code = 'NOTEBOOK_CANCELLED'; return error; }
 function detachNotebook() {
  active = null; source = null; invalid = null;
  if (port) rpc('detach', [], 5000).promise.catch(() => {});
 }
 function reset(reason = Error('运行环境已重置')) {
  const restart = status.phase === 'running' || status.phase === 'ready';
  epoch++; active = null; source = null; invalid = null; preparation = null;
  clearTimeout(connectionTimer); rejectConnection?.(reason); rejectConnection = null;
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(reason); }
  pending.clear(); port?.close(); port = null; frame?.remove(); frame = null; connection = null;
  publish('error', reason.message);
  window.dispatchEvent(new Event('scip-runtime-reset'));
  if (restart) setTimeout(() => prewarm().catch(() => {}), 0);
 }
 function rpc(method, args = [], timeout = 120000, progress) {
  const id = String(++sequence);
  const promise = new Promise((resolve, reject) => {
   const timer = setTimeout(() => {
    pending.delete(id);
    const error = Error(method === 'run' ? '运行超时，作业代码已保留。' : '运行环境准备超时，请重试。');
    reset(error); reject(error);
   }, timeout);
   pending.set(id, {resolve, reject, timer, progress});
   port.postMessage({version:1, id, method, args});
  });
  return {id, promise};
 }
 function connect() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
   const owned = document.createElement('iframe'); frame = owned;
   owned.title = '课程建模实验'; owned.style.cssText = 'width:100%;height:650px;border:0'; owned.hidden = true;
   rejectConnection = reject;
   connectionTimer = setTimeout(() => {
    if (frame === owned) reset(Error('运行环境加载超时，请重试。'));
   }, 120000);
   owned.addEventListener('load', () => {
    if (frame !== owned) return;
    clearTimeout(connectionTimer); rejectConnection = null;
    const channel = new MessageChannel(); port = channel.port1;
    port.onmessage = ({data}) => {
     if (frame !== owned || data?.version !== 1) return;
     if (data.type === 'reset') { reset(Error(data.message || '运行环境已重置，作业代码已保留。')); return; }
     if (data.type === 'progress') {
      if (typeof data.message === 'string') pending.get(data.id)?.progress?.(data.message);
      return;
     }
     if (data.type === 'source') {
      if (!active || data.context !== active.id) return;
      invalid = data.error ? Error(data.error) : null;
      if (!invalid && typeof data.code === 'string') source = data.code;
      active.changed(source, invalid); return;
     }
     if (data.type !== 'reply') return;
     const item = pending.get(data.id); if (!item) return;
     pending.delete(data.id); clearTimeout(item.timer);
     if (data.error) { const error = Error(data.error.message); error.code = data.error.code; item.reject(error); }
     else item.resolve(data.result);
    };
    port.start();
    owned.contentWindow.postMessage({channel:'scip-oj-notebook', version:1}, url.origin, [channel.port2]);
    resolve();
   }, {once:true});
   owned.src = url.href;
   document.getElementById('notebook-host').appendChild(owned);
  });
  return connection;
 }
 function prewarm() {
  if (status.phase === 'ready' || status.phase === 'running') return Promise.resolve();
  if (preparation) return preparation;
  const ownedEpoch = epoch;
  publish('preparing');
  preparation = (async () => {
   try {
    await connect(); await rpc('prepare', [], 245000).promise;
    if (ownedEpoch !== epoch) throw cancelled();
    publish('ready');
   } catch (error) {
    if (ownedEpoch === epoch) reset(error);
    throw error;
   } finally {
    if (ownedEpoch === epoch) preparation = null;
   }
  })();
  return preparation;
 }
 async function runSolve(code, instance, seconds = 15, progress) {
  if (busy) throw Error('请等待当前运行结束');
  busy = true;
  const ownedEpoch = epoch;
  try {
   await prewarm();
   if (ownedEpoch !== epoch) throw cancelled();
   publish('running');
   return await rpc('run', [code, instance, seconds], (Math.min(Math.max(Number(seconds) || 15, .01), 60) + 5) * 1000, progress).promise;
  } finally {
   busy = false;
   if (ownedEpoch === epoch && frame) {
    publish('idle');
    prewarm().catch(() => {});
   }
  }
 }
 async function openNotebook(id, code, instance, onChange) {
  detachNotebook(); const marker = {id:null, changed:onChange}; active = marker;
  await prewarm(); if (active !== marker) throw cancelled();
  const request = rpc('open', [id, code, instance]); marker.id = request.id;
  await request.promise; if (active !== marker) throw cancelled(); frame.hidden = false;
 }
 function readCode() {
  if (invalid) throw invalid;
  if (source === null) throw Error('请保留唯一的作业代码单元（submission）');
  return source;
 }
 async function openStudyNotebook(path) {
  detachNotebook();const marker={id:null,changed:()=>{}};active=marker;
  await prewarm();if(active!==marker)throw cancelled();
  const request=rpc('study',[path]);marker.id=request.id;
  await request.promise;if(active!==marker)throw cancelled();frame.hidden=false;
 }
 function hideNotebook() { if (frame) frame.hidden = true; }
 window.ScipOJRuntime = {prewarm, ensureReady:prewarm, runSolve, openNotebook, openStudyNotebook, readCode,
  detachNotebook, hideNotebook, reset, isReady:() => status.phase === 'ready', getStatus:() => ({...status})};
})();
