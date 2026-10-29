import {requestScope} from './scope.js';
export function create(context,{esc,formatTime}) {
// ── 证据台展示 ──
async function showSubmissionEvidence(row) {
    const current = requestScope(context, 'evidenceRequest');
    const detailSection = document.getElementById("submission-detail");
    const detailTitle = document.getElementById("detail-title");
    const detailCode = document.getElementById("detail-code");
    const detailReport = document.getElementById("detail-report");
    const detailTimeline = document.getElementById("detail-timeline");
    const btnRegrade = document.getElementById("btn-regrade");
    const btnCloseDetail = document.getElementById("btn-close-detail");
    const btnCopyCode = document.getElementById("btn-copy-student-code");
    const btnCopyReport = document.getElementById("btn-copy-student-report");
    const envMetaEl = document.getElementById("detail-environment-meta");
    const digestValEl = document.getElementById("detail-image-digest-val");
    btnRegrade.disabled = true;
    btnRegrade.onclick = null;
    if (envMetaEl) envMetaEl.hidden = true;
    detailSection.hidden = false;
    detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
    detailTitle.textContent = `评测证据：${row.student_no || '-'} ${row.display_name || ''} · 题目 ${row.problem_id || ''}`;
    detailCode.textContent = "正在获取学生提交源码...";
    detailReport.textContent = "正在获取评测报告...";
    detailTimeline.innerHTML = '<li style="color:var(--text-secondary);">加载评测时间线中...</li>';
    if (btnCloseDetail) {
        btnCloseDetail.onclick = () => {
            if(context.closeEvidence){context.closeEvidence();return;}
            context.evidenceRequest++;
            detailSection.hidden = true;
            if (envMetaEl) envMetaEl.hidden = true;
        };
    }
    if (btnCopyCode) {
        btnCopyCode.onclick = () => {
            const text = detailCode.textContent || "";
            navigator.clipboard.writeText(text).then(() => {
                ScipOJPlatform.showToast("代码已复制", "success");
            }).catch(() => {
                ScipOJPlatform.showTextDialog({ title: "复制学生代码", text });
            });
        };
    }
    if (btnCopyReport) {
        btnCopyReport.onclick = () => {
            const text = detailReport.textContent || "";
            navigator.clipboard.writeText(text).then(() => {
                ScipOJPlatform.showToast("评测报告已复制", "success");
            }).catch(() => {
                ScipOJPlatform.showTextDialog({ title: "复制评测报告", text });
            });
        };
    }
    const sb = ScipOJPlatform.getSupabase();
    let subId = row.best_submission_id;
    if (!subId && row.assignment_id && row.user_id) {
        const { data: latest } = await sb
            .from("submissions")
            .select("id")
            .eq("user_id", row.user_id)
            .eq("assignment_id", row.assignment_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (!current()) return;
        if (latest)
            subId = latest.id;
    }
    if (!subId) {
        detailCode.textContent = "（该学生在此题目下暂无提交代码）";
        detailReport.textContent = "（无报告）";
        detailTimeline.innerHTML = '<li style="color:var(--text-secondary);">尚无评测流水记录</li>';
        btnRegrade.disabled = true;
        return;
    }
    try {
        const { data: subData, error } = await sb
            .from("submissions")
            .select(`
            id,
            public_code,
            code_text,
            attempt_no,
            created_at,
            metadata,
            assignments(pass_score),
            gradings (
              id,
              status,
              score,
              passed,
              report_json,
              config_snapshot,
              error_message,
              started_at,
              finished_at,
              runner_ref,
              created_at
            )
          `)
            .eq("id", subId)
            // 复判会追加 grading，必须按时间倒序取最新一条
            .order("created_at", { ascending: false, referencedTable: "gradings" })
            .single();
        if (!current()) return;
        if (error || !subData)
            throw error || new Error("未找到指定提交记录");
        btnRegrade.disabled = false;
        detailCode.textContent = subData.code_text || "（空代码内容）";
        const { latestAttempt: latestGrading, effectiveGrade } = window.ScipOJGradingState.normalizeSubmission(subData);
        if (latestGrading) {
            const reportObj = latestGrading.report_json;
            detailReport.textContent = reportObj
                ? JSON.stringify(reportObj, null, 2)
                : (latestGrading.error_message ? `系统错误说明: ${latestGrading.error_message}` : "评测记录尚在队列中。");
            const imageDigest = reportObj?.image_digest || reportObj?.execution?.image_digest || reportObj?.execution?.image_id || latestGrading?.config_snapshot?.image_digest || null;
            if (envMetaEl && digestValEl) {
                if (imageDigest) {
                    digestValEl.textContent = imageDigest;
                    envMetaEl.hidden = false;
                } else {
                    envMetaEl.hidden = true;
                }
            }
        }
        else {
            detailReport.textContent = "暂无评分记录";
            if (envMetaEl) envMetaEl.hidden = true;
        }
        if (effectiveGrade && effectiveGrade.id !== latestGrading?.id) {
            detailReport.textContent += `\n\n当前有效成绩：${effectiveGrade.score} 分（最近一次成功评测）`;
        }
        if (subData.metadata?.integrity) {
            detailReport.textContent += "\n\n--- 考试模式记录（浏览器自报；不可直接认定作弊） ---\n" +
                JSON.stringify(subData.metadata.integrity, null, 2);
        }
        context.handlers.renderTimeline(detailTimeline, subData, latestGrading);
        // 绑定单条复判
        btnRegrade.onclick = async () => {
            const reason = await ScipOJPlatform.showPromptDialog({
                title: "发起单条复判",
                message: "请输入复判原因，将保存在课程评测记录中。",
                defaultValue: "教师抽查复判",
                confirmText: "确认复判",
                required: true,
            });
            if (reason === null || !current())
                return;
            btnRegrade.disabled = true;
            btnRegrade.textContent = "调度复判中…";
            try {
                await ScipOJPlatform.requestRegrade(subData.id, reason);
                ScipOJPlatform.showToast("复判任务已进入评测队列！", "success");
                if (context.currentCourseId)
                    await context.handlers.loadGradebook(context.currentCourseId);
                context.handlers.showSubmissionEvidence(row);
            }
            catch (err) {
                ScipOJPlatform.showToast("发起复判失败: " + err.message, "error");
            }
            finally {
                btnRegrade.disabled = false;
                btnRegrade.textContent = "🔄 发起单条复判（重测入库）";
            }
        };
    }
    catch (err) {
        if (!current()) return;
        detailCode.textContent = "加载失败: " + err.message;
        detailReport.textContent = "";
    }
}
function renderTimeline(container, submission, grading) {
    const items = [];
    items.push({
        title: `学生提交代码 (编号 ${submission.public_code || submission.id.slice(0, 8)})`,
        time: formatTime(submission.created_at),
        state: "done",
        desc: `第 ${submission.attempt_no || 1} 次提交${submission.metadata?.late ? ' · ⚠️ 迟交标记' : ''}`,
    });
    if (grading) {
        items.push({
            title: "进入评测队列 (GitHub Actions Dispatch)",
            time: formatTime(grading.created_at || grading.started_at || submission.created_at),
            state: grading.status === "queued" ? "running" : "done",
            desc: "系统已生成评测任务并分发",
        });
        if (grading.status === "running") {
            items.push({
                title: "GitHub Actions Runner 权威评测中…",
                time: grading.started_at ? formatTime(grading.started_at) : "进行中",
                state: "running",
                desc: `运行实例: ${grading.runner_ref || '分配中'}`,
            });
        }
        else if (grading.status === "done") {
            const digest = grading.report_json?.image_digest || grading.report_json?.execution?.image_digest || grading.config_snapshot?.image_digest || null;
            const digestNote = digest ? ` · 镜像: ${digest.length > 20 ? digest.slice(0, 19) + '…' : digest}` : '';
            items.push({
                title: `评测完成：得分 ${grading.score} 分 (${grading.passed ? '✓ 通过及格线' : '✗ 未通过'})`,
                time: formatTime(grading.finished_at || grading.created_at),
                state: "done",
                desc: `HMAC 验签入库 · Runner: ${grading.runner_ref || 'Actions Runner'}${digestNote}`,
            });
        }
        else if (grading.status === "system_error") {
            items.push({
                title: "评测系统故障 (已隔离，不扣除学生分数)",
                time: formatTime(grading.finished_at || grading.created_at),
                state: "error",
                desc: grading.error_message || "环境依赖或运行时异常",
            });
        }
    }
    else {
        items.push({
            title: "等待系统调度评测",
            time: "-",
            state: "running",
            desc: "排队中…",
        });
    }
    container.innerHTML = items.map(item => `
        <li class="timeline-item">
          <div class="timeline-icon ${item.state}">${item.state === 'done' ? '✓' : (item.state === 'error' ? '!' : '…')}</div>
          <div class="timeline-content">
            <strong>${esc(item.title)}</strong>
            <div class="timeline-time">${esc(item.time)} · ${esc(item.desc)}</div>
          </div>
        </li>
      `).join("");
}
return {showSubmissionEvidence,renderTimeline};
}
