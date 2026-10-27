export function create(context,{esc,formatTime}) {
async function updateCourseInviteDisplay() {
    const seq = ++context.inviteDisplaySeq;
    if (!context.inviteCodeEl)
        return;
    if (!context.currentCourseId) {
        context.inviteCodeEl.textContent = "-";
        return;
    }
    context.inviteCodeEl.textContent = "加载中…";
    let code = null;
    try {
        code = await ScipOJPlatform.getCourseInviteCode(context.currentCourseId);
    }
    catch (err) {
        console.warn("[Teacher] 读取邀请码失败:", err);
    }
    if (seq !== context.inviteDisplaySeq)
        return; // 已切换到其他班级
    context.inviteCodeEl.textContent = code || "未配置";
}
return {updateCourseInviteDisplay};
}
