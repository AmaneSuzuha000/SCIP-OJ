/* A login wall for public Pages. The database and Edge APIs enforce admission. */
(() => {
    'use strict';
    function reload(){window.ScipOJJourney?.allowUnload();location.reload();}
    const gate = document.getElementById('site-access-gate');
    const title = document.getElementById('site-access-title');
    const message = document.getElementById('site-access-message');
    const signin = document.getElementById('site-access-signin');
    const retry = document.getElementById('site-access-retry');
    const signout = document.getElementById('site-access-signout');
    const destination = document.getElementById('site-access-destination');
    const base = new URL('../', document.currentScript.src);
    const returnKey = 'scipoj:access:return';
    let client, epoch = 0, admitted = null, admittedUser = null, started = false, authorized = false, bootFailed = false;
    const deadline = (promise, ms = 8000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('ACCESS_TIMEOUT')), ms);
        Promise.resolve(promise).then(value => {clearTimeout(timer);resolve(value);}, error => {clearTimeout(timer);reject(error);});
    });
    function pageTarget() {
        const file = location.pathname.split('/').pop() || 'index.html';
        const names = {
            'index.html': '课程首页',
            'teacher.html': '教师控制台',
            'case-studio.html': '检修排队实验 IE-DES-01',
            'inventory-lab.html': '库存仿真实验 IE-MC-02',
            'flow-lab.html': '生产线仿真实验 IE-DES-03',
            'official-examples.html': '官方建模示例',
            'doc.html': '课程文档'
        };
        const hash = location.hash && location.hash !== '#' ? location.hash : '';
        const home = (file === 'index.html' || file === '') && (!hash || hash === '#course');
        if (home) return '';
        return (names[file] || file) + (file === 'index.html' ? ' ' + hash : hash ? ' ' + hash : '');
    }
    function paintDestination() {
        if (!destination) return;
        const label = pageTarget();
        destination.hidden = !label;
        destination.textContent = label ? '你正在打开：' + label : '';
    }
    function show(state, text) {
        authorized = false;
        // Discard the complete application and its kernels after signout/revocation.
        if (started) {reload();return;}
        gate.hidden = false;
        gate.dataset.state = state;
        title.textContent = state === 'denied' ? '此账号未获授权' : state === 'error' ? '暂时无法验证访问权限' : state === 'login' ? '请先登录' : '正在验证访问权限';
        message.textContent = text;
        paintDestination();
        signin.hidden = state === 'checking';
        signin.disabled = !client;
        retry.hidden = !['error','denied'].includes(state);
        signout.hidden = !client || !['error','denied'].includes(state);
    }
    async function mount() {
        started = true;
        const template = document.getElementById('site-protected-content');
        const fragment = template.content.cloneNode(true);
        const scripts = [...fragment.querySelectorAll('script')];
        scripts.forEach(script => script.remove());
        const deferred = scripts.filter(script => script.src && script.defer);
        const regular = scripts.filter(script => !deferred.includes(script));
        document.body.appendChild(fragment);
        template.remove();
        gate.hidden = true;
        for (const original of [...regular, ...deferred]) {
            if (!authorized) return;
            const src = original.getAttribute('src');
            const script = document.createElement('script');
            for (const attribute of original.attributes) {
                if (!['async','defer'].includes(attribute.name)) script.setAttribute(attribute.name, attribute.value);
            }
            script.async = false;
            if (src) {
                await new Promise((resolve, reject) => {
                    script.addEventListener('load', resolve, {once:true});
                    script.addEventListener('error', () => reject(Error('APP_LOAD_FAILED')), {once:true});
                    document.body.appendChild(script);
                });
            } else {
                script.textContent = original.textContent;
                document.body.appendChild(script);
            }
        }
        gate.remove();
        window.dispatchEvent(new Event('scipoj:access-ready'));
    }
    function restoreReturn() {
        let saved;
        try {saved = sessionStorage.getItem(returnKey);sessionStorage.removeItem(returnKey);} catch {return false;}
        if (!saved) return false;
        const target = new URL(saved, base);
        if (target.origin === base.origin && target.pathname.startsWith(base.pathname) && target.href !== location.href && !target.pathname.includes('/notebooks/')) {
            location.replace(target.href);
            return true;
        }
        return false;
    }
    async function check() {
        if (bootFailed) return;
        const version = ++epoch;
        if (!client) {show('error','访问验证暂不可用，请稍后重试。');return;}
        try {
            const result = await deadline(client.auth.getSession());
            if (version !== epoch) return;
            const session = result.data?.session;
            if (result.error) throw result.error;
            if (!session?.user) {show('login','请使用已获授权的 GitHub 账号登录后进入。');return;}
            const reply = await deadline(client.rpc('check_site_access'));
            if (version !== epoch) return;
            if (reply.error) {
                if (['42501','PGRST301','PGRST302'].includes(reply.error.code)) {show('denied','当前 GitHub 账号没有访问权限。请切换到已获授权的账号。');return;}
                throw reply.error;
            }
            if (reply.data !== true) {show('denied','当前 GitHub 账号没有访问权限。请切换到已获授权的账号。');return;}
            if (admitted && admitted !== session.user.id) {reload();return;}
            admitted = session.user.id;
            admittedUser = session.user;
            authorized = true;
            if (restoreReturn()) return;
            if (!started) {
                gate.dataset.state = 'opening';
                title.textContent = '验证通过';
                message.textContent = '正在进入…';
                signin.hidden = true;
                retry.hidden = true;
                signout.hidden = true;
                try {await mount();} catch {
                    bootFailed = true;authorized = false;
                    document.body.replaceChildren(gate);
                    gate.hidden = false;gate.dataset.state = 'error';
                    title.textContent = '页面加载未完成';message.textContent = '请检查网络后重新加载。';
                    signin.hidden = true;retry.hidden = false;signout.hidden = false;
                    retry.onclick = () => reload();
                }
            }
        } catch {
            if (version === epoch) show('error','访问验证暂不可用，请检查网络后重试。');
        }
    }
    retry.onclick = () => client ? check() : reload();
    signin.onclick = async () => {
        if (!client) return;
        signin.disabled = true;
        try {
            try {sessionStorage.setItem(returnKey, location.pathname + location.search + location.hash);} catch { /* route recovery is optional */ }
            const {error} = await client.auth.signInWithOAuth({provider:'github',options:{redirectTo:base.href,scopes:'read:user user:email'}});
            if (error) throw error;
        } catch {show('error','登录未完成，请重试。');}
        finally {signin.disabled = false;}
    };
    signout.onclick = async () => {
        if (!client) return;
        signout.disabled = true;
        try {
            const result = await deadline(client.auth.signOut({scope:'local'}));
            if (result.error) throw result.error;
            reload();
        } catch {show('error','切换账号未完成，请重试。');}
        finally {signout.disabled = false;}
    };
    const config = window.SCIP_OJ_CONFIG;
    if (config?.SUPABASE_URL && config?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
        client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
        client.auth.onAuthStateChange((event, session) => {
            if (started && (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== admitted))) {
                authorized = false;reload();return;
            }
            // Never query Supabase while the auth callback holds its lock.
            setTimeout(check, 0);
        });
    }
    window.ScipOJAccess = {getClient:() => client,getUser:()=>admittedUser,isAuthorized:()=>authorized};
    document.addEventListener('visibilitychange', () => {if (!document.hidden) check();});
    window.addEventListener('pageshow', event => {if (event.persisted) check();});
    setInterval(() => {if (!document.hidden) check();}, 30000);
    check();
})();
