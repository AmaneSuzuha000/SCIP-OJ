import {readPages} from '../platform/pagination.js';
import {requestScope} from './scope.js';
/**
 * SCIP-OJ 教师端相似度初筛模块
 * 基于 scripts/audit_similarity.py 算法：
 * 1. 规范化 Python token (标识符归一为 IDENT, 字面量归一为 NUMBER/STRING, 忽略注释和空白)
 * 2. 7-gram 滑动窗口 Jaccard 相似度计算与 SHA-256 碰撞初筛
 * 3. 严格作为人工复核线索，严禁作为自动定罪依据
 */

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield'
]);

export function tokenizePython(source) {
  if (typeof source !== 'string') return [];
  const tokens = [];
  const tokenRegex = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#.*)|(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([a-zA-Z_][a-zA-Z0-9_]*)|(==|!=|<=|>=|\/\/|\*\*|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|>>|<<)|([+\-*/%&|^~=<>!():,;\[\]{}])/g;

  let match;
  while ((match = tokenRegex.exec(source)) !== null) {
    const [, str, comment, num, ident, op2, op1] = match;
    if (comment) continue;
    if (str) {
      tokens.push('STRING');
    } else if (num) {
      tokens.push('NUMBER');
    } else if (ident) {
      tokens.push(PYTHON_KEYWORDS.has(ident) ? ident : 'IDENT');
    } else if (op2) {
      tokens.push(op2);
    } else if (op1) {
      tokens.push(op1);
    }
  }
  return tokens;
}

export function computeGrams(tokens, width = 7) {
  const gramSet = new Set();
  for (let i = 0; i <= tokens.length - width; i++) {
    gramSet.add(tokens.slice(i, i + width).join(' '));
  }
  return gramSet;
}

export function computeCandidates(submissions, threshold = 0.72) {
  const entries = submissions
    .filter(s => typeof s.code_text === 'string' && s.code_text.trim())
    .map(s => {
      const toks = tokenizePython(s.code_text);
      const g = computeGrams(toks, 7);
      return {
        sub: s,
        grams: g,
        raw: s.code_text
      };
    });

  const candidates = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (!a.sub.assignment_id || a.sub.assignment_id !== b.sub.assignment_id) continue;
      if (!a.sub.user_id || !b.sub.user_id || a.sub.user_id === b.sub.user_id) continue;

      const exact = (a.sub.code_hash && b.sub.code_hash && a.sub.code_hash === b.sub.code_hash) ||
                    (a.raw === b.raw);

      let intersection = 0;
      for (const item of a.grams) {
        if (b.grams.has(item)) intersection++;
      }
      const unionSize = a.grams.size + b.grams.size - intersection;
      const similarity = unionSize > 0 ? intersection / unionSize : 0;

      if (exact || (a.grams.size >= 8 && b.grams.size >= 8 && similarity >= threshold)) {
        candidates.push({
          assignment_id: a.sub.assignment_id,
          submission_a: a.sub.id,
          user_a: a.sub.user_id,
          submission_b: b.sub.id,
          user_b: b.sub.user_id,
          same_code_sha256: exact,
          normalized_token_7gram_jaccard: Math.round(similarity * 10000) / 10000,
          review_status: 'manual_review_only',
        });
      }
    }
  }

  return candidates.sort((x, y) => {
    if (x.same_code_sha256 !== y.same_code_sha256) {
      return x.same_code_sha256 ? -1 : 1;
    }
    return y.normalized_token_7gram_jaccard - x.normalized_token_7gram_jaccard;
  });
}

