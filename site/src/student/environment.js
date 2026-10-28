import {syncExecutionButtons} from './execution.js';
import {state} from './state.js';
import {showStudyNotebook} from './study.js';

export function initEnvironment() {
    const indicator = document.getElementById('runtime-indicator');
    const label = document.getElementById('runtime-label');
    const retry = document.getElementById('btn-retry-runtime');
    function refresh() {
        const status = window.ScipOJRuntime?.getStatus() || {phase:'error',error:'运行环境脚本未加载'};
        indicator.dataset.state = status.phase;
        label.textContent = {idle:'环境准备中',preparing:'环境准备中',ready:'Python 就绪',running:'Python 就绪',error:'环境不可用'}[status.phase];
        indicator.title = status.error || '';
        retry.hidden = status.phase !== 'error';
        syncExecutionButtons();
    }
    function prepare() {
        if (state.studyNotebook) {
            showStudyNotebook(state.studyNotebook, state.routeSeq);
        } else {
            window.ScipOJRuntime?.prewarm().catch(() => {});
        }
        refresh();
    }
    retry.onclick = prepare;
    window.addEventListener('scip-runtime-state', refresh);
    prepare();
}
