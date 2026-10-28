import {state} from './state.js';

let openAttempt = 0;

export async function showStudyNotebook(notebook, sequence) {
    if (sequence !== state.routeSeq) return;
    const attempt = ++openAttempt;
    const current = () => sequence === state.routeSeq && state.studyNotebook === notebook && attempt === openAttempt;
    state.studyNotebook = notebook;
    const workspace = document.getElementById('workspace');
    workspace.hidden = false;
    workspace.classList.add('study-mode');
    document.body.classList.add('workbench-active');
    document.querySelector('.workspace-layout').classList.add('notebook-mode');
    document.querySelector('.editor-container').hidden = true;
    document.getElementById('title').textContent = notebook.title;
    const back = document.getElementById('btn-back-to-list');
    back.href = notebook.space === 'course' ? '#course-labs' : '#learn-notebooks';
    back.textContent = notebook.space === 'course' ? '← 返回课程实验' : '← 返回优化建模';
    const message = document.getElementById('notebook-state');
    message.textContent = '正在打开 Notebook…';
    try {
        await window.ScipOJRuntime.openStudyNotebook(notebook.path);
        if (current()) message.textContent = '';
    } catch (error) {
        if (!current() || error.code === 'NOTEBOOK_CANCELLED') return;
        message.textContent = error.message + ' ';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试打开';
        retry.onclick = () => { if (current()) showStudyNotebook(notebook, sequence); };
        message.appendChild(retry);
    }
}
