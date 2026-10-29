/* Shared navigation transaction and account-scoped recovery for every page. */
(() => {
    'use strict';
    const nav = window.ScipOJNavigation;
    let actor = window.ScipOJAccess?.getUser?.()?.id || 'visitor', handlers = {}, version = 0, reverting = false, nativePending=null, approvedUnload=false;
    const tagged = (entry = {}) => ({...history.state, scipJourney: entry});
    let entry = history.state?.scipJourney || {index:0, previous:null};
    let current = new URL(location.href);
    history.replaceState(tagged(entry), '', current);
    const key = name => 'scipoj:journey:v1:' + actor + ':' + name;
    function remember(name, value) {try {sessionStorage.setItem(key(name), JSON.stringify(value));return true;} catch {return false;}}
    function recall(name, fallback = null) {try {const value=sessionStorage.getItem(key(name));return value===null?fallback:JSON.parse(value);} catch {return fallback;}}
    function forget(name) {try {sessionStorage.removeItem(key(name));} catch { /* storage is optional */ }}
    function save() {
        handlers.save?.();
        entry = {...entry, scroll:[scrollX,scrollY],focus:document.activeElement?.id||null};
        history.replaceState(tagged(entry), '', current);
    }
    function safeURL(value) {
        if(!value)return null;
        try {
            const url = new URL(value, location.href);
            const base = new URL('../', document.querySelector('script[src*="js/journey.js"]').src);
            return url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url : null;
        } catch {return null;}
    }
    function target(value) {
        const url = safeURL(value);if (!url) return null;
        if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
            const route = nav.parseRoute(url.hash), course = recall('course');
            if (route.space === 'course' && !route.params.has('course') && !route.params.has('mode') && course) url.hash = nav.withParams(url.hash, course);
        }
        return url;
    }
    function sameDocument(url) {
        return handlers.sameDocument ? handlers.sameDocument(url,current) : url.pathname===current.pathname && url.search===current.search;
    }
    async function render(url, options = {}) {
        document.querySelector('.studio-rail')?.classList.remove('rail-menu-open');
        document.getElementById('btn-course-menu')?.setAttribute('aria-expanded','false');
        await handlers.render?.(url, options);
        if (options.restore && entry.scroll) window.scrollTo({left:entry.scroll[0],top:entry.scroll[1],behavior:'instant'});
        if(options.restore&&entry.focus)document.getElementById(entry.focus)?.focus({preventScroll:true});
        else if(options.focus){
            const heading=[...document.querySelectorAll('main h1,main h2')].find(node=>node.getClientRects().length);
            if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
        }
        window.dispatchEvent(new Event('scipoj:location'));
    }
    async function allowed(url) {return !handlers.beforeLeave || await handlers.beforeLeave(url) !== false;}
    async function go(value, options = {}) {
        const url = target(value);if (!url) return false;
        if (url.href === current.href && !options.force) return true;
        const ticket=++version;
        if (!(await allowed(url)) || ticket!==version) return false;
        save();
        if (!sameDocument(url)) {
            approvedUnload=true;
            location.assign(url.href);return true;
        }
        const previous=current.href;
        entry=options.replace?{...entry,scroll:null}:{index:entry.index+1,previous,scroll:null};
        history[options.replace?'replaceState':'pushState'](tagged(entry),'',url);
        current=url;
        await render(url,options);return true;
    }
    async function nativeChange() {
        const url=new URL(location.href);
        if(reverting){reverting=false;nativePending=null;return;}
        if(url.href===current.href)return;
        if(nativePending===url.href)return;
        nativePending=url.href;
        const ticket=++version, previous=current, previousEntry=entry;
        const incoming=history.state?.scipJourney || {index:entry.index+1,previous:entry.previous};
        if(!(await allowed(url))){
            if(ticket!==version)return;
            const delta=previousEntry.index-incoming.index;
            if(delta){reverting=true;history.go(delta);}
            else {nativePending=null;history.replaceState(tagged(previousEntry),'',previous);}
            return;
        }
        if(ticket!==version)return;
        handlers.save?.();current=url;entry=incoming;nativePending=null;
        history.replaceState(tagged(entry),'',url);
        await render(url,{restore:true});
    }
    function amend(value) {
        const url=safeURL(value);if(!url)return;
        current=url;history.replaceState(tagged(entry),'',url);
    }
    function patch(params, options={}) {return go(nav.withParams(location.hash,params),options);}
    function back(fallback) {
        const url=target(fallback), previous=safeURL(entry.previous);
        const a=previous&&nav.parseRoute(previous.hash), b=url&&nav.parseRoute(url.hash);
        if(previous&&url&&previous.pathname===url.pathname&&previous.search===url.search&&a.key===b.key&&a.courseId===b.courseId){history.back();return;}
        const from=safeURL(new URL(location.href).searchParams.get('from')),ref=safeURL(document.referrer);
        if(url&&from?.href===url.href&&ref?.pathname===url.pathname&&history.length>1){
            return allowed(url).then(ok=>{if(ok){save();approvedUnload=true;history.back();}return ok;});
        }
        return go(url?.href||fallback);
    }
    function setUser(id) {actor=id||window.ScipOJAccess?.getUser?.()?.id||'visitor';}
    function courseContext(value) {remember('course', value);}
    function configure(next) {handlers=next;return render(new URL(location.href),{initial:true});}
    // Lab parameters are restored before their scripts perform the initial run.
    function restoreLab() {
     if(/\/(case-studio|inventory-lab|flow-lab)\.html$/.test(location.pathname)) {
        const form=document.querySelector('form');
        if(form){
            const name='lab:'+location.pathname;
            const fields=[...form.querySelectorAll('input[id],select[id],textarea[id]')];
            const saved=recall(name,{});
            for(const field of fields)if(saved[field.id]!==undefined)field.value=saved[field.id];
            const store=()=>remember(name,Object.fromEntries(fields.map(field=>[field.id,field.value])));
            form.addEventListener('input',store);form.addEventListener('change',store);
            form.addEventListener('reset',()=>setTimeout(store,0));
            document.getElementById('reset-button')?.addEventListener('click',()=>setTimeout(store,0));
            window.addEventListener('pagehide',store);
        }
    }
     }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{
        restoreLab();
        if(/\/(inventory-lab|flow-lab)\.html$/.test(location.pathname))document.querySelector('form')?.requestSubmit();
    },{once:true});else restoreLab();
    document.addEventListener('click',event=>{
        if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        const link=event.target.closest('a[href]');
        if(!link||link.hasAttribute('download')||link.target&&link.target!=='_self')return;
        const raw=link.getAttribute('href');if(!raw||raw.startsWith('javascript:'))return;
        let url=target(raw);if(!url)return;
        if(url.pathname===location.pathname && url.search===location.search && url.hash && !handlers.render)return;
        if(url.pathname!==location.pathname && /\/(doc|case-studio|inventory-lab|flow-lab|official-examples)\.html$/.test(url.pathname)){
            const from=new URL(location.href);from.searchParams.delete('from');
            url.searchParams.set('from',from.pathname+from.search+from.hash);
        }
        event.preventDefault();go(url.href,{focus:true}).catch(error=>window.ScipOJPlatform?.showToast(error.message,'error'));
    });
    document.addEventListener('click',event=>{
        const button=event.target.closest('#btn-course-menu');if(!button)return;
        const open=button.getAttribute('aria-expanded')!=='true';
        button.setAttribute('aria-expanded',String(open));document.querySelector('.studio-rail')?.classList.toggle('rail-menu-open',open);
    });
    window.addEventListener('popstate',nativeChange);
    window.addEventListener('hashchange',nativeChange);
    window.addEventListener('pagehide',()=>handlers.save?.());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)handlers.save?.();});
    window.ScipOJJourney={go,patch,back,amend,configure,remember,recall,forget,setUser,courseContext,safeURL,save,
        isLeaving:()=>approvedUnload,allowUnload:()=>{approvedUnload=true;}};
})();
