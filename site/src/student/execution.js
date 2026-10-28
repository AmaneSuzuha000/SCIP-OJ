import {state} from './state.js';

let activeRun = null;

export function syncExecutionButtons() {
    const available = state.problemLoaded && window.ScipOJRuntime?.isReady() && !activeRun;
    for (const id of ['btn-grade','btn-run-testcase']) document.getElementById(id).disabled = !available;
    document.getElementById('btn-clear-console').disabled = !!activeRun;
}

export function setRunStatus(kind, message) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-' + kind;
    badge.textContent = message;
    document.getElementById('status').replaceChildren(badge);
    return badge;
}

export function stopPracticeRun(silent = false) {
    if (!activeRun) return;
    const run = activeRun;
    run.finish();
    window.ScipOJRuntime?.reset(new Error('运行已停止；作业代码已保留。'));
    if (!silent) {
        setRunStatus('system_error', '运行已停止');
        document.getElementById('report').textContent = '运行已停止；作业代码已保留。';
    }
}

export function beginPracticeRun() {
    if (activeRun || !window.ScipOJRuntime?.isReady()) return null;
    const problem = state.activeProblemId, sequence = state.openSeq;
    const stop = document.getElementById('btn-stop-run');
    const started = Date.now();
    let message = '正在执行代码…';
    const run = {
        current: () => activeRun === run && state.activeProblemId === problem && state.openSeq === sequence,
        update(value) {
            if (!run.current()) return;
            message = value;
            paint();
        },
        finish() {
            if (activeRun !== run) return;
            clearInterval(timer);
            activeRun = null;
            syncExecutionButtons();
            stop.hidden = true;
        }
    };
    function paint() {
        if (!run.current()) return;
        const badge = setRunStatus('running', message);
        const elapsed = document.createElement('span');
        elapsed.setAttribute('aria-hidden', 'true');
        elapsed.textContent = ` · ${Math.floor((Date.now() - started) / 1000)} 秒`;
        badge.appendChild(elapsed);
        document.getElementById('report').textContent = message;
    }
    const timer = setInterval(paint, 1000);
    activeRun = run;
    syncExecutionButtons();
    stop.hidden = false;
    stop.onclick = () => stopPracticeRun();
    paint();
    return run;
}