export function create(context, { esc, formatTime }) {
  async function runSimilarityAuditForCurrentProblem() {
    const problemId = (context.filterProblem?.value || '').trim();
    if (!problemId) {
      window.ScipOJPlatform?.showToast('请先在「题目」下拉框中选择要初筛相似度的具体题目', 'warning');
      return;
    }
    if (!context.currentCourseId) {
      window.ScipOJPlatform?.showToast('未选择有效教学班级', 'warning');
      return;
    }
    const current = requestScope(context, 'similarityRequest');
    const courseId = context.currentCourseId;

    const sb = window.ScipOJPlatform?.getSupabase();
    if (!sb) {
      window.ScipOJPlatform?.showToast('数据库服务未就绪', 'error');
      return;
    }

    try {
      window.ScipOJPlatform?.showToast(`正在检索题目 ${problemId} 的全班提交代码…`, 'info');
      // 1. 查询对应 assignment
      const { data: assignment, error: aErr } = await sb.from('assignments')
        .select('id, problem_id')
        .eq('course_id', courseId)
        .eq('problem_id', problemId.toUpperCase())
        .maybeSingle();
      if (!current()) return;

      if (aErr) throw new Error('查询作业配置失败: ' + aErr.message);
      if (!assignment) throw new Error(`未找到题目 ${problemId} 对应的作业记录`);

      // 2. 查询该作业的所有提交代码
      const subs = await readPages(() => sb.from('submissions')
        .select('id, user_id, assignment_id, code_text, code_hash, created_at, attempt_no')
        .eq('assignment_id', assignment.id)
        .order('created_at', { ascending: false }).order('id'));

      if (!current()) return;
      if (!subs || subs.length === 0) {
        window.ScipOJPlatform?.showToast(`题目 ${problemId} 暂无任何学生提交记录`, 'info');
        return;
      }

      // 仅保留每位学生的最新提交进行比对，减少冗余
      const latestByUser = new Map();
      for (const s of subs) {
        if (!latestByUser.has(s.user_id)) {
          latestByUser.set(s.user_id, s);
        }
      }
      const uniqueSubs = Array.from(latestByUser.values());

      if (uniqueSubs.length < 2) {
        window.ScipOJPlatform?.showToast(`题目 ${problemId} 目前仅有 ${uniqueSubs.length} 位学生提交，无法进行两两比对`, 'info');
        return;
      }

      // 3. 计算初筛候选
      const pairs = computeCandidates(uniqueSubs, 0.72);

      // 构建用户学号姓名映射字典
      const userMap = new Map();
      (context.currentRosterData || []).forEach(r => {
        if (r.user_id) {
          userMap.set(r.user_id, {
            student_no: r.student_no || '-',
            display_name: r.display_name || '-'
          });
        }
      });

      const exportRows = pairs.map(p => {
        const uA = userMap.get(p.user_a) || { student_no: '-', display_name: '-' };
        const uB = userMap.get(p.user_b) || { student_no: '-', display_name: '-' };
        return {
          ...p,
          student_a_no: uA.student_no,
          student_a_name: uA.display_name,
          student_b_no: uB.student_no,
          student_b_name: uB.display_name,
          problem_id: problemId,
        };
      });

      // 4. 导出 CSV 与 JSON 下载
      const notice = 'Similarity is a review lead only. Shared templates, common algorithms, and collaboration policies can produce false positives. Never automatically penalize.';
      const headers = ['题目', '学生A学号', '学生A姓名', '提交A编号', '学生B学号', '学生B姓名', '提交B编号', '代码完全哈希一致', '规范化7-gram相似度', '人工核验说明'];
      const escapeCell = (v) => {
        let text = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return `"${text.replace(/"/g, '""')}"`;
      };

      const csvContent = '\uFEFF' + [
        headers,
        ...exportRows.map(r => [
          r.problem_id,
          r.student_a_no,
          r.student_a_name,
          r.submission_a,
          r.student_b_no,
          r.student_b_name,
          r.submission_b,
          r.same_code_sha256 ? '是' : '否',
          r.normalized_token_7gram_jaccard,
          '仅供人工复核线索，严禁自动定罪'
        ])
      ].map(row => row.map(escapeCell).join(',')).join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `similarity_${problemId}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (exportRows.length === 0) {
        window.ScipOJPlatform?.showToast(`初筛完成：题目 ${problemId}（${uniqueSubs.length} 位学生）未检出高相似度候选`, 'success');
      } else {
        window.ScipOJPlatform?.showToast(`初筛完成：检出 ${exportRows.length} 对高相似度候选（阈值 0.72），已导出 CSV`, 'success');
      }
    } catch (err) {
      console.error('[Teacher] 相似度初筛失败:', err);
      window.ScipOJPlatform?.showToast('相似度初筛失败: ' + (err.message || '未知错误'), 'error');
    }
  }

  return {
    runSimilarityAuditForCurrentProblem
  };
}
