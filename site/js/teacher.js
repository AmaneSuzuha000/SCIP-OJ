/**
 * SCIP-OJ 教师面板 — 成绩查看、CSV 导出、复判
 * 依赖: ScipOJPlatform (platform.js)
 */

(async function teacherInit() {
  const noConfigEl = document.getElementById('teacher-no-config');
  const noAuthEl = document.getElementById('teacher-no-auth');
  const panelEl = document.getElementById('teacher-panel');

  // --- Init platform ---
  if (!window.ScipOJPlatform) {
    noConfigEl.hidden = false;
    return;
  }

  const configured = await ScipOJPlatform.init();
  ScipOJPlatform.updateAuthUI();

  if (!configured) {
    noConfigEl.hidden = false;
    return;
  }

  if (!ScipOJPlatform.getUser()) {
    noAuthEl.hidden = false;
    // Re-check after auth changes
    const checkAuth = setInterval(() => {
      if (ScipOJPlatform.getUser()) {
        clearInterval(checkAuth);
        noAuthEl.hidden = true;
        showTeacherPanel();
      }
    }, 500);
    return;
  }

  showTeacherPanel();

  // --- Main panel logic ---
  async function showTeacherPanel() {
    panelEl.hidden = false;

    const courseSelect = document.getElementById('course-select');
    const rosterArea = document.getElementById('roster-area');
    const btnRefresh = document.getElementById('btn-refresh');
    const btnExportCsv = document.getElementById('btn-export-csv');

    let currentRoster = [];
    let currentCourseId = null;

    // Load courses
    try {
      const enrollments = await ScipOJPlatform.getMyCourses();
      const teacherCourses = enrollments.filter(e => e.role === 'teacher' || e.role === 'ta');

      if (teacherCourses.length === 0) {
        courseSelect.innerHTML = '<option>无可用课程（需要教师角色）</option>';
        rosterArea.innerHTML = '<p class="warn">您未被分配为任何课程的教师或助教。</p>';
        return;
      }

      courseSelect.innerHTML = teacherCourses.map(e => {
        const c = e.courses || {};
        return `<option value="${c.id}">${esc(c.code || '')} - ${esc(c.name || c.id)}</option>`;
      }).join('');

      currentCourseId = teacherCourses[0].courses?.id;
      if (currentCourseId) await loadRoster(currentCourseId);
    } catch (err) {
      rosterArea.innerHTML = `<p class="fail">加载课程失败: ${esc(err.message)}</p>`;
    }

    courseSelect.onchange = async () => {
      currentCourseId = courseSelect.value;
      if (currentCourseId) await loadRoster(currentCourseId);
    };

    btnRefresh.onclick = async () => {
      if (currentCourseId) await loadRoster(currentCourseId);
    };

    btnExportCsv.onclick = () => {
      if (currentRoster.length === 0) {
        alert('暂无数据可导出');
        return;
      }
      exportCsv(currentRoster);
    };

    // --- Load roster from gradebook view ---
    async function loadRoster(courseId) {
      rosterArea.innerHTML = '<p style="color:#9aa0a6">加载中...</p>';
      try {
        const data = await ScipOJPlatform.getTeacherRoster(courseId);
        currentRoster = data;

        if (data.length === 0) {
          rosterArea.innerHTML = '<p style="color:#9aa0a6">暂无成绩数据</p>';
          return;
        }

        renderRosterTable(data);
      } catch (err) {
        rosterArea.innerHTML = `<p class="fail">加载失败: ${esc(err.message)}</p>`;
      }
    }

    // --- Render roster as HTML table ---
    function renderRosterTable(data) {
      const table = document.createElement('table');
      table.className = 'roster-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>题目</th>
            <th>最高分</th>
            <th>是否通过</th>
            <th>提交次数</th>
            <th>最后提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((row, idx) => `
            <tr data-idx="${idx}">
              <td>${esc(row.student_no || '-')}</td>
              <td>${esc(row.display_name || '-')}</td>
              <td>${esc(row.problem_id || '-')}</td>
              <td class="${row.best_score >= (row.pass_score || 90) ? 'pass' : 'fail'}">${row.best_score != null ? row.best_score : '-'}</td>
              <td>${row.passed ? '<span class="pass">✓ 通过</span>' : '<span class="fail">✗ 未通过</span>'}</td>
              <td>${row.attempt_count != null ? row.attempt_count : '-'}</td>
              <td>${row.last_submitted_at ? formatTime(row.last_submitted_at) : '-'}</td>
              <td><button class="btn-view-detail" type="button" data-idx="${idx}" style="font-size:0.75rem;padding:0.25rem 0.5rem">查看</button></td>
            </tr>
          `).join('')}
        </tbody>
      `;

      rosterArea.innerHTML = '';
      rosterArea.appendChild(table);

      // Bind detail buttons
      table.querySelectorAll('.btn-view-detail').forEach(btn => {
        btn.onclick = () => {
          const row = data[parseInt(btn.dataset.idx)];
          showSubmissionDetail(row);
        };
      });
    }

    // --- Show submission detail ---
    async function showSubmissionDetail(row) {
      const detailSection = document.getElementById('submission-detail');
      const detailTitle = document.getElementById('detail-title');
      const detailCode = document.getElementById('detail-code');
      const detailReport = document.getElementById('detail-report');
      const btnRegrade = document.getElementById('btn-regrade');

      detailSection.hidden = false;
      detailTitle.textContent = `${row.student_no || '-'} ${row.display_name || ''} — ${row.problem_id || ''}`;
      detailCode.textContent = '加载中...';
      detailReport.textContent = '';

      // Try to load submission details
      try {
        const sb = ScipOJPlatform.getSupabase();
        let subId = row.best_submission_id;

        // 若没有最高分提交 ID，尝试查找最新一次提交
        if (!subId && row.assignment_id && row.user_id) {
          const { data: latestSub } = await sb
            .from('submissions')
            .select('id')
            .eq('user_id', row.user_id)
            .eq('assignment_id', row.assignment_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestSub) subId = latestSub.id;
        }

        if (subId) {
          const { data, error } = await sb
            .from('submissions')
            .select('id, public_code, code_text, attempt_no, created_at, gradings(id, status, score, passed, report_json, error_message, finished_at)')
            .eq('id', subId)
            .maybeSingle();

          if (error) throw error;
          if (data) {
            detailCode.textContent = data.code_text || '（无代码）';
            const grading = (data.gradings && data.gradings.length > 0) ? data.gradings[0] : (data.gradings || null);
            if (grading) {
              const report = grading.report_json ? JSON.stringify(grading.report_json, null, 2) : '';
              detailReport.textContent = `状态: ${grading.status}\n分数: ${grading.score}\n通过: ${grading.passed}\n` +
                (grading.error_message ? `错误: ${grading.error_message}\n` : '') +
                (report ? `\n--- 详细报告 ---\n${report}` : '');
            } else {
              detailReport.textContent = '暂无判分结果';
            }

            // Setup regrade button
            btnRegrade.onclick = async () => {
              const reason = prompt('复判原因（可选）:');
              if (reason === null) return;
              try {
                btnRegrade.disabled = true;
                btnRegrade.textContent = '请求中...';
                await ScipOJPlatform.requestRegrade(data.id, reason || '教师手动复判');
                alert('复判请求已提交');
                if (currentCourseId) await loadRoster(currentCourseId);
              } catch (err) {
                alert('复判失败: ' + err.message);
              } finally {
                btnRegrade.disabled = false;
                btnRegrade.textContent = '复判';
              }
            };
          } else {
            detailCode.textContent = '（未找到提交记录）';
          }
        } else {
          detailCode.textContent = '（该学生暂无提交）';
        }
      } catch (err) {
        detailCode.textContent = '加载失败: ' + err.message;
      }

      // Scroll to detail
      detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // --- CSV export ---
    function exportCsv(data) {
      const headers = ['学号', '姓名', '题目', '最高分', '是否通过', '提交次数', '最后提交时间'];
      const rows = data.map(row => [
        row.student_no || '',
        row.display_name || '',
        row.problem_id || '',
        row.best_score != null ? row.best_score : '',
        row.passed ? '通过' : '未通过',
        row.attempt_count != null ? row.attempt_count : '',
        row.last_submitted_at || '',
      ]);

      const csvContent = '\uFEFF' + // BOM for Excel UTF-8
        [headers, ...rows]
          .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
          .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scip-oj-gradebook-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  // --- Helpers ---
  function esc(s) {
    return ScipOJPlatform.escapeHtml(s);
  }

  function formatTime(isoStr) {
    try {
      return new Date(isoStr).toLocaleString('zh-CN');
    } catch {
      return isoStr;
    }
  }
})();
