import {readFile} from 'node:fs/promises';
import navigation from '../js/navigation.js';
import {protectPage} from './access.mjs';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function link(entry, {isIndex, section, page}, extra = '') {
    const href = !isIndex && entry.href.startsWith('#') ? 'index.html' + entry.href : entry.href;
    const current = entry.id === page ? 'page' : entry.id === section ? 'location' : '';
    return `<a class="nav-item${current ? ' active' : ''}" href="${escape(href)}" data-nav-key="${entry.id}"${entry.route ? ` data-route="${entry.route}"` : ''}${current ? ` aria-current="${current}"` : ''}${extra}><img class="ui-icon" src="assets/icons/${entry.icon}.svg" alt="" aria-hidden="true"><span>${escape(entry.label)}</span></a>`;
}
function renderRail(context) {
    const includeCourse=context.isIndex || context.space==='course';
    const group = (space, entries, label) => `<nav class="nav-links" aria-label="${label}" data-space-nav="${space}"${context.space === space ? '' : ' hidden'}>${entries.map(entry => link(entry, context, entry.id === 'problem-list-section' ? ' id="nav-to-assessment"' : '')).join('')}</nav>`;
    const resources = (space, id, title) => `<div class="rail-section" id="${id}" data-space-content="${space}"${context.space === space ? '' : ' hidden'}><p class="rail-section-label">${title}</p><nav class="nav-links" aria-label="${title}">${navigation.resources[space].map(entry => link(entry, context)).join('')}</nav></div>`;
    return `<aside class="studio-rail" aria-label="平台导航"><div class="rail-section" id="rail-primary">${includeCourse?group('course',navigation.course,'课程教学导航'):''}${group('learn',navigation.learn,'拓展学习导航')}</div>
<button type="button" id="btn-course-menu" class="rail-menu-toggle" aria-expanded="false" aria-controls="${includeCourse?'rail-services rail-teacher ':''}rail-learning-resources">更多资源 <img class="ui-icon" src="assets/icons/caret-down.svg" alt="" aria-hidden="true"></button>
${includeCourse?resources('course','rail-services','教学服务'):''}${resources('learn','rail-learning-resources','拓展资源')}
${includeCourse?`<div class="rail-teacher" id="rail-teacher" data-space-content="course"${context.space === 'course' ? '' : ' hidden'}>${link(navigation.teacher,context,' id="teacher-link" hidden')}</div>`:''}</aside>`;
}
export async function renderPage(name, source) {
    if (!source.includes('<!-- PLATFORM_HEADER -->')) return source;
    const template=await readFile(new URL('./header.html',import.meta.url),'utf8');
    const services=source.match(/<template data-header-services>([\s\S]*?)<\/template>/)?.[1] || '';
    const isIndex=name==='index.html', context={...navigation.resolveContext(name),isIndex}, learning=context.space==='learn';
    const values={brand_url:learning?'index.html#learn':isIndex?'#course':'index.html#course',course_url:isIndex?'#course':'index.html#course',learn_url:isIndex?'#learn':'index.html#learn',
        course_active:learning?'':'class="active" aria-current="page"',learn_active:learning?'class="active" aria-current="page"':'',services};
    let header=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]);
    const links=learning?navigation.labs:name==='doc.html'?navigation.guides:name==='teacher.html'?[navigation.teacher,...navigation.guides.slice(1)]:[];
    if (links.length) header+='<nav class="section-navigation" aria-label="当前空间导航">'+links.map(entry => `<a href="${escape(entry.href)}" data-nav-key="${entry.id}"${entry.id===context.page?' class="active" aria-current="page"':''}>${entry.label}</a>`).join('')+'</nav>';
    const rail=renderRail(context);
    source=source.replace('<body',`<body data-page-name="${name}"${isIndex?'':' data-page-frame="shared"'}`);
    if (isIndex) source=source.replace('<!-- PLATFORM_SIDEBAR -->',rail);
    else header+=rail+'<script src="js/page-frame.js?v=ui-foundation1" defer></script>';
    header+='<script src="js/navigation.js?v=journey1"></script><script src="js/page-session.js?v=session1"></script><script src="js/journey.js?v=session1"></script>';
    return protectPage(source.replace(/<template data-header-services>[\s\S]*?<\/template>/,'').replace('<!-- PLATFORM_HEADER -->',header));
}
