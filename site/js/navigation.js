/* Navigation data shared by build-time templates and browser route matching. */
(function (root) {
    'use strict';
    const item = (id, label, href, icon, route) => ({id, label, href, icon, route});
    const course = [
        item('course', '教学概览', '#course', 'house', 'course'),
        item('problem-list-section', '课程作业', '#problem-list-section', 'code', 'problem-list-section'),
        item('submissions', '提交记录', '#submissions', 'clipboard-text', 'submissions'),
        item('course-labs', '课程实验', '#course-labs', 'book-open', 'course-labs'),
    ];
    const learn = [
        item('learn', '学习概览', '#learn', 'house', 'learn'),
        item('case-library', '仿真案例', '#case-library', 'flask', 'case-library'),
        item('learn-notebooks', '优化建模', '#learn-notebooks', 'code', 'learn-notebooks'),
    ];
    const guides = [
        item('student-guide', '学生指南', 'doc.html?f=学生指南.md', 'book-open'),
        item('teacher-guide', '教师指南', 'doc.html?f=教师指南.md', 'file-text'),
        item('author-guide', '出题指南', 'doc.html?f=出题指南.md', 'file-text'),
    ];
    const resources = {
        course: [guides[0], guides[1], item('course-assessments', '作业说明', '#course-assessments', 'list-checks', 'course-assessments')],
        learn: [item('official-examples', '官方建模示例', 'official-examples.html', 'file-text'), item('learning-guide', '拓展学习指南', 'doc.html?f=拓展学习指南.md&space=learn', 'book-open')],
    };
    const labs = [
        item('queue-lab', '检修排队', 'case-studio.html', 'flask'),
        item('inventory-lab', '库存仿真', 'inventory-lab.html', 'package'),
        item('flow-lab', '生产线仿真', 'flow-lab.html', 'factory'),
        item('official-examples', '官方示例', 'official-examples.html', 'file-text'),
    ];
    const teacher = item('teacher', '教师管理', 'teacher.html', 'user');
    const notebooks = [
        ['01_P001_knapsack_PySCIPOpt.ipynb', '0-1 背包问题', 'course'],
        ['02_P002_assignment_PySCIPOpt.ipynb', '指派问题', 'course'],
        ['03_IE_Facility_Location_PySCIPOpt.ipynb', '容量约束设施选址', 'learn'],
        ['04_IE_Bin_Packing_PySCIPOpt.ipynb', '仓储装箱', 'learn'],
        ['05_IE_Flow_Shop_PySCIPOpt.ipynb', '排列流水车间', 'learn'],
        ['06_IE_Stochastic_Inventory_PySCIPOpt.ipynb', '单周期随机库存优化', 'learn'],
    ].map(([path, title, space]) => ({path, title, space}));

    function withParams(hash, values) {
        const [key, search=''] = String(hash||'#course').replace(/^#/,'').split('?');
        const params = new URLSearchParams(search);
        for(const [name,value] of Object.entries(values)) {
            if(value===null||value===undefined||value==='')params.delete(name);else params.set(name,String(value));
        }
        return '#'+key+(params.size?'?'+params.toString():'');
    }
    function parseRoute(hash) {
        const [key, search=''] = String(hash || '').replace(/^#/, '').split('?');
        const params = new URLSearchParams(search);
        const route = matchRoute(key);
        return {...route, params, courseId:params.get('course'), assignmentId:params.get('assignment'),
            tab:params.get('tab')==='history'?'history':'description', console:params.get('console')==='result'?'result':'testcase',
            presentation:params.get('view')==='notebook'?'notebook':'code', submissionId:params.get('submission')};
    }
    function matchRoute(key) {
        if (key.startsWith('notebook/')) {
            let path; try { path = decodeURIComponent(key.slice(9)); } catch { path = ''; }
            const notebook = notebooks.find(entry => entry.path === path);
            if (notebook) return {space:notebook.space, view:'notebook', key, notebook, anchor:null};
        }
        if (['course', 'course-labs', 'course-assessments'].includes(key)) {
            return {space:'course', view:'overview', key, anchor:key === 'course-labs' ? 'course-lab-list' : key === 'course-assessments' ? key : null};
        }
        if (['problem-list-section', 'list'].includes(key)) return {space:'course', view:'problems', key:'problem-list-section', anchor:null};
        if (key === 'submissions') return {space:'course', view:'records', key, anchor:null};
        if (/^[A-Z][A-Z0-9_-]{0,31}$/.test(key)) return {space:'course', view:'problem', key, problemId:key, anchor:null};
        if (['learn', 'case-library', 'learn-notebooks', 'course-cases'].includes(key)) {
            const canonical = key === 'course-cases' ? 'case-library' : key;
            return {space:'learn', view:'overview', key:canonical, anchor:canonical === 'learn' ? null : canonical};
        }
        return {space:'course', view:'overview', key:'course', anchor:null, error:key?'链接不存在或已失效，请从导航选择页面。':null};
    }
    function sectionForRoute(route) {
        return route.view === 'notebook' ? (route.space === 'course' ? 'course-labs' : 'learn-notebooks') : route.view === 'problem' ? 'problem-list-section' : route.key;
    }
    function resolveContext(href) {
        const url = new URL(href, 'https://navigation.invalid/');
        const file = url.pathname.split('/').pop() || 'index.html';
        if (file === 'index.html') {
            const route = parseRoute(url.hash);
            return {space:route.space, section:sectionForRoute(route), page:sectionForRoute(route), returnTo:route.space === 'learn' ? '#learn' : '#course'};
        }
        const lab = labs.find(entry => entry.href === file);
        if (lab) return {space:'learn', section:lab.id === 'official-examples' ? lab.id : 'case-library', page:lab.id, returnTo:'index.html#case-library'};
        if (file === 'teacher.html') return {space:'course', section:'teacher', page:'teacher', returnTo:'index.html#course'};
        const space = url.searchParams.get('space') === 'learn' ? 'learn' : 'course';
        const documentName = (url.searchParams.get('path') || url.searchParams.get('f') || '学生指南.md').split('/').pop();
        const guide = [...guides, ...resources.learn].find(entry => new URL(entry.href, 'https://navigation.invalid/').searchParams.get('f') === documentName);
        const page = guide?.id || 'document';
        return {space, section:page, page, returnTo:'index.html#' + space};
    }
    function applyContext(context, doc = root.document) {
        doc.body.dataset.space = context.space;
        for (const node of doc.querySelectorAll('[data-space-nav],[data-space-content]')) {
            node.hidden = (node.dataset.spaceNav || node.dataset.spaceContent) !== context.space;
        }
        for (const [id, space] of [['nav-course-space','course'], ['nav-learning-space','learn']]) {
            const link = doc.getElementById(id), selected = context.space === space;
            if (!link) continue;
            link.classList.toggle('active', selected);
            if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        }
        for (const link of doc.querySelectorAll('[data-nav-key]')) {
            const id = link.dataset.navKey;
            const selected = id === context.page || id === context.section;
            link.classList.toggle('active', selected);
            if (selected) link.setAttribute('aria-current', id === context.page ? 'page' : 'location');
            else link.removeAttribute('aria-current');
        }
        const secondary = doc.querySelector('.section-navigation');
        if (secondary) secondary.hidden = doc.body.dataset.pageName === 'doc.html' && context.space === 'learn';
        const brand = doc.querySelector('.brand-logo');
        if (brand) brand.href = 'index.html#' + context.space;
    }
    const api = {course, learn, resources, guides, labs, teacher, notebooks, parseRoute, withParams, sectionForRoute, resolveContext, applyContext};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ScipOJNavigation = api;
})(typeof window === 'undefined' ? globalThis : window);
