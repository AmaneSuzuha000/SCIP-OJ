import {readFile} from 'node:fs/promises';

const labs=[['case-studio.html','检修排队'],['inventory-lab.html','库存仿真'],['flow-lab.html','生产线仿真'],['official-examples.html','官方示例']];
const guides=[['doc.html?f=学生指南.md','学生指南'],['doc.html?f=教师指南.md','教师指南'],['doc.html?f=出题指南.md','出题指南']];
export async function renderPage(name, source) {
    if (!source.includes('<!-- PLATFORM_HEADER -->')) return source;
    const template=await readFile(new URL('./header.html',import.meta.url),'utf8');
    const services=source.match(/<template data-header-services>([\s\S]*?)<\/template>/)?.[1] || '';
    const isIndex=name==='index.html', learning=labs.some(([url])=>url===name);
    const values={brand_url:learning?'index.html#learn':isIndex?'#course':'index.html#course',course_url:isIndex?'#course':'index.html#course',learn_url:isIndex?'#learn':'index.html#learn',
        course_active:learning?'':'class="active" aria-current="page"',learn_active:learning?'class="active" aria-current="page"':'',services};
    let header=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]);
    const links=learning?labs:name==='doc.html'?guides:name==='teacher.html'?[['teacher.html','教师管理'],...guides.slice(1)]:[];
    if (links.length) header+='<nav class="section-navigation" aria-label="当前空间导航">'+links.map(([url,label])=>
        `<a href="${url}"${url===name?' class="active" aria-current="page"':''}>${label}</a>`).join('')+'</nav>';
    return source.replace(/<template data-header-services>[\s\S]*?<\/template>/,'').replace('<!-- PLATFORM_HEADER -->',header);
}
