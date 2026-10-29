import {state} from './state.js';
import {isConfigured,isTeacher,signOut,signInWithGitHub,updateProfile} from './auth.js';
import {joinCourse} from './courses.js';
let accountEvents;
export // ── UI 渲染与弹窗系统 ──
function updateAuthUI() {
    const authArea = document.getElementById("auth-area");
    if (!authArea)
        return;
    accountEvents?.abort();
    if (!isConfigured()) {
        authArea.innerHTML = `
        <span class="auth-status" title="课程服务暂不可用，可使用本地练习。">
          🌿 离线练习模式
        </span>
      `;
        const teacherLink = document.getElementById("teacher-link");
        if (teacherLink)
            teacherLink.hidden = true;
        return;
    }
    if (state.currentUser) {
        const meta = state.currentUser.user_metadata || {};
        const name = state.currentProfile?.display_name || meta.display_name || meta.user_name || meta.preferred_username || (state.currentUser.email ? state.currentUser.email.split("@")[0] : "GitHub 用户");
        const sNo = state.currentProfile?.student_no;
        const isTeach = isTeacher();
        let roleBadge = "";
        if (isTeach) {
            roleBadge = '<span class="account-badge account-badge--teacher">教师</span>';
        }
        let studentBadge = "";
        if (!isTeach) {
            if (sNo) {
                studentBadge = `<span class="account-badge" title="已对齐学号">${escapeHtml(sNo)}</span>`;
            }
            else {
                studentBadge = `<button id="btn-bind-sno-quick" type="button" class="ui-button" title="未绑定学号，点击填写">填写学号</button>`;
            }
        }
        authArea.innerHTML = `
        <details class="account-menu">
          <summary id="account-menu-toggle" class="ui-button" aria-controls="account-panel" aria-expanded="false" aria-label="账号与课程选项">
            <span>账号</span><span class="account-label">${escapeHtml(name)}</span><img class="account-caret" src="assets/icons/caret-down.svg" alt="" aria-hidden="true">
          </summary>
          <div id="account-panel" class="account-panel">
            <p class="account-identity"><strong>${escapeHtml(name)}</strong>${roleBadge}${sNo ? studentBadge : ''}</p>
            <div class="account-actions">
              ${!isTeach && !sNo ? studentBadge : ''}
              <button id="btn-edit-profile" type="button" class="ui-button" title="修改学号与显示姓名">个人资料</button>
              <button id="btn-join-course-nav" type="button" class="ui-button" title="加入新课程">加入课程</button>
              <button id="btn-signout" type="button" class="ui-button">退出账号</button>
            </div>
          </div>
        </details>
      `;
        const menu = authArea.querySelector('.account-menu');
        const toggle = document.getElementById('account-menu-toggle');
        const closeAccount = (restoreFocus = false) => {
            menu.open = false;
            toggle.setAttribute('aria-expanded','false');
            if (restoreFocus) toggle.focus();
        };
        accountEvents = new AbortController();
        const options = {signal:accountEvents.signal};
        toggle.addEventListener('click',event=>{
            event.preventDefault();menu.open=!menu.open;
            toggle.setAttribute('aria-expanded',String(menu.open));
        },options);
        menu.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(menu.open)), options);
        document.addEventListener('click', event => {if (!menu.contains(event.target)) closeAccount();}, options);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && menu.open) {event.preventDefault();closeAccount(true);}
        }, options);
        const accountAction = action => () => {closeAccount(true);return action();};
        const btnOut = document.getElementById("btn-signout");
        if (btnOut)
            btnOut.onclick = accountAction(signOut);
        const btnEdit = document.getElementById("btn-edit-profile");
        if (btnEdit)
            btnEdit.onclick = accountAction(showStudentNoDialog);
        const btnJoin = document.getElementById("btn-join-course-nav");
        if (btnJoin)
            btnJoin.onclick = accountAction(showJoinCourseDialog);
        const btnQuick = document.getElementById("btn-bind-sno-quick");
        if (btnQuick)
            btnQuick.onclick = accountAction(showStudentNoDialog);
        const teacherLink = document.getElementById("teacher-link");
        if (teacherLink) {
            teacherLink.hidden = !isTeach;
        }
    }
    else {
        authArea.innerHTML = `
        <button id="btn-signin" type="button" class="ui-button ui-button--primary">
          用 GitHub 登录
        </button>
      `;
        const btnIn = document.getElementById("btn-signin");
        if (btnIn)
            btnIn.onclick = () => showLoginDialog();
        const teacherLink = document.getElementById("teacher-link");
        if (teacherLink)
            teacherLink.hidden = true;
    }
}
export // ── 学生门禁检查 ──
function checkStudentGates() {
    if (!state.currentUser || isTeacher())
        return;
    // 已有弹窗打开时不要叠加第二个门禁弹窗
    if (document.querySelector(".modal-overlay:not([hidden])"))
        return;
    // 选课关系查询失败时不要误判为“未选课”而强制弹窗
    if (state.enrollmentsLoadFailed)
        return;
    // 门禁 1：未填学号，引导先填学号与真实姓名
    if (!state.currentProfile?.student_no) {
        setTimeout(() => {
            showStudentNoDialog({
                forced: true,
                onComplete: () => {
                    if (state.currentEnrollments.length === 0) {
                        showJoinCourseDialog({ forced: true });
                    }
                }
            });
        }, 350);
        return;
    }
    // 门禁 2：已填学号但未选修任何课程，引导输入邀请码
    if (state.currentEnrollments.length === 0) {
        setTimeout(() => {
            showJoinCourseDialog({ forced: true });
        }, 350);
    }
}
export function openModal(dialog, options = {}) {
    if (!dialog)
        return;
    const dismissible = options.dismissible !== false;
    dialog.dataset.dismissible = dismissible ? "true" : "false";
    dialog.__onClose = typeof options.onClose === "function" ? options.onClose : null;
    if (!dialog.__prevFocus)
        dialog.__prevFocus = document.activeElement;
    if (!state.modalStack.includes(dialog))
        state.modalStack.push(dialog);
    dialog.hidden = false;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.classList.add("modal-open");
    setTimeout(() => {
        const target = dialog.querySelector("[data-autofocus]") ||
            dialog.querySelector(state.FOCUSABLE_SELECTOR);
        if (target && typeof target.focus === "function") {
            try {
                target.focus();
            }
            catch (_) { /* ignore */ }
        }
    }, 30);
}
export function closeModal(dialog, options = {}) {
    if (!dialog)
        return;
    if (dialog.dataset.dismissible === "false" && !options.force)
        return;
    dialog.hidden = true;
    const idx = state.modalStack.indexOf(dialog);
    if (idx >= 0)
        state.modalStack.splice(idx, 1);
    if (state.modalStack.length === 0)
        document.body.classList.remove("modal-open");
    const prev = dialog.__prevFocus;
    dialog.__prevFocus = null;
    if (prev && typeof prev.focus === "function") {
        try {
            prev.focus();
        }
        catch (_) { /* ignore */ }
    }
    const cb = dialog.__onClose;
    dialog.__onClose = null;
    if (cb) {
        try {
            cb();
        }
        catch (e) {
            console.error(e);
        }
    }
}
export function getTopModal() {
    return state.modalStack.length ? state.modalStack[state.modalStack.length - 1] : null;
}
export // ── 弹窗: 登录 ──
function showLoginDialog() {
    if (!isConfigured()) {
        showToast("平台未配置云端服务，无需登录即可使用「练习评分」", "info");
        return;
    }
    let dialog = document.getElementById("login-dialog");
    if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "login-dialog";
        dialog.className = "modal-overlay";
        dialog.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>登录 SCIP-OJ 作业平台</h3>
            <button type="button" class="modal-close-btn" id="login-modal-x">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0;">
              平台统一采用 <strong>GitHub OAuth</strong> 认证登录。<br/>
              无需提交 PR 或手动触发 Actions，GitHub 仅用于可信身份认证与作业成绩归属。
            </p>
            <div id="login-error" class="fail" style="font-size:0.85rem; margin:0.5rem 0;" hidden></div>
          </div>
          <div class="modal-actions">
            <button type="button" id="login-cancel" class="btn-secondary">取消</button>
            <button type="button" id="login-github" class="btn-blue" data-autofocus>使用 GitHub 账号登录</button>
          </div>
        </div>
      `;
        dialog.hidden = true;
        document.body.appendChild(dialog);
        const close = () => closeModal(dialog);
        document.getElementById("login-cancel").onclick = close;
        document.getElementById("login-modal-x").onclick = close;
        document.getElementById("login-modal-x").setAttribute("aria-label", "关闭登录弹窗");
        dialog.onclick = (e) => { if (e.target === dialog)
            close(); };
        document.getElementById("login-github").onclick = async () => {
            const errEl = document.getElementById("login-error");
            const btn = document.getElementById("login-github");
            errEl.hidden = true;
            btn.disabled = true;
            btn.textContent = "跳转 GitHub 中…";
            try {
                await signInWithGitHub();
            }
            catch (err) {
                errEl.textContent = err.message || "登录授权失败";
                errEl.hidden = false;
                btn.disabled = false;
                btn.textContent = "使用 GitHub 账号登录";
            }
        };
    }
    openModal(dialog);
    const errEl = document.getElementById("login-error");
    if (errEl)
        errEl.hidden = true;
}
export // ── 弹窗: 绑定学号与姓名 ──
function showStudentNoDialog(options = {}) {
    const forced = !!options.forced;
    let dialog = document.getElementById("student-no-dialog");
    if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "student-no-dialog";
        dialog.className = "modal-overlay";
        dialog.innerHTML = `
        <div class="modal-content" style="max-width:460px;">
          <div class="modal-header">
            <h3>👤 绑定课程学号与真实姓名</h3>
            <button type="button" class="modal-close-btn" id="sno-modal-x">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0; line-height:1.6;">
              为了确保您的正式作业成绩能准确计入教师成绩册，请核对并绑定您的<strong>真实学号</strong>与<strong>姓名</strong>。
            </p>
            <div class="form-group">
              <label for="input-student-no">学号 (如 20260001)：</label>
              <input type="text" id="input-student-no" placeholder="输入您的学号" data-autofocus />
            </div>
            <div class="form-group">
              <label for="input-display-name">真实姓名 / 显示名：</label>
              <input type="text" id="input-display-name" placeholder="输入真实姓名" />
            </div>
            <p id="sno-error" class="fail" style="font-size:0.85rem; margin-top:0.5rem;" hidden></p>
          </div>
          <div class="modal-actions">
            <button type="button" id="btn-sno-cancel" class="btn-secondary">取消</button>
            <button type="button" id="btn-sno-save" class="btn-blue">保存资料</button>
          </div>
        </div>
      `;
        dialog.hidden = true;
        document.body.appendChild(dialog);
    }
    const inputNo = document.getElementById("input-student-no");
    const inputName = document.getElementById("input-display-name");
    const errEl = document.getElementById("sno-error");
    const btnCancel = document.getElementById("btn-sno-cancel");
    const btnX = document.getElementById("sno-modal-x");
    const btnSave = document.getElementById("btn-sno-save");
    inputNo.value = state.currentProfile?.student_no || "";
    inputName.value = state.currentProfile?.display_name || "";
    errEl.hidden = true;
    // 强制门禁也保留“稍后填写（仅练习）”出口：
    // 关闭弹窗不会影响 练习；正式提交仍由服务端门禁校验学号，安全边界不变。
    const isForcedBlocking = forced && !state.currentProfile?.student_no;
    btnCancel.hidden = false;
    btnCancel.textContent = isForcedBlocking ? "稍后填写（仅练习）" : "取消";
    btnX.hidden = false;
    btnX.setAttribute("aria-label", "关闭学号绑定弹窗");
    const close = () => closeModal(dialog);
    btnCancel.onclick = () => {
        close();
        if (isForcedBlocking) {
            showToast("已跳过学号绑定：可继续 练习，提交正式作业前需补齐学号", "info");
        }
    };
    btnX.onclick = close;
    dialog.onclick = (e) => { if (e.target === dialog)
        close(); };
    // 支持回车保存
    inputNo.onkeydown = (e) => { if (e.key === "Enter")
        btnSave.click(); };
    inputName.onkeydown = (e) => { if (e.key === "Enter")
        btnSave.click(); };
    btnSave.onclick = async () => {
        const sNo = inputNo.value.trim();
        const sName = inputName.value.trim();
        if (!sNo) {
            errEl.textContent = "学号不能为空";
            errEl.hidden = false;
            inputNo.focus();
            return;
        }
        if (!sName) {
            errEl.textContent = "真实姓名不能为空";
            errEl.hidden = false;
            inputName.focus();
            return;
        }
        btnSave.disabled = true;
        btnSave.textContent = "保存中…";
        try {
            await updateProfile({ student_no: sNo, display_name: sName });
            closeModal(dialog, { force: true });
            if (typeof options.onComplete === "function") {
                options.onComplete();
            }
        }
        catch (err) {
            errEl.textContent = err.message || "保存资料失败";
            errEl.hidden = false;
        }
        finally {
            btnSave.disabled = false;
            btnSave.textContent = "保存资料";
        }
    };
    openModal(dialog, { dismissible: true });
    setTimeout(() => { (inputNo.value ? inputName : inputNo).focus(); }, 100);
}
export // ── 弹窗: 输入课程邀请码选课 ──
function showJoinCourseDialog(options = {}) {
    let dialog = document.getElementById("join-course-dialog");
    if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "join-course-dialog";
        dialog.className = "modal-overlay";
        dialog.innerHTML = `
        <div class="modal-content" style="max-width:460px;">
          <div class="modal-header">
            <h3>🎓 输入课程邀请码加入班级</h3>
            <button type="button" class="modal-close-btn" id="join-modal-x">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0; line-height:1.6;">
              请输入任课教师提供的<strong>选课邀请码</strong>（例如 <code>REDACTED-INVITE</code>），加入教学班级后方可提交课程正式作业。
            </p>
            <div class="form-group">
              <label for="input-invite-code">课程邀请码：</label>
              <input type="text" id="input-invite-code" placeholder="如 REDACTED-INVITE" data-autofocus />
            </div>
            <p id="join-course-error" class="fail" style="font-size:0.85rem; margin-top:0.5rem;" hidden></p>
          </div>
          <div class="modal-actions">
            <button type="button" id="btn-join-cancel" class="btn-secondary">稍后再说</button>
            <button type="button" id="btn-join-submit" class="btn-blue">确认加入课程</button>
          </div>
        </div>
      `;
        dialog.hidden = true;
        document.body.appendChild(dialog);
    }
    const inputCode = document.getElementById("input-invite-code");
    const errEl = document.getElementById("join-course-error");
    const btnCancel = document.getElementById("btn-join-cancel");
    const btnX = document.getElementById("join-modal-x");
    const btnSubmit = document.getElementById("btn-join-submit");
    inputCode.value = "";
    errEl.hidden = true;
    const close = () => closeModal(dialog);
    btnCancel.onclick = close;
    btnX.onclick = close;
    btnX.setAttribute("aria-label", "关闭选课弹窗");
    dialog.onclick = (e) => { if (e.target === dialog)
        close(); };
    inputCode.onkeydown = (e) => { if (e.key === "Enter")
        btnSubmit.click(); };
    btnSubmit.onclick = async () => {
        const code = inputCode.value.trim();
        if (!code) {
            errEl.textContent = "请输入邀请码";
            errEl.hidden = false;
            inputCode.focus();
            return;
        }
        btnSubmit.disabled = true;
        btnSubmit.textContent = "正在校验加入…";
        try {
            const res = await joinCourse(code);
            closeModal(dialog, { force: true });
            if (typeof options.onComplete === "function") {
                options.onComplete(res);
            }
        }
        catch (err) {
            errEl.textContent = err.message || "加入课程失败";
            errEl.hidden = false;
        }
        finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "确认加入课程";
        }
    };
    openModal(dialog, { dismissible: true });
    setTimeout(() => inputCode.focus(), 100);
}
export // ── Toast 轻量非阻塞通知 ──
function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    // 最多保留 4 条，避免刷屏遮挡页面按钮
    while (container.children.length >= 4) {
        container.removeChild(container.firstElementChild);
    }
    const allowed = ["info", "success", "error", "warning"];
    const kind = allowed.includes(type) ? type : "info";
    const toast = document.createElement("div");
    toast.className = `toast toast-${kind}`;
    let icon = "ℹ️";
    if (kind === "success")
        icon = "✅";
    else if (kind === "error")
        icon = "❌";
    else if (kind === "warning")
        icon = "⚠️";
    toast.innerHTML = `<span>${icon}</span><span style="flex:1;">${escapeHtml(message)}</span>`;
    toast.title = "点击关闭";
    toast.onclick = () => toast.remove();
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}
export // ── 通用输入 / 确认弹窗：替代原生 prompt/confirm（移动端不友好且会阻塞渲染） ──
function ensurePromptDialog() {
    let dialog = document.getElementById("prompt-dialog");
    if (dialog)
        return dialog;
    dialog = document.createElement("div");
    dialog.id = "prompt-dialog";
    dialog.className = "modal-overlay";
    dialog.innerHTML = `
      <div class="modal-content" style="max-width:460px;">
        <div class="modal-header">
          <h3 id="prompt-title">请输入</h3>
          <button type="button" class="modal-close-btn" id="prompt-x" aria-label="关闭输入弹窗">✕</button>
        </div>
        <div class="modal-body">
          <p id="prompt-message" style="color:var(--text-secondary); margin-top:0; line-height:1.6;"></p>
          <div class="form-group">
            <input type="text" id="prompt-input" data-autofocus />
            <p id="prompt-error" class="fail" style="font-size:0.85rem; margin:0.4rem 0 0;" hidden></p>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="prompt-cancel" class="btn-secondary">取消</button>
          <button type="button" id="prompt-ok" class="btn-blue">确定</button>
        </div>
      </div>
    `;
    dialog.hidden = true;
    document.body.appendChild(dialog);
    return dialog;
}
export function showPromptDialog(options = {}) {
    const dialog = ensurePromptDialog();
    const titleEl = document.getElementById("prompt-title");
    const msgEl = document.getElementById("prompt-message");
    const input = document.getElementById("prompt-input");
    const errEl = document.getElementById("prompt-error");
    const btnOk = document.getElementById("prompt-ok");
    const btnCancel = document.getElementById("prompt-cancel");
    const btnX = document.getElementById("prompt-x");
    titleEl.textContent = options.title || "请输入";
    msgEl.textContent = options.message || "";
    msgEl.hidden = !options.message;
    input.value = options.defaultValue ?? "";
    input.placeholder = options.placeholder || "";
    errEl.hidden = true;
    btnOk.textContent = options.confirmText || "确定";
    btnCancel.textContent = options.cancelText || "取消";
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            closeModal(dialog);
            resolve(value);
        };
        const submit = () => {
            const val = input.value.trim();
            if (options.required && !val) {
                errEl.textContent = options.requiredMessage || "内容不能为空";
                errEl.hidden = false;
                input.focus();
                return;
            }
            finish(val);
        };
        btnOk.onclick = submit;
        btnCancel.onclick = () => finish(null);
        btnX.onclick = () => finish(null);
        input.onkeydown = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submit();
            }
        };
        dialog.onclick = (e) => { if (e.target === dialog)
            finish(null); };
        openModal(dialog, {
            dismissible: true,
            onClose: () => { if (!settled) {
                settled = true;
                resolve(null);
            } },
        });
        setTimeout(() => {
            input.focus();
            if (options.selectAll !== false)
                input.select();
        }, 60);
    });
}
export // 只读长文本弹窗：剪贴板 API 不可用（非 HTTPS / 权限被拒）时的兜底
function showTextDialog(options = {}) {
    let dialog = document.getElementById("text-dialog");
    if (!dialog) {
        dialog = document.createElement("div");
        dialog.id = "text-dialog";
        dialog.className = "modal-overlay";
        dialog.innerHTML = `
        <div class="modal-content" style="max-width:680px;">
          <div class="modal-header">
            <h3 id="text-dialog-title">复制内容</h3>
            <button type="button" class="modal-close-btn" id="text-dialog-x" aria-label="关闭">✕</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text-secondary); margin-top:0;">
              浏览器不允许自动写入剪贴板，请点击下方文本框后按 <kbd>Ctrl/⌘ + C</kbd> 手动复制。
            </p>
            <textarea id="text-dialog-body" readonly rows="14"
              style="width:100%; font-family:var(--font-mono, monospace); font-size:0.82rem; resize:vertical;"></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" id="text-dialog-select" class="btn-secondary">全选内容</button>
            <button type="button" id="text-dialog-close" class="btn-blue">关闭</button>
          </div>
        </div>
      `;
        dialog.hidden = true;
        document.body.appendChild(dialog);
    }
    document.getElementById("text-dialog-title").textContent = options.title || "复制内容";
    const body = document.getElementById("text-dialog-body");
    body.value = options.text || "";
    const close = () => closeModal(dialog);
    document.getElementById("text-dialog-close").onclick = close;
    document.getElementById("text-dialog-x").onclick = close;
    document.getElementById("text-dialog-select").onclick = () => {
        body.focus();
        body.select();
    };
    dialog.onclick = (e) => { if (e.target === dialog)
        close(); };
    openModal(dialog);
    setTimeout(() => { body.focus(); body.select(); }, 80);
}
export function ensureConfirmDialog() {
    let dialog = document.getElementById("confirm-dialog");
    if (dialog)
        return dialog;
    dialog = document.createElement("div");
    dialog.id = "confirm-dialog";
    dialog.className = "modal-overlay";
    dialog.innerHTML = `
      <div class="modal-content" style="max-width:440px;">
        <div class="modal-header">
          <h3 id="confirm-title">请确认</h3>
          <button type="button" class="modal-close-btn" id="confirm-x" aria-label="关闭确认弹窗">✕</button>
        </div>
        <div class="modal-body">
          <p id="confirm-message" style="margin:0; line-height:1.7; white-space:pre-line;"></p>
        </div>
        <div class="modal-actions">
          <button type="button" id="confirm-cancel" class="btn-secondary" data-autofocus>取消</button>
          <button type="button" id="confirm-ok" class="btn-blue">确定</button>
        </div>
      </div>
    `;
    dialog.hidden = true;
    document.body.appendChild(dialog);
    return dialog;
}
export function showConfirmDialog(options = {}) {
    const dialog = ensureConfirmDialog();
    document.getElementById("confirm-title").textContent = options.title || "请确认";
    document.getElementById("confirm-message").textContent = options.message || "";
    const btnOk = document.getElementById("confirm-ok");
    const btnCancel = document.getElementById("confirm-cancel");
    const btnX = document.getElementById("confirm-x");
    btnOk.textContent = options.confirmText || "确定";
    btnCancel.textContent = options.cancelText || "取消";
    btnOk.className = options.danger ? "btn-danger" : "btn-blue";
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            closeModal(dialog);
            resolve(value);
        };
        btnOk.onclick = () => finish(true);
        btnCancel.onclick = () => finish(false);
        btnX.onclick = () => finish(false);
        dialog.onclick = (e) => { if (e.target === dialog)
            finish(false); };
        openModal(dialog, {
            dismissible: true,
            onClose: () => { if (!settled) {
                settled = true;
                resolve(false);
            } },
        });
    });
}
export function showConfigWarning() {
    if (document.getElementById("config-warning"))
        return;
    const main = document.querySelector("main") || document.body;
    const el = document.createElement("div");
    el.id = "config-warning";
    el.className = "config-warning";
    el.innerHTML = `课程服务暂不可用，选课、正式提交和成绩查询暂时无法使用。你可以继续本地练习，请稍后重试。`;
    main.insertBefore(el, main.firstChild);
}
export function escapeHtml(s) {
    if (s == null)
        return "";
    return String(s).replace(/[&<>'"]/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
    }[c] || c));
}
