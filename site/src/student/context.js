import {state} from './state.js';

const journey=()=>window.ScipOJJourney;
export function taskKey(kind, id=state.activeProblemId) {
    const user=window.ScipOJPlatform?.getUser()?.id||window.ScipOJAccess?.getUser?.()?.id||'visitor';
    const assignment=state.courseAssignments?.find(a=>a.problem_id===id)?.id;
    return ['scipoj',kind,'v2',user,state.courseId||'practice',assignment||'practice',id].map(encodeURIComponent).join(':');
}
export function listKey() {return 'list:'+(state.courseId||state.courseMode||'practice');}
export function saveList() {
    const savedKey=state.listContextKey||listKey();
    journey().remember(savedKey,{query:document.getElementById('problem-search-input').value,
        difficulty:document.getElementById('filter-difficulty').value,progress:document.getElementById('filter-progress').value,
        mode:state.listViewMode,scroll:document.body.dataset.teachingView==='problems'?scrollY:(journey().recall(savedKey)?.scroll||0)});
}
export function restoreList() {
    state.listContextKey=listKey();
    const saved=journey().recall(listKey());
    for(const [id,key] of [['problem-search-input','query'],['filter-difficulty','difficulty'],['filter-progress','progress']]) {
        document.getElementById(id).value=saved?.[key]||(key==='query'?'':'all');
    }
    if(saved?.mode)state.listViewMode=saved.mode;
    for(const [id,mode] of [['view-list','table'],['view-grid','grid']]) {
        const button=document.getElementById(id);button?.classList.toggle('active',state.listViewMode===mode);button?.setAttribute('aria-pressed',String(state.listViewMode===mode));
    }
}
export function contextHash(hash) {
    if(window.ScipOJNavigation.parseRoute(hash).space==='learn')return hash;
    return window.ScipOJNavigation.withParams(hash,{course:state.courseId,mode:state.courseMode==='practice'?'practice':null});
}
export async function prepareContext(route, sequence) {
    if(route.space==='learn')return true;
    const platform=window.ScipOJPlatform;
    if(!state.platformReady&&platform?.isConfigured()) {
        state.courseMode='loading';state.courseId=null;state.courseAssignments=[];
        document.getElementById('student-course-status').textContent='正在恢复课程信息…';
        return true;
    }
    const enrollments=platform?.getEnrollments()||[];
    const courses=enrollments.filter(e=>e.courses?.id).map(e=>e.courses);
    const saved=journey().recall('course',{});
    const explicitPractice=route.params.get('mode')==='practice';
    let id=route.courseId || (!explicitPractice&&!saved.mode?saved.course:null);
    if(!id&&!explicitPractice&&!saved.mode&&courses.length===1)id=courses[0].id;
    state.contextError=route.error||null;
    if(id&&!courses.some(c=>c.id===id))state.contextError='该班级不存在或您尚未加入，请重新选择班级。';
    state.courseId=state.contextError?null:id||null;
    state.courseMode=state.courseId?'course':(explicitPractice||saved.mode==='practice'||courses.length===0?'practice':'choose');
    state.courseAssignments=[];
    if(state.courseId){
        const cacheKey=platform?.getUser()?.id+':'+state.courseId;
        try {
            if(state.assignmentCache?.key!==cacheKey||Date.now()-state.assignmentCache.at>30000) {
                const data=await platform.getCourseAssignments(state.courseId);
                if(sequence!==state.routeSeq)return false;
                state.assignmentCache={key:cacheKey,data,at:Date.now()};
            }
            state.courseAssignments=state.assignmentCache.data;
        }catch {
            if(sequence!==state.routeSeq)return false;
            state.contextError='课程作业暂时加载失败，请重试。';
        }
    }
    if(sequence!==state.routeSeq)return false;
    if(route.assignmentId&&!state.courseAssignments.some(a=>a.id===route.assignmentId&&a.problem_id===route.problemId))state.contextError='该作业不属于当前班级或题目，请从课程作业重新进入。';
    if(state.courseId&&route.problemId&&!state.courseAssignments.some(a=>a.problem_id===route.problemId))state.contextError='该班级尚未发布这道作业，请返回课程作业或选择自主练习。';
    if(!state.contextError&&route.space==='course') {
        journey().courseContext({course:state.courseId,mode:state.courseMode==='practice'?'practice':null});
        const assignment=state.courseAssignments.find(a=>a.problem_id===route.problemId);
        const hash=window.ScipOJNavigation.withParams(location.hash,{course:state.courseId,mode:state.courseMode==='practice'?'practice':null,assignment:assignment?.id});
        journey().amend(hash);
    }
    renderContext(courses);
    return true;
}
function renderContext(courses) {
    const select=document.getElementById('student-course-select');
    select.replaceChildren();
    if(courses.length>1){const option=new Option('请选择教学班级','');select.add(option);}
    select.add(new Option('自主练习 · 不计正式成绩','practice'));
    for(const course of courses)select.add(new Option(`${course.name} · ${course.code||''}`,course.id));
    select.value=state.courseId||(state.courseMode==='practice'?'practice':'');
    const label=document.getElementById('student-course-status');
    label.textContent=state.contextError|| (state.courseMode==='choose'?'选择班级后查看对应作业。':state.courseId?'作业规则与提交记录均属于所选班级。':'使用练习题库；正式提交需先选择教学班级。');
    const error=document.getElementById('journey-error');
    error.hidden=!state.contextError;
    error.querySelector('[data-error-message]').textContent=state.contextError||'';
}
export function installContextControls() {
    document.getElementById('student-course-select').onchange=event=>{
        saveList();
        const value=event.target.value;
        window.ScipOJJourney.go(window.ScipOJNavigation.withParams(state.currentRoute?.problemId?'#'+state.currentRoute.problemId:'#problem-list-section',{course:value&&value!=='practice'?value:null,mode:value==='practice'?'practice':null})).then(ok=>{
            if(!ok)event.target.value=state.courseId|| (state.courseMode==='practice'?'practice':'');
        });
    };
    document.getElementById('journey-retry').onclick=()=>{state.assignmentCache=null;window.ScipOJJourney.go(location.href,{force:true});};
    window.ScipOJTask={draftKey:()=>taskKey('draft')};
}
