import {state} from './state.js';
import {getTopModal,closeModal} from './dialogs.js';
window.addEventListener('scipoj:page-dispose',()=>{
    for(const dialog of state.modalStack){dialog.__onClose=null;dialog.remove();}
    state.modalStack=[];
});
document.addEventListener("keydown", (e) => {
    const top = getTopModal();
    if (!top)
        return;
    if (e.key === "Escape") {
        if (top.dataset.dismissible === "false")
            return; // 强制门禁弹窗不允许 Esc 绕过
        e.preventDefault();
        closeModal(top);
        return;
    }
    if (e.key === "Tab") {
        const nodes = Array.from(top.querySelectorAll(state.FOCUSABLE_SELECTOR))
            .filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (nodes.length === 0)
            return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});
import * as auth from './auth.js';
import * as courses from './courses.js';
import * as submissions from './submissions.js';
import * as dialogs from './dialogs.js';
window.ScipOJPlatform={init:auth.init,isConfigured:auth.isConfigured,isMockMode:auth.isMockMode,isMissingRpcError:courses.isMissingRpcError,getUser:auth.getUser,getProfile:auth.getProfile,getSupabase:auth.getSupabase,getEnrollments:auth.getEnrollments,isTeacher:auth.isTeacher,onAuthChange:auth.onAuthChange,signInWithGitHub:auth.signInWithGitHub,signInWithEmail:auth.signInWithEmail,signUp:auth.signUp,signOut:auth.signOut,updateProfile:auth.updateProfile,joinCourse:courses.joinCourse,submitAssignment:submissions.submitAssignment,getMySubmissions:submissions.getMySubmissions,getAssignmentForProblem:courses.getAssignmentForProblem,getCourseAssignments:courses.getCourseAssignments,getMyCourses:courses.getMyCourses,getTeacherRoster:courses.getTeacherRoster,getCourseInviteCode:courses.getCourseInviteCode,getLeaderboard:courses.getLeaderboard,getPendingRoster:courses.getPendingRoster,getVerifiedRoster:courses.getVerifiedRoster,confirmRosterIdentity:courses.confirmRosterIdentity,importRosterCSV:courses.importRosterCSV,publishAssignment:courses.publishAssignment,requestRegrade:submissions.requestRegrade,requestBatchRegrade:submissions.requestBatchRegrade,requestProblemRegrade:submissions.requestProblemRegrade,rotateCourseInviteCode:courses.rotateCourseInviteCode,updateAuthUI:dialogs.updateAuthUI,showLoginDialog:dialogs.showLoginDialog,showStudentNoDialog:dialogs.showStudentNoDialog,showJoinCourseDialog:dialogs.showJoinCourseDialog,showPromptDialog:dialogs.showPromptDialog,showConfirmDialog:dialogs.showConfirmDialog,showTextDialog:dialogs.showTextDialog,checkStudentGates:dialogs.checkStudentGates,showToast:dialogs.showToast,openModal:dialogs.openModal,closeModal:dialogs.closeModal,escapeHtml:dialogs.escapeHtml};
