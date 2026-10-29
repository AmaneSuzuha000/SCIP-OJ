import {state} from './state.js';
import {leaveNotebookView} from './workbench.js';
import {main} from './bootstrap.js';
import {escapeHtml} from './shared.js';
import {initEnvironment} from './environment.js';
window.addEventListener('scip-runtime-reset', leaveNotebookView,{signal:window.ScipOJPageSession?.signal});
initEnvironment();
const ready=main().catch((err) => {
    if(document.body.dataset.pageName!=='index.html')return;
    const el = document.getElementById("problem-list");
    if (el)
        el.innerHTML = `<p class="fail">主应用启动异常: ${escapeHtml(err.message || String(err))}</p>`;
});
window.ScipOJPageSession?.ready(ready);
import {getCodeValue,setCodeValue} from './shared.js';
import {validNotebookSource,refreshAssignmentMeta} from './workbench.js';
import {renderSubmissionsTable} from './submissions.js';
Object.assign(window,{getCodeValue,setCodeValue,validNotebookSource,renderSubmissionsTable,refreshAssignmentMeta});
