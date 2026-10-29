/* Preserve admission, the auth client and the Python frame during portal navigation. */
(() => {
 'use strict';
 const base=new URL('../',document.currentScript.src);
 const pages=new Set(['index.html','teacher.html','doc.html','case-studio.html','inventory-lab.html','flow-lab.html','official-examples.html']);
 const singletons=/\/(?:navigation|journey|page-session|access|platform|python_runtime|grading-state|request-keys|grading-api|marked\.min|purify\.min|markdown|knapsack_judge|assignment_judge|simulation-core|inventory-core|flow-core)\.js$|\/config\.js$|\/supabase\.min\.js$|\/codemirror\.min\.js$|\/mode\/python\/python\.min\.js$/;
 const loaded=new Set();
 let cleanups=[],controller=new AbortController(),mounting=false,startup=Promise.resolve();
 function onDispose(fn){cleanups.push(fn);return fn;}
 async function dispose(){
  controller.abort();
  window.dispatchEvent(new Event('scipoj:page-dispose'));
  for(const fn of cleanups.splice(0).reverse())await fn();
  controller=new AbortController();startup=Promise.resolve();
 }
 function supported(url){return url.origin===base.origin&&url.pathname.startsWith(base.pathname)&&pages.has(url.pathname.slice(base.pathname.length)||'index.html');}
 async function prepare(url){
  if(!supported(url))return null;
  const response=await fetch(url.pathname+url.search,{signal:AbortSignal.timeout(15000),credentials:'same-origin'});
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('页面加载失败，请重试。');
  const doc=new DOMParser().parseFromString(await response.text(),'text/html');
  const template=doc.getElementById('site-protected-content');
  if(!doc.body.dataset.pageName||!pages.has(doc.body.dataset.pageName))throw Error('页面内容不完整，请刷新后重试。');
  const fragment=template?template.content:doc.body;
  const scripts=[...fragment.querySelectorAll('script')];scripts.forEach(node=>node.remove());
  const styles=[...doc.head.querySelectorAll('link[rel="stylesheet"],style')].map(original=>{
   const node=original.cloneNode(true);node.media='not all';
   if(node.tagName==='LINK')node.href=new URL(original.getAttribute('href'),url).href;
   return {node,media:original.media||'all'};
  });
  // Load styles before removing the current page, so failed navigation keeps it usable.
  try{await Promise.all(styles.map(({node})=>new Promise((resolve,reject)=>{
   if(node.tagName==='LINK'){node.onload=resolve;node.onerror=()=>reject(Error('页面样式加载失败，请重试。'));}
   document.head.appendChild(node);if(node.tagName==='STYLE')resolve();
  })));}catch(error){styles.forEach(({node})=>node.remove());throw error;}
  return {doc,fragment,scripts,styles,discard(){styles.forEach(({node})=>node.remove());}};
 }
 async function mount(page){
  mounting=true;
  try{
   for(const script of document.scripts)if(script.src)loaded.add(new URL(script.src).pathname);
   await dispose();
   if(window.ScipOJAccess?.isAuthorized?.()===false)throw Error('访问权限已更新，请重新登录。');
   let park=document.getElementById('scip-session-runtime');
   if(!park){park=document.createElement('div');park.id='scip-session-runtime';park.hidden=true;park.dataset.scipPersistent='';document.body.appendChild(park);}
   const host=document.getElementById('notebook-host');
   if(host){
    // appendChild reloads an iframe. moveBefore preserves its browsing context.
    if(park.moveBefore)park.moveBefore(host,null);
    else{window.ScipOJRuntime?.reset(Error('页面已切换'));host.remove();}
   }
   for(const node of [...document.body.childNodes])if(node!==park)node.remove();
   for(const attr of [...document.body.attributes])document.body.removeAttribute(attr.name);
   for(const attr of page.doc.body.attributes)document.body.setAttribute(attr.name,attr.value);
   document.body.insertBefore(document.importNode(page.fragment,true),park);
   const placeholder=document.querySelector('main #notebook-host'),kept=park.querySelector('#notebook-host');
   if(placeholder&&kept&&placeholder.parentElement.moveBefore){placeholder.parentElement.moveBefore(kept,placeholder);placeholder.remove();}
   for(const node of [...document.head.querySelectorAll('link[rel="stylesheet"],style')])if(!page.styles.some(style=>style.node===node))node.remove();
   page.styles.forEach(({node,media})=>{node.media=media;node.onload=node.onerror=null;});
   document.title=page.doc.title;
   window.ScipOJJourney.preparePage();
   const deferred=page.scripts.filter(node=>node.src&&node.defer);
   for(const original of [...page.scripts.filter(node=>!deferred.includes(node)),...deferred]){
    const src=original.getAttribute('src'),path=src&&new URL(src,location.href).pathname;
    if(path&&singletons.test(path)&&loaded.has(path))continue;
    const script=document.createElement('script');script.async=false;
    for(const attr of original.attributes)if(!['async','defer'].includes(attr.name))script.setAttribute(attr.name,attr.value);
    if(src){await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(Error('页面脚本加载失败，请刷新重试。'));document.body.appendChild(script);});loaded.add(path);}
    else{script.textContent=original.textContent;document.body.appendChild(script);}
   }
   await startup;
   window.ScipOJPlatform?.updateAuthUI();
  }catch(error){
   const alert=document.createElement('div');alert.setAttribute('role','alert');alert.className='fail';
   alert.append(document.createTextNode(error.message+' '));
   const retry=document.createElement('button');retry.textContent='重新加载页面';
   retry.onclick=()=>{window.ScipOJJourney.allowUnload();location.reload();};alert.append(retry);document.body.prepend(alert);
   throw error;
  }finally{mounting=false;document.dispatchEvent(new Event('scipoj:page-ready'));}
 }
 window.ScipOJPageSession={supported,prepare,mount,onDispose,ready:promise=>{startup=promise;},get signal(){return controller.signal;},get mounting(){return mounting;}};
})();
