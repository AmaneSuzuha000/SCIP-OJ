import {state} from './state.js';
import {isConfigured,isTeacher} from './auth.js';
export function gradingAPI() {
    if (!state.gradingClient) {
        let storage;
        try {
            storage = window.localStorage;
        }
        catch {
            storage = null;
        }
        state.gradingClient = window.ScipOJGradingAPI.create({
            keys: window.ScipOJRequestKeys.create(storage, window.crypto),
            fetch: (...args) => window.fetch(...args), crypto: window.crypto,
            context: async () => {
                if (!isConfigured() || !state.supabase)
                    throw new Error("正式提交服务暂不可用");
                const { data: { session } } = await state.supabase.auth.getSession();
                if (!session?.user)
                    throw new Error("请先登录平台账号");
                return { session, user: session.user, cfg: window.SCIP_OJ_CONFIG };
            },
        });
    }
    return state.gradingClient;
}
export async function submitAssignment(assignmentId, codeText, clientIntegrity = null) {
    if (!isTeacher() && (!state.currentProfile?.student_no || !state.currentProfile.student_no.trim())) {
        throw new Error("提交正式作业前，请绑定真实学号与姓名");
    }
    return gradingAPI().submitAssignment(assignmentId, codeText, clientIntegrity);
}
export async function getMySubmissions(assignmentId) {
    if (!state.supabase || !state.currentUser)
        return [];
    try {
        let query = state.supabase.from("submissions")
            .select(`
          id,
          public_code,
          assignment_id,
          attempt_no,
          created_at,
          metadata,
          assignments (problem_id, pass_score, courses (name, code)),
          gradings (
            id,
            status,
            score,
            passed,
            report_json,
            config_snapshot,
            created_at,
            error_message,
            finished_at
          )
        `)
            .eq("user_id", state.currentUser.id)
            .order("created_at", { ascending: false })
            // 关键：复判会新增 grading，必须让最新一次评分排在最前，否则前端会展示旧分数
            .order("created_at", { ascending: false, referencedTable: "gradings" });
        if (assignmentId) {
            query = query.eq("assignment_id", assignmentId);
        }
        const { data, error } = await query;
        if (error) {
            console.warn("[Platform] getMySubmissions error:", error);
            throw new Error("加载提交记录失败：" + (error.message || "数据库查询错误"));
        }
        return (data || []).map(window.ScipOJGradingState.normalizeSubmission);
    }
    catch (e) {
        if (e instanceof Error && e.message.startsWith("加载提交记录失败"))
            throw e;
        console.warn("[Platform] getMySubmissions exception:", e);
        throw new Error("加载提交记录失败，请检查网络后重试");
    }
}
export async function requestRegrade(submissionId, reason) {
    return gradingAPI().requestRegrade(submissionId, reason);
}
export async function requestBatchRegrade(ids, reason, onProgress) {
    return gradingAPI().requestBatchRegrade(ids, reason, onProgress);
}
export async function requestProblemRegrade(courseId, problemId, reason, onProgress) {
    // Resolve a stable, explicit list, then use exactly the same batch path.
    return requestProblemRegradeChunked(courseId, problemId, reason, onProgress);
}
export async function requestProblemRegradeChunked(courseId, problemId, reason, onProgress) {
    const { data: assignment, error: aErr } = await state.supabase.from("assignments")
        .select("id")
        .eq("course_id", courseId)
        .eq("problem_id", String(problemId).toUpperCase())
        .maybeSingle();
    if (aErr)
        throw new Error("查询作业失败：" + aErr.message);
    if (!assignment)
        throw new Error("未找到对应作业");
    const { data: subs, error: sErr } = await state.supabase.from("submissions")
        .select("id")
        .eq("assignment_id", assignment.id);
    if (sErr)
        throw new Error("查询提交记录失败：" + sErr.message);
    const ids = (subs || []).map(s => s.id);
    if (ids.length === 0)
        throw new Error("该题目暂无任何学生提交记录");
    return await requestBatchRegrade(ids, reason || `整题重判 (${problemId})`, onProgress);
}