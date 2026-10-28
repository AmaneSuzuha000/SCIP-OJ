import {state} from './state.js';

export async function showStudyNotebook(notebook, sequence) {
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
        if (sequence === state.routeSeq) message.textContent = '';
    } catch (error) {
        if (sequence === state.routeSeq && error.code !== 'NOTEBOOK_CANCELLED') message.textContent = error.message;
    }
}
