import {state} from './state.js';
import {withDeadline} from './deadline.js';
import {updateAuthUI,showConfigWarning,showToast,checkStudentGates} from './dialogs.js';
let initialization;
export function isConfigured() {
    const cfg = window.SCIP_OJ_CONFIG;
    return !!(cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
}
export function isMockMode() {
    const cfg = window.SCIP_OJ_CONFIG;
    return !!(cfg && cfg.MOCK_MODE);
}
export function acceptSession(session) {
    const version = ++state.authVersion;
    if (state.currentUser?.id !== session?.user?.id) {
        state.currentProfile = null;
        state.currentEnrollments = [];
        state.enrollmentsLoadFailed = false;
    }
    state.currentUser = session?.user || null;
    return version;
}
export // ── 初始化平台服务 ──
async function init() {
    if(initialization){const ready=await initialization;updateAuthUI();return ready;}
    initialization=initialize();
    return initialization;
}
async function initialize() {
    if (!isConfigured()) {
        console.log("[Platform] 未检测到 Supabase 配置，平台运行于离线练习模式（WASM 练习正常可用）");
        updateAuthUI();
        showConfigWarning();
        return false;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.warn("[Platform] 未检测到 @supabase/supabase-js 库");
        updateAuthUI();
        showToast("平台脚本加载失败（supabase-js 未加载），正式作业功能暂不可用", "error");
        return false;
    }
    const cfg = window.SCIP_OJ_CONFIG;
    state.supabase = window.ScipOJAccess?.getClient() || window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    try {
        let session = null;
        let sessionError = null;
        try {
            const result=await withDeadline(state.supabase.auth.getSession(),6000,'会话恢复超时');
            session=result.data?.session || null;sessionError=result.error;
        } catch(error) { sessionError=error; }
        if (sessionError) {
            const invalidToken=/refresh_token_(not_found|already_used)|invalid.*refresh.?token|refresh.?token.*(invalid|not found)/i.test(String(sessionError.code||'')+' '+sessionError.message);
            if (invalidToken) {
                try {await withDeadline(state.supabase.auth.signOut({scope:'local'}),2000);} catch {}
            }
            acceptSession(null);
            showToast(invalidToken?'登录会话已失效，请重新使用 GitHub 登录':'课程服务响应较慢，可以继续本地练习。',invalidToken?'warning':'info');
        } else if (session) {
            acceptSession(session);
            const actor=state.currentUser;
            const metadata=Promise.all([refreshProfile(),refreshEnrollments()]);
            metadata.then(()=>{if(state.currentUser===actor){updateAuthUI();notifyAuthListeners();}}).catch(()=>{});
            await withDeadline(metadata,6000,'课程信息恢复超时').catch(()=>{});
        }
        // 监听认证状态变更
        // 注意：Supabase 官方要求不要在 onAuthStateChange 回调内直接 await 其他
        // Supabase 查询（会持有 auth 锁导致死锁），这里用 setTimeout 跳出回调再刷新。
        state.supabase.auth.onAuthStateChange((event, session) => {
            const version = acceptSession(session);
            updateAuthUI();
            setTimeout(async () => {
                if (version !== state.authVersion) return;
                if (state.currentUser) {
                    await refreshProfile();
                    if (version !== state.authVersion) return;
                    await refreshEnrollments();
                    if (version !== state.authVersion) return;
                    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
                        checkStudentGates();
                    }
                }
                else {
                    state.currentProfile = null;
                    state.currentEnrollments = [];
                }
                updateAuthUI();
                notifyAuthListeners();
            }, 0);
        });
    }
    catch (e) {
        console.warn("[Platform] 会话恢复异常:", e);
    }
    updateAuthUI();
    if (state.currentUser) {
        checkStudentGates();
    }
    return true;
}
export // ── 资料与选课刷新 ──
async function refreshProfile() {
    if (!state.supabase || !state.currentUser) {
        state.currentProfile = null;
        return null;
    }
    const actor=state.currentUser;
    const fallback = () => ({user_id:actor.id, role:'student', student_no:null,
        display_name:actor.user_metadata?.display_name || actor.user_metadata?.user_name || 'GitHub 用户'});
    try {
        const { data, error } = await state.supabase.from("profiles")
            .select("user_id, student_no, display_name, role")
            .eq("user_id", actor.id)
            .maybeSingle();
        if(state.currentUser!==actor) return;
        if (!error && data) {
            state.currentProfile = data;
        }
        else {
            const meta = state.currentUser.user_metadata || {};
            state.currentProfile = {
                user_id: state.currentUser.id,
                student_no: meta.student_no || null,
                display_name: meta.display_name || meta.user_name || meta.preferred_username || (state.currentUser.email ? state.currentUser.email.split("@")[0] : "GitHub 用户"),
                // 角色绝不从用户可控的 metadata 读取（GitHub OAuth 元数据不可信）
                role: "student",
            };
        }
    }
    catch (e) {
        if(state.currentUser!==actor) return;
        state.currentProfile = fallback();
        console.warn("[Platform] 加载个人资料异常:", e);
    }
    return state.currentProfile;
}
export async function refreshEnrollments() {
    if (!state.supabase || !state.currentUser) {
        state.currentEnrollments = [];
        return [];
    }
    const actor=state.currentUser;
    try {
        const { data, error } = await state.supabase.from("enrollments")
            .select("id, course_id, role, courses(id, name, code)")
            .eq("user_id", actor.id);
        if(state.currentUser!==actor) return;
        if (!error && data) {
            state.currentEnrollments = data;
            state.enrollmentsLoadFailed = false;
        }
        else {
            console.warn("[Platform] 加载选课关系失败:", error);
            state.currentEnrollments = [];
            state.enrollmentsLoadFailed = true;
        }
    }
    catch (e) {
        if(state.currentUser!==actor) return;
        console.warn("[Platform] 加载选课关系异常:", e);
        state.currentEnrollments = [];
        state.enrollmentsLoadFailed = true;
    }
    return state.currentEnrollments;
}
export function getUser() { return state.currentUser; }
export function getProfile() { return state.currentProfile; }
export function getSupabase() { return state.supabase; }
export function getEnrollments() { return state.currentEnrollments; }
export function isTeacher() {
    if (!state.currentUser || state.currentProfile?.user_id !== state.currentUser.id)
        return false;
    if (state.currentProfile?.role === "teacher" || state.currentProfile?.role === "admin")
        return true;
    return state.currentEnrollments.some(e => e.role === "teacher" || e.role === "admin" || e.role === "ta");
}
export function onAuthChange(fn) {
    if (typeof fn === "function") {
        state.authListeners.push(fn);
    }
    return ()=>{state.authListeners=state.authListeners.filter(listener=>listener!==fn);};
}
export function notifyAuthListeners() {
    state.authListeners.forEach((fn) => {
        try {
            Promise.resolve(fn(state.currentUser, state.currentProfile)).catch(error => console.warn('[Platform] 身份状态更新失败:', error));
        }
        catch (e) {
            console.error(e);
        }
    });
}
export // ── 身份认证（GitHub OAuth only） ──
async function signInWithGitHub() {
    if (!state.supabase)
        throw new Error("平台未配置云端后端服务");
    const { data, error } = await state.supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
            redirectTo: window.location.href.split("#")[0],
            scopes: "read:user user:email",
        },
    });
    if (error)
        throw error;
    return data;
}
export /** @deprecated 仅保留兼容性存根 */
async function signInWithEmail() {
    throw new Error("平台已全面切换为 GitHub OAuth 登录，请点击「用 GitHub 登录」");
}
export async function signUp() {
    throw new Error("平台已全面切换为 GitHub OAuth 登录，请点击「用 GitHub 登录」");
}
export async function signOut() {
    if (state.supabase) {
        const {error} = await state.supabase.auth.signOut();
        if (error) throw error;
    }
    state.authVersion++;
    state.currentUser = null;
    state.currentProfile = null;
    state.currentEnrollments = [];
    updateAuthUI();
    notifyAuthListeners();
    showToast("已退出当前账号", "info");
}
export // ── 学号与姓名绑定 ──
async function updateProfile({ student_no, display_name }) {
    if (!state.supabase || !state.currentUser)
        throw new Error("请先登录平台账号");
    const updateData = {};
    if (student_no !== undefined)
        updateData.student_no = student_no.trim();
    if (display_name !== undefined)
        updateData.display_name = display_name.trim();
    const { error } = await state.supabase.from("profiles")
        .update(updateData)
        .eq("user_id", state.currentUser.id);
    if (error) {
        // 学号全局唯一：给出可操作的中文提示，而不是裸露的 Postgres 错误
        if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message || "")) {
            throw new Error("该学号已被其他账号绑定，请联系任课教师核对处理");
        }
        if (error.code === "42501" || /row-level security|permission denied/i.test(error.message || "")) {
            throw new Error("没有权限修改个人资料，请确认登录状态后重试");
        }
        throw new Error(error.message || "更新个人资料失败");
    }
    await refreshProfile();
    updateAuthUI();
    notifyAuthListeners();
    showToast("个人资料已更新成功！", "success");
    return state.currentProfile;
}
