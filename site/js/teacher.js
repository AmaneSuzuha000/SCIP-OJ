/**
 * SCIP-OJ 教师控制台 — 成绩中心、评测证据台、花名册对齐与作业发布
 * 依赖: ScipOJPlatform (platform.js)
 */

(async function teacherInit() {
  const noConfigEl = document.getElementById("teacher-no-config");
  const noAuthEl = document.getElementById("teacher-no-auth");
  const forbiddenEl = document.getElementById("teacher-forbidden");
  const panelEl = document.getElementById("teacher-panel");
  const btnTeacherSignin = document.getElementById("btn-teacher-signin");

  if (!window.ScipOJPlatform) {
    if (noConfigEl) noConfigEl.hidden = false;
    return;
  }

  const configured = await ScipOJPlatform.init();
  ScipOJPlatform.updateAuthUI();

  if (!configured) {
    if (noConfigEl) noConfigEl.hidden = false;
    return;
  }

  if (btnTeacherSignin) {
    btnTeacherSignin.onclick = () => ScipOJPlatform.showLoginDialog();
  }

  // ── 认证与角色权限检查 ──
  async function checkTeacherAccess() {
    const user = ScipOJPlatform.getUser();
    if (!user) {
      if (noAuthEl) noAuthEl.hidden = false;
      if (forbiddenEl) forbiddenEl.hidden = true;
      if (panelEl) panelEl.hidden = true;
      return false;
    }

    if (noAuthEl) noAuthEl.hidden = true;

    // 检查是否具备教师/助教/管理员权限
    const enrollments = await ScipOJPlatform.getMyCourses();
    const isTeacherRole = ScipOJPlatform.isTeacher();
    const teacherCourses = enrollments.filter(e => e.role === "teacher" || e.role === "ta" || e.role === "admin");

    if (!isTeacherRole && teacherCourses.length === 0) {
      if (forbiddenEl) {
        forbiddenEl.hidden = false;
        const nameEl = document.getElementById("forbidden-user-name");
        if (nameEl) nameEl.textContent = ScipOJPlatform.getProfile()?.display_name || user.email || user.id;
      }
      if (panelEl) panelEl.hidden = true;
      return false;
    }

    if (forbiddenEl) forbiddenEl.hidden = true;
    if (panelEl) panelEl.hidden = false;
    return true;
  }

  let initializedForUser = null;

  const hasAccess = await checkTeacherAccess();
  ScipOJPlatform.onAuthChange(async () => {
    const ok = await checkTeacherAccess();
    const uid = ScipOJPlatform.getUser()?.id || null;
    // 仅在登录用户变化时重建工作台，避免 token 刷新把正在填写的表单清空
    if (ok && uid && uid !== initializedForUser) initTeacherView();
  });

  if (hasAccess) {
    initTeacherView();
  }

  // ── 教师工作台主逻辑 ──
  async function initTeacherView() {
    initializedForUser = ScipOJPlatform.getUser()?.id || null;
    const courseSelect = document.getElementById("course-select");
    const inviteCodeEl = document.getElementById("course-invite-code");
    const btnCopyInvite = document.getElementById("btn-copy-invite");
    const btnRotateInvite = document.getElementById("btn-rotate-invite");

    // 选项卡切换
    const tabBtns = document.querySelectorAll(".teacher-tabs .tab-btn");
    const tabContents = {
      gradebook: document.getElementById("tab-gradebook"),
      roster: document.getElementById("tab-roster"),
      assignments: document.getElementById("tab-assignments"),
    };

    tabBtns.forEach(btn => {
      btn.onclick = () => {
        const targetTab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.toggle("active", b === btn));
        Object.keys(tabContents).forEach(key => {
          if (tabContents[key]) {
            tabContents[key].hidden = (key !== targetTab);
          }
        });

        // 切换标签时按需加载
        if (targetTab === "roster" && currentCourseId) {
          loadPendingRoster(currentCourseId);
        } else if (targetTab === "assignments" && currentCourseId) {
          loadCourseAssignments(currentCourseId);
        }
      };
    });

    let currentCourseId = null;
    let currentCoursesList = [];
    let currentRosterData = [];
    let currentAssignmentsList = [];

    // 加载教师授课课程列表
    try {
      const enrollments = await ScipOJPlatform.getMyCourses();
      currentCoursesList = enrollments.filter(e => e.role === "teacher" || e.role === "ta" || e.role === "admin");

      if (currentCoursesList.length === 0) {
        courseSelect.innerHTML = "<option>未分配任何授课班级</option>";
        return;
      }

      courseSelect.innerHTML = currentCoursesList.map(e => {
        const c = e.courses || {};
        return `<option value="${c.id}">${esc(c.code || '')} - ${esc(c.name || c.id)}</option>`;
      }).join("");

      currentCourseId = currentCoursesList[0].courses?.id;
      // 成绩表 / 邀请码加载必须等下方 rosterArea 等变量初始化后再跑，
      // 否则会命中 const TDZ，页面永远停在「正在加载班级成绩表...」。
    } catch (err) {
      console.error("[Teacher] 加载授课列表失败:", err);
    }

    // 班级切换
    courseSelect.onchange = async () => {
      currentCourseId = courseSelect.value;
      updateCourseInviteDisplay();
      if (currentCourseId) {
        await loadGradebook(currentCourseId);
        loadPendingRoster(currentCourseId);
        loadCourseAssignments(currentCourseId);
      }
    };

    // 更新当前班级邀请码显示（邀请码受列级权限保护，需通过教师 RPC 读取）
    let inviteDisplaySeq = 0;
    async function updateCourseInviteDisplay() {
      const seq = ++inviteDisplaySeq;
      if (!inviteCodeEl) return;
      if (!currentCourseId) {
        inviteCodeEl.textContent = "-";
        return;
      }
      inviteCodeEl.textContent = "加载中…";
      let code = null;
      try {
        code = await ScipOJPlatform.getCourseInviteCode(currentCourseId);
      } catch (err) {
        console.warn("[Teacher] 读取邀请码失败:", err);
      }
      if (seq !== inviteDisplaySeq) return; // 已切换到其他班级
      inviteCodeEl.textContent = code || "未配置";
    }

    // 复制邀请码
    if (btnCopyInvite) {
      btnCopyInvite.onclick = () => {
        const code = inviteCodeEl?.textContent;
        if (!code || code === "加载中…" || code === "未配置") {
          ScipOJPlatform.showToast("邀请码尚未加载完成或未配置", "warning");
          return;
        }
        navigator.clipboard.writeText(code).then(() => {
          ScipOJPlatform.showToast(`邀请码 ${code} 已复制到剪贴板`, "success");
        }).catch(() => {
          ScipOJPlatform.showTextDialog({ title: "复制邀请码", text: code });
        });
      };
    }

    // 轮换邀请码
    if (btnRotateInvite) {
      btnRotateInvite.onclick = async () => {
        if (!currentCourseId) return;
        const customCode = await ScipOJPlatform.showPromptDialog({
          title: "轮换课程邀请码",
          message: "请输入新的邀请码（仅字母、数字、下划线或短横线，4-32 位）；留空将自动生成随机邀请码。",
          defaultValue: "",
          confirmText: "确认轮换",
        });
        if (customCode === null) return;
        if (customCode && !/^[A-Za-z0-9_-]{4,32}$/.test(customCode)) {
          ScipOJPlatform.showToast("邀请码只能包含字母、数字、下划线或短横线（4-32 位）", "warning");
          return;
        }
        btnRotateInvite.disabled = true;
        try {
          const newCode = await ScipOJPlatform.rotateCourseInviteCode(currentCourseId, customCode);
          ScipOJPlatform.showToast(`邀请码已成功更新为：${newCode}`, "success");
          await updateCourseInviteDisplay();
        } catch (err) {
          ScipOJPlatform.showToast("轮换邀请码失败: " + err.message, "error");
        } finally {
          btnRotateInvite.disabled = false;
        }
      };
    }

    // ──────────────────────────────────────────────────────────
    // TAB 1: 班级成绩表与评测证据台
    // ──────────────────────────────────────────────────────────
    const rosterArea = document.getElementById("roster-area");
    const filterProblem = document.getElementById("filter-problem");
    const filterKeyword = document.getElementById("filter-keyword");
    const btnRefresh = document.getElementById("btn-refresh");
    const btnExportCsv = document.getElementById("btn-export-csv");
    const btnBatchRegrade = document.getElementById("btn-batch-regrade");
    const btnRegradeProblem = document.getElementById("btn-regrade-problem");
    const batchProgressBar = document.getElementById("batch-progress-bar");
    const batchProgressText = document.getElementById("batch-progress-text");

    async function loadGradebook(courseId) {
      if (!rosterArea) {
        console.error("[Teacher] #roster-area missing");
        return;
      }
      rosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">正在加载班级成绩表与评测状态...</p>';
      try {
        const data = await ScipOJPlatform.getTeacherRoster(courseId);
        currentRosterData = data || [];
        updateFacultyMetrics(currentRosterData);

        await loadCourseAssignments(courseId);
        updateProblemFilterOptions();

        renderGradebookTable();
      } catch (err) {
        console.error("[Teacher] loadGradebook failed:", err);
        rosterArea.innerHTML = `<p class="fail" style="padding:1rem;">加载成绩簿失败: ${esc(err.message)}</p>`;
      }
    }

    function updateFacultyMetrics(rows) {
      const students = rows.filter(r => r.enroll_role === "student");
      const studentCount = new Set(students.map(r => r.user_id).filter(Boolean)).size;
      const graded = students.filter(r => r.best_score != null && Number.isFinite(Number(r.best_score)));
      const passCount = graded.filter(r => r.passed === true).length;
      const values = {
        "metric-students": studentCount,
        "metric-graded": graded.length,
        "metric-passrate": graded.length ? Math.round(passCount / graded.length * 100) + "%" : "—",
      };
      for (const [id, value] of Object.entries(values)) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
      }
    }

    // 首屏加载：紧跟 loadGradebook 定义，避免后面绑定事件抛错导致永远不加载
    if (currentCourseId) {
      updateCourseInviteDisplay();
      void loadGradebook(currentCourseId);
    }

    function updateProblemFilterOptions() {
      const currentVal = filterProblem.value;
      const problemsSet = new Set(currentRosterData.map(r => r.problem_id).filter(Boolean));
      currentAssignmentsList.forEach(a => problemsSet.add(a.problem_id));

      const problems = Array.from(problemsSet).sort();
      filterProblem.innerHTML = '<option value="">全部题目</option>' +
        problems.map(p => `<option value="${p}">${p}</option>`).join("");

      if (problems.includes(currentVal)) {
        filterProblem.value = currentVal;
      }
    }

    function getFilteredRoster() {
      const p = filterProblem.value;
      const kw = (filterKeyword.value || '').trim().toLowerCase();

      return currentRosterData.filter(row => {
        if (p && row.problem_id !== p) return false;
        if (kw) {
          const matchNo = (row.student_no || '').toLowerCase().includes(kw);
          const matchName = (row.display_name || '').toLowerCase().includes(kw);
          if (!matchNo && !matchName) return false;
        }
        return true;
      });
    }

    if (filterProblem) filterProblem.onchange = () => renderGradebookTable();
    if (filterKeyword) filterKeyword.oninput = () => renderGradebookTable();
    if (btnRefresh) {
      btnRefresh.onclick = async () => {
        if (!currentCourseId) return;
        btnRefresh.disabled = true;
        const original = btnRefresh.textContent;
        btnRefresh.textContent = "刷新中…";
        try {
          await loadGradebook(currentCourseId);
          ScipOJPlatform.showToast("成绩表已刷新", "success");
        } catch (err) {
          ScipOJPlatform.showToast("刷新失败: " + err.message, "error");
        } finally {
          btnRefresh.disabled = false;
          btnRefresh.textContent = original;
        }
      };
    }

    function renderGradebookTable() {
      const filtered = getFilteredRoster();
      if (filtered.length === 0) {
        rosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1.25rem;">当前筛选条件下暂无成绩记录。</p>';
        return;
      }

      const table = document.createElement("table");
      table.className = "roster-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th style="width:36px; text-align:center;"><input type="checkbox" id="check-all-rows" title="全选 / 反选" /></th>
            <th>学号</th>
            <th>姓名</th>
            <th>题目</th>
            <th>最优成绩</th>
            <th>判定</th>
            <th>迟交标记</th>
            <th>提交轮次</th>
            <th>最后提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((row, idx) => {
            const passScore = row.pass_score ?? 90;
            const isPass = row.best_score != null && row.best_score >= passScore;
            const curAssign = currentAssignmentsList.find(a => a.id === row.assignment_id || a.problem_id === row.problem_id);
            const isLate = curAssign?.due_at && row.last_submitted_at ? new Date(row.last_submitted_at) > new Date(curAssign.due_at) : false;

            return `
              <tr data-sub-id="${esc(row.best_submission_id || '')}">
                <td style="text-align:center;">
                  <input type="checkbox" class="row-checkbox" data-sub-id="${esc(row.best_submission_id || '')}" ${row.best_submission_id ? '' : 'disabled title="暂无有效提交"'} />
                </td>
                <td><strong>${esc(row.student_no || '-')}</strong></td>
                <td>${esc(row.display_name || '-')}${row.enroll_role && row.enroll_role !== 'student' ? ' <span class="tag-pending" title="教师/助教账号的正式提交烟测">试交</span>' : ''}</td>
                <td><code>${esc(row.problem_id || '-')}</code></td>
                <td>
                  ${row.best_score != null
                    ? `<strong class="${isPass ? 'pass' : 'fail'}">${row.best_score} 分</strong>`
                    : '<span style="color:var(--text-secondary);">未出分</span>'}
                </td>
                <td>${row.best_score == null
                  ? '<span class="tag-pending">— 未提交</span>'
                  : (row.passed ? '<span class="tag-normal">✓ 通过</span>' : '<span class="tag-late">✗ 未通过</span>')}</td>
                <td>${isLate ? '<span class="tag-late">迟交</span>' : '<span class="tag-normal">正常</span>'}</td>
                <td>${row.attempt_count != null ? `第 ${row.attempt_count} 次` : '-'}</td>
                <td style="color:var(--text-secondary); font-size:0.8rem;">${row.last_submitted_at ? formatTime(row.last_submitted_at) : '-'}</td>
                <td>
                  <button type="button" class="btn-view-evidence btn-secondary" data-idx="${idx}" style="font-size:0.75rem; padding:0.25rem 0.55rem;">
                    查看证据
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      `;

      rosterArea.innerHTML = "";
      rosterArea.appendChild(table);

      // 全选 / 反选
      const checkAll = document.getElementById("check-all-rows");
      if (checkAll) {
        checkAll.onchange = () => {
          table.querySelectorAll(".row-checkbox:not(:disabled)").forEach(cb => {
            cb.checked = checkAll.checked;
          });
        };
      }

      // 绑定查看证据按钮
      table.querySelectorAll(".btn-view-evidence").forEach(btn => {
        btn.onclick = () => {
          const row = filtered[parseInt(btn.dataset.idx, 10)];
          showSubmissionEvidence(row);
        };
      });
    }

    // ── 证据台展示 ──
    async function showSubmissionEvidence(row) {
      const detailSection = document.getElementById("submission-detail");
      const detailTitle = document.getElementById("detail-title");
      const detailCode = document.getElementById("detail-code");
      const detailReport = document.getElementById("detail-report");
      const detailTimeline = document.getElementById("detail-timeline");
      const btnRegrade = document.getElementById("btn-regrade");
      const btnCloseDetail = document.getElementById("btn-close-detail");
      const btnCopyCode = document.getElementById("btn-copy-student-code");
      const btnCopyReport = document.getElementById("btn-copy-student-report");

      detailSection.hidden = false;
      detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
      detailTitle.textContent = `评测证据：${row.student_no || '-'} ${row.display_name || ''} · 题目 ${row.problem_id || ''}`;
      detailCode.textContent = "正在获取学生提交源码...";
      detailReport.textContent = "正在获取评测报告...";
      detailTimeline.innerHTML = '<li style="color:var(--text-secondary);">加载评测时间线中...</li>';

      if (btnCloseDetail) {
        btnCloseDetail.onclick = () => { detailSection.hidden = true; };
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
        if (latest) subId = latest.id;
      }

      if (!subId) {
        detailCode.textContent = "（该学生在此题目下暂无提交代码）";
        detailReport.textContent = "（无报告）";
        detailTimeline.innerHTML = '<li style="color:var(--text-secondary);">尚无评测流水记录</li>';
        btnRegrade.disabled = true;
        return;
      }

      btnRegrade.disabled = false;

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

        if (error || !subData) throw error || new Error("未找到指定提交记录");

        detailCode.textContent = subData.code_text || "（空代码内容）";

        const { latestAttempt:latestGrading, effectiveGrade } = window.ScipOJGradingState.normalizeSubmission(subData);

        if (latestGrading) {
          const reportObj = latestGrading.report_json;
          detailReport.textContent = reportObj
            ? JSON.stringify(reportObj, null, 2)
            : (latestGrading.error_message ? `系统错误说明: ${latestGrading.error_message}` : "评测记录尚在队列中。");
        } else {
          detailReport.textContent = "暂无评分记录";
        }

        if (effectiveGrade && effectiveGrade.id !== latestGrading?.id) {
          detailReport.textContent += `\n\n当前有效成绩：${effectiveGrade.score} 分（最近一次成功评测）`;
        }
        if (subData.metadata?.integrity) {
          detailReport.textContent += "\n\n--- 考试模式记录（浏览器自报；不可直接认定作弊） ---\n" +
            JSON.stringify(subData.metadata.integrity, null, 2);
        }

        renderTimeline(detailTimeline, subData, latestGrading);

        // 绑定单条复判
        btnRegrade.onclick = async () => {
          const reason = await ScipOJPlatform.showPromptDialog({
            title: "发起单条复判",
            message: "请输入复判原因（将写入系统审计日志 grade_audits）。",
            defaultValue: "教师抽查复判",
            confirmText: "确认复判",
            required: true,
          });
          if (reason === null) return;
          btnRegrade.disabled = true;
          btnRegrade.textContent = "调度复判中…";
          try {
            await ScipOJPlatform.requestRegrade(subData.id, reason);
            ScipOJPlatform.showToast("复判任务已进入评测队列！", "success");
            if (currentCourseId) await loadGradebook(currentCourseId);
            showSubmissionEvidence(row);
          } catch (err) {
            ScipOJPlatform.showToast("发起复判失败: " + err.message, "error");
          } finally {
            btnRegrade.disabled = false;
            btnRegrade.textContent = "🔄 发起单条复判（重测入库）";
          }
        };

      } catch (err) {
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
        } else if (grading.status === "done") {
          items.push({
            title: `评测完成：得分 ${grading.score} 分 (${grading.passed ? '✓ 通过及格线' : '✗ 未通过'})`,
            time: formatTime(grading.finished_at || grading.created_at),
            state: "done",
            desc: `HMAC 验签入库 · Runner: ${grading.runner_ref || 'Actions Runner'}`,
          });
        } else if (grading.status === "system_error") {
          items.push({
            title: "评测系统故障 (已隔离，不扣除学生分数)",
            time: formatTime(grading.finished_at || grading.created_at),
            state: "error",
            desc: grading.error_message || "环境依赖或运行时异常",
          });
        }
      } else {
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

    // ── 批量复判 ──
    if (btnBatchRegrade) {
      btnBatchRegrade.onclick = async () => {
        const checkedBoxes = document.querySelectorAll(".roster-table .row-checkbox:checked");
        const ids = Array.from(checkedBoxes).map(cb => cb.dataset.subId).filter(Boolean);

        if (ids.length === 0) {
          ScipOJPlatform.showToast("请先勾选需要复判的学生提交记录", "warning");
          return;
        }

        const reason = await ScipOJPlatform.showPromptDialog({
          title: "批量复判",
          message: `确定要对选中的 ${ids.length} 条提交发起批量复判吗？复判说明将写入审计日志。`,
          defaultValue: "教师批量抽查复判",
          confirmText: `确认复判 ${ids.length} 条`,
          required: true,
        });
        if (reason === null) return;

        btnBatchRegrade.disabled = true;
        batchProgressBar.hidden = false;
        batchProgressText.textContent = `正在调度批量复判 (0/${ids.length})…`;

        try {
          const res = await ScipOJPlatform.requestBatchRegrade(ids, reason, (curr, total) => {
            batchProgressText.textContent = `正在调度批量复判 (${curr}/${total})…`;
          });
          const okCount = Number(res.success_count || 0);
          const failures = (res.results || []).filter(r => !r.success);
          if (failures.length > 0) {
            ScipOJPlatform.showToast(
              `批量复判：成功 ${okCount} 条，失败 ${failures.length} 条。首个错误：${failures[0].error || "未知错误"}`,
              "warning",
            );
          } else {
            ScipOJPlatform.showToast(`批量复判调度完成！共触发 ${okCount} 条评测任务。`, "success");
          }
          if (currentCourseId) await loadGradebook(currentCourseId);
        } catch (err) {
          ScipOJPlatform.showToast("批量复判请求异常: " + err.message, "error");
        } finally {
          btnBatchRegrade.disabled = false;
          batchProgressBar.hidden = true;
        }
      };
    }

    // ── 整题一键重判 ──
    if (btnRegradeProblem) {
      btnRegradeProblem.onclick = async () => {
        const p = filterProblem.value;
        if (!p) {
          ScipOJPlatform.showToast("请先在上方「题目」下拉框中选择要重判的特定题目", "warning");
          return;
        }

        const confirmed = await ScipOJPlatform.showConfirmDialog({
          title: "整题一键重判",
          message: `警告：整题重判将重新评测全班所有学生在题目 ${p} 的提交。\n通常在教师更新测例或修复参考实现后使用。\n\n确定继续吗？`,
          confirmText: "继续重判",
          danger: true,
        });
        if (!confirmed) return;

        const reason = await ScipOJPlatform.showPromptDialog({
          title: "整题重判原因",
          message: `请填写题目 ${p} 的重判原因（写入审计日志）。`,
          defaultValue: `测例更新整题重判 (${p})`,
          confirmText: "确认重判",
          required: true,
        });
        if (reason === null) return;

        btnRegradeProblem.disabled = true;
        batchProgressBar.hidden = false;
        batchProgressText.textContent = `正在调度题目 ${p} 的全班提交重判…`;

        try {
          const res = await ScipOJPlatform.requestProblemRegrade(currentCourseId, p, reason, (curr, total) => {
            batchProgressText.textContent = `正在重判 ${p} (${curr}/${total})…`;
          });
          const okCount = Number(res.success_count || 0);
          const total = Number(res.total || okCount);
          const failures = (res.results || []).filter(r => !r.success);
          ScipOJPlatform.showToast(
            failures.length > 0
              ? `整题重判：成功 ${okCount}/${total} 条，失败 ${failures.length} 条。首个错误：${failures[0].error || "未知错误"}`
              : `整题重判已调度入队！共触发 ${okCount} 条。`,
            failures.length > 0 ? "warning" : "success",
          );
          if (currentCourseId) await loadGradebook(currentCourseId);
        } catch (err) {
          ScipOJPlatform.showToast("整题重判失败: " + err.message, "error");
        } finally {
          btnRegradeProblem.disabled = false;
          batchProgressBar.hidden = true;
        }
      };
    }

    // ── 导出成绩 CSV ──
    if (btnExportCsv) {
      btnExportCsv.onclick = () => {
        const filtered = getFilteredRoster();
        if (filtered.length === 0) {
          ScipOJPlatform.showToast("当前筛选条件下暂无成绩记录可供导出", "info");
          return;
        }

        const headers = ["学号", "姓名", "题目", "最高分", "是否通过", "迟交状态", "提交轮次", "最后提交时间"];
        const rows = filtered.map(row => {
          const passScore = row.pass_score ?? 90;
          const isPass = row.best_score != null && row.best_score >= passScore;
          const curAssign = currentAssignmentsList.find(a => a.id === row.assignment_id || a.problem_id === row.problem_id);
          const isLate = curAssign?.due_at && row.last_submitted_at ? new Date(row.last_submitted_at) > new Date(curAssign.due_at) : false;

          return [
            row.student_no || "",
            row.display_name || "",
            row.problem_id || "",
            row.best_score != null ? row.best_score : "",
            isPass ? "通过" : "未通过",
            isLate ? "迟交" : "正常",
            row.attempt_count != null ? row.attempt_count : "",
            row.last_submitted_at || "",
          ];
        });

        // 写入 UTF-8 BOM，防止 Excel 打开乱码；
        // 同时对 =/+/-/@ 开头的单元格加前缀，避免 CSV 公式注入（学生姓名可被构造）
        const escapeCell = (value) => {
          let text = String(value ?? "");
          if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
          return `"${text.replace(/"/g, '""')}"`;
        };
        const csvContent = "\uFEFF" + [headers, ...rows]
          .map(r => r.map(escapeCell).join(","))
          .join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const pTag = filterProblem.value ? `-${filterProblem.value}` : "";
        a.download = `scip-oj-gradebook-${new Date().toISOString().slice(0, 10)}${pTag}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        ScipOJPlatform.showToast("成绩 CSV 导出成功", "success");
      };
    }

    // ──────────────────────────────────────────────────────────
    // TAB 2: 花名册管理与 CSV 导入
    // ──────────────────────────────────────────────────────────
    const csvInputText = document.getElementById("csv-input-text");
    const csvFilePicker = document.getElementById("csv-file-picker");
    const btnTriggerFile = document.getElementById("btn-trigger-file");
    const btnSubmitCsv = document.getElementById("btn-submit-csv");
    const csvImportStatus = document.getElementById("csv-import-status");
    const pendingRosterArea = document.getElementById("pending-roster-area");

    if (btnTriggerFile && csvFilePicker) {
      btnTriggerFile.onclick = () => csvFilePicker.click();
      csvFilePicker.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          csvInputText.value = evt.target.result;
          csvImportStatus.textContent = `已载入文件 ${file.name} (${Math.round(file.size / 1024)} KB)`;
          csvImportStatus.className = "pass";
        };
        reader.readAsText(file, "utf-8");
      };
    }

    if (btnSubmitCsv) {
      btnSubmitCsv.onclick = async () => {
        if (!currentCourseId) return;
        const content = csvInputText.value.trim();
        if (!content) {
          ScipOJPlatform.showToast("请先输入或从文件载入 CSV 内容", "warning");
          return;
        }

        btnSubmitCsv.disabled = true;
        btnSubmitCsv.textContent = "导入中…";
        csvImportStatus.textContent = "";

        try {
          const res = await ScipOJPlatform.importRosterCSV(currentCourseId, content);
          csvImportStatus.textContent = `✓ 导入 ${res.total} 条花名册；学号自动匹配后仍需教师本人核验，考试才可提交。`;
          csvImportStatus.className = "pass";
          csvInputText.value = "";
          await loadPendingRoster(currentCourseId);
          ScipOJPlatform.showToast(`成功导入 ${res.total} 名学生花名册`, "success");
        } catch (err) {
          csvImportStatus.textContent = `❌ 导入失败: ${err.message}`;
          csvImportStatus.className = "fail";
          ScipOJPlatform.showToast("导入失败: " + err.message, "error");
        } finally {
          btnSubmitCsv.disabled = false;
          btnSubmitCsv.textContent = "确认导入名单";
        }
      };
    }

    async function loadPendingRoster(courseId) {
      if (!pendingRosterArea) return;
      pendingRosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">正在获取花名册状态...</p>';

      try {
        const [rosterPending, verifiedRows] = await Promise.all([
          ScipOJPlatform.getPendingRoster(courseId),
          ScipOJPlatform.getVerifiedRoster(courseId),
        ]);
        const verifiedSet = new Set(verifiedRows.map(v => v.roster_id));

        if (rosterPending.length === 0) {
          pendingRosterArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">当前班级暂无导入的花名册。可在上方粘贴或载入 CSV 进行预置。</p>';
          return;
        }

        const matchedList = rosterPending.filter(r => r.status === "matched");
        const pendingList = rosterPending.filter(r => r.status === "pending");
        const verifiedCount = rosterPending.filter(r => verifiedSet.has(r.id)).length;

        let html = `
          <div style="display:flex; gap:1rem; margin-bottom:1rem; flex-wrap:wrap; padding:0.5rem 0;">
            <div class="user-badge" style="background:var(--bg-subtle); color:var(--text-primary); border:1px solid var(--border-default); padding:0.4rem 0.8rem; font-size:0.85rem;">
              预置花名册总数：<strong>${rosterPending.length}</strong>
            </div>
            <div class="user-badge" style="background:var(--color-pass-bg); color:var(--color-pass); border:1px solid var(--color-pass-border); padding:0.4rem 0.8rem; font-size:0.85rem;">
              学号自动匹配：<strong>${matchedList.length}</strong>
            </div>
            <div class="user-badge" style="background:var(--color-warn-bg); color:var(--color-warn); border:1px solid var(--color-warn-border); padding:0.4rem 0.8rem; font-size:0.85rem;">
              教师已核验：<strong>${verifiedCount}</strong>
            </div>
          </div>
          <table class="roster-table">
            <thead>
              <tr>
                <th>学号</th>
                <th>真实姓名</th>
                <th>指定 GitHub 登录名</th>
                <th>对齐状态</th>
                <th>教师人工核验</th>
              </tr>
            </thead>
            <tbody>
              ${rosterPending.map(r => `
                <tr>
                  <td><strong>${esc(r.student_no)}</strong></td>
                  <td>${esc(r.display_name)}</td>
                  <td>${r.github_login ? `<code>${esc(r.github_login)}</code>` : '<span style="color:var(--text-secondary);">未限定</span>'}</td>
                  <td>
                    ${r.status === "matched"
                      ? '<span class="tag-pending">学号已匹配（未必已核验）</span>'
                      : '<span class="tag-pending">⏳ 待绑定登录</span>'}
                  </td>
                  <td style="color:var(--text-secondary); font-size:0.82rem;">
                    ${verifiedSet.has(r.id) ? '<span class="tag-matched">✓ 教师已核验</span>' : r.status === "matched" && r.matched_user_id ? `<button type="button" class="btn-secondary" data-verify-roster="${esc(r.id)}">核验本人身份</button>` : "尚未匹配"}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

        pendingRosterArea.innerHTML = html;
        pendingRosterArea.querySelectorAll("button[data-verify-roster]").forEach(button => {
          button.onclick = async () => {
            const row = rosterPending.find(r => r.id === button.dataset.verifyRoster);
            if (!row || !row.matched_user_id) return;
            const okay = await ScipOJPlatform.showConfirmDialog({
              title: "教师核验学生本人",
              message: `请先在线下通过课程/学校可信渠道核验学生本人和 GitHub 账号。仅相同学号不能证明身份。

花名册学号：${row.student_no}
姓名：${row.display_name}
指定 GitHub 登录名：${row.github_login || "未指定"}`,
              confirmText: "已核对本人，确认",
            });
            if (!okay) return;
            button.disabled = true;
            try {
              await ScipOJPlatform.confirmRosterIdentity(row.id, row.matched_user_id);
              ScipOJPlatform.showToast("已写入教师人工核验记录", "success");
              await loadPendingRoster(courseId);
            } catch (error) {
              ScipOJPlatform.showToast(error.message, "error");
              button.disabled = false;
            }
          };
        });
      } catch (err) {
        pendingRosterArea.innerHTML = `<p class="fail" style="padding:1rem;">获取花名册状态失败: ${esc(err.message)}</p>`;
      }
    }

    // ──────────────────────────────────────────────────────────
    // TAB 3: 发布与调整作业
    // ──────────────────────────────────────────────────────────
    const formPublish = document.getElementById("form-publish-assignment");
    const assignProblemSelect = document.getElementById("assign-problem-select");
    const assignCustomProblem = document.getElementById("assign-custom-problem");
    const assignDueAt = document.getElementById("assign-due-at");
    const assignPassScore = document.getElementById("assign-pass-score");
    const assignInstances = document.getElementById("assign-instances");
    const assignPolicy = document.getElementById("assign-policy");
    const assignIntegrityPolicy = document.getElementById("assign-integrity-policy");
    const publishStatus = document.getElementById("publish-status");
    const courseAssignmentsArea = document.getElementById("course-assignments-area");

    // 扫描题目列表填充下拉框
    async function initProblemOptions() {
      try {
        const resp = await fetch("problems/index.json");
        if (resp.ok) {
          const list = await resp.json();
          assignProblemSelect.innerHTML = list.map(p =>
            `<option value="${p.id}">${p.id} - ${p.title}</option>`
          ).join('') + '<option value="__custom__">+ 手动输入其它题号...</option>';
        }
      } catch (e) {
        console.warn("获取 problems/index.json 失败:", e);
      }
    }
    initProblemOptions();

    if (assignProblemSelect) {
      assignProblemSelect.onchange = () => {
        assignCustomProblem.hidden = (assignProblemSelect.value !== "__custom__");
      };
    }

    if (formPublish) {
      formPublish.onsubmit = async (e) => {
        e.preventDefault();
        if (!currentCourseId) {
          ScipOJPlatform.showToast("请先选择教学班级", "warning");
          return;
        }

        let pId = assignProblemSelect.value;
        if (pId === "__custom__") {
          pId = assignCustomProblem.value.trim().toUpperCase();
        }
        if (!pId) {
          ScipOJPlatform.showToast("请选择或输入有效的题目编号", "warning");
          return;
        }

        let dueVal = null;
        if (assignDueAt.value) {
          const d = new Date(assignDueAt.value);
          if (Number.isNaN(d.getTime())) {
            publishStatus.textContent = "❌ 截止时间格式不正确";
            publishStatus.className = "fail";
            return;
          }
          dueVal = d.toISOString();
        }
        const passScoreVal = parseInt(assignPassScore.value, 10);
        const instancesVal = parseInt(assignInstances.value, 10);
        const policyVal = assignPolicy.value;

        if (!Number.isInteger(passScoreVal) || passScoreVal < 0 || passScoreVal > 100) {
          publishStatus.textContent = "❌ 及格线必须是 0-100 的整数（默认 90）";
          publishStatus.className = "fail";
          return;
        }
        if (!Number.isInteger(instancesVal) || instancesVal < 1 || instancesVal > 20) {
          publishStatus.textContent = "❌ 测试实例数必须是 1-20 的整数";
          publishStatus.className = "fail";
          return;
        }

        const btnSave = document.getElementById("btn-save-assignment");
        btnSave.disabled = true;
        btnSave.textContent = "保存配置中…";
        publishStatus.textContent = "";

        try {
          await ScipOJPlatform.publishAssignment({
            course_id: currentCourseId,
            problem_id: pId,
            due_at: dueVal,
            pass_score: passScoreVal,
            n_instances: instancesVal,
            score_policy: policyVal,
            integrity_policy: assignIntegrityPolicy?.value || "standard",
          });

          publishStatus.textContent = `✓ 作业 ${pId} 已成功发布/保存至当前班级！`;
          publishStatus.className = "pass";
          ScipOJPlatform.showToast(`作业 ${pId} 配置发布成功！`, "success");
          await loadCourseAssignments(currentCourseId);
          updateProblemFilterOptions();
        } catch (err) {
          publishStatus.textContent = `❌ 保存失败: ${err.message}`;
          publishStatus.className = "fail";
          ScipOJPlatform.showToast("保存作业失败: " + err.message, "error");
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = "发布 / 保存作业配置";
        }
      };
    }

    async function loadCourseAssignments(courseId) {
      if (!courseAssignmentsArea) return;
      try {
        const sb = ScipOJPlatform.getSupabase();
        const { data, error } = await sb
          .from("assignments")
          .select("*")
          .eq("course_id", courseId)
          .order("problem_id", { ascending: true });

        if (error) throw error;
        currentAssignmentsList = data || [];

        if (currentAssignmentsList.length === 0) {
          courseAssignmentsArea.innerHTML = '<p style="color:var(--text-secondary); padding:1rem;">当前班级尚未开放任何正式作业。</p>';
          return;
        }

        const policyNames = {
          highest_before_due: "截止前最高分 (默认)",
          latest: "最新提交分",
          highest: "历史最高分",
        };

        courseAssignmentsArea.innerHTML = `
          <table class="roster-table">
            <thead>
              <tr>
                <th>题目编号</th>
                <th>截止时间</th>
                <th>及格线</th>
                <th>测试实例数</th>
                <th>计分规则</th>
                <th>考试策略</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${currentAssignmentsList.map((a, idx) => `
                <tr>
                  <td><code>${esc(a.problem_id)}</code></td>
                  <td>${a.due_at ? formatTime(a.due_at) : '<span style="color:var(--color-pass);">长期有效</span>'}</td>
                  <td>${a.pass_score} 分</td>
                  <td>${a.n_instances} 实例</td>
                  <td>${policyNames[a.score_policy] || a.score_policy}</td>
                  <td>${a.integrity_policy === "exam_block" ? "限制粘贴" : a.integrity_policy === "exam_warn" ? "监测提示" : "普通"}</td>
                  <td>
                    <button type="button" class="btn-edit-assign btn-secondary" data-idx="${idx}" style="font-size:0.75rem; padding:0.25rem 0.55rem;">
                      填入表单修改
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

        courseAssignmentsArea.querySelectorAll(".btn-edit-assign").forEach(btn => {
          btn.onclick = () => {
            const a = currentAssignmentsList[parseInt(btn.dataset.idx, 10)];
            if (!a) return;
            if ([...assignProblemSelect.options].some(o => o.value === a.problem_id)) {
              assignProblemSelect.value = a.problem_id;
              assignCustomProblem.hidden = true;
            } else {
              assignProblemSelect.value = "__custom__";
              assignCustomProblem.hidden = false;
              assignCustomProblem.value = a.problem_id;
            }
            if (a.due_at) {
              const d = new Date(a.due_at);
              const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
              assignDueAt.value = localIso;
            } else {
              assignDueAt.value = "";
            }
            assignPassScore.value = a.pass_score || 90;
            assignInstances.value = a.n_instances || 3;
            assignPolicy.value = a.score_policy || "highest_before_due";
            if (assignIntegrityPolicy) assignIntegrityPolicy.value = a.integrity_policy || "standard";
            formPublish.scrollIntoView({ behavior: "smooth" });
          };
        });
      } catch (err) {
        courseAssignmentsArea.innerHTML = `<p class="fail" style="padding:1rem;">加载作业列表失败: ${esc(err.message)}</p>`;
      }
    }
  }

  function esc(s) {
    return ScipOJPlatform.escapeHtml(s);
  }

  function formatTime(isoStr) {
    if (!isoStr) return "-";
    try {
      return new Date(isoStr).toLocaleString("zh-CN");
    } catch {
      return isoStr;
    }
  }
})();
