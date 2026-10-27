import {state} from './state.js';
import {leaveNotebookView} from './workbench.js';
import {main} from './bootstrap.js';
import {escapeHtml} from './shared.js';
window.addEventListener('scip-runtime-reset', leaveNotebookView);
main().catch((err) => {
    const el = document.getElementById("problem-list");
    if (el)
        el.innerHTML = `<p class="fail">主应用启动异常: ${escapeHtml(err.message || String(err))}</p>`;
});
import {getCodeValue,setCodeValue} from './shared.js';
import {validNotebookSource,refreshAssignmentMeta} from './workbench.js';
import {renderSubmissionsTable} from './submissions.js';
Object.assign(window,{getCodeValue,setCodeValue,validNotebookSource,renderSubmissionsTable,refreshAssignmentMeta});
