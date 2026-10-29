/* Teacher task location and form recovery share the site's navigation owner. */
export async function installTeacherJourney(context) {
    const journey=window.ScipOJJourney;
    journey.setUser(context.userId);
    const fields=['assign-problem-select','assign-custom-problem','assign-due-at','assign-pass-score','assign-instances','assign-policy','assign-integrity-policy'];
    const defaults=Object.fromEntries(fields.map(id=>[id,document.getElementById(id).value]));
    const status=document.createElement('p');status.className='journey-draft-status';status.setAttribute('role','status');
    context.formPublish.appendChild(status);
    let renderedCourse=null, dirty=false, saveFailed=false, applying=false;
    function values(){return Object.fromEntries(fields.map(id=>[id,document.getElementById(id).value]));}
    function save(){
        if(!context.currentCourseId)return;
        saveFailed=!journey.remember('teacher-form:'+context.currentCourseId,{values:values(),dirty});
        journey.remember('teacher-location',{course:context.currentCourseId,tab:document.querySelector('.teacher-tabs .active')?.dataset.tab,
            keyword:context.filterKeyword.value,problem:context.filterProblem.value});
        status.textContent=dirty?(saveFailed?'配置尚未发布，本地保存失败，请保留页面。':'配置尚未发布 · 草稿已保存在本浏览器，返回可继续编辑。'):'';
    }
    function restore(){
        const saved=journey.recall('teacher-form:'+context.currentCourseId);
        for(const id of fields)document.getElementById(id).value=saved?.values?.[id]??defaults[id];
        context.assignCustomProblem.hidden=context.assignProblemSelect.value!=='__custom__';
        dirty=!!saved?.dirty;save();
    }
    function destination(patch){
        const url=new URL(location.href);
        for(const [key,value] of Object.entries(patch))if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);
        return url.href;
    }
    context.markTeacherPublished=()=>{dirty=false;save();};
    context.navigateEvidence=row=>journey.go(destination({tab:'gradebook',evidence:row.assignment_id+'|'+row.user_id}));
    context.closeEvidence=()=>journey.back(destination({evidence:null}));
    context.paginationChanged=({page,size})=>journey.go(destination({page:String(page),size:String(size)}),{replace:true});
    context.formPublish.addEventListener('input',()=>{dirty=true;save();});
    context.formPublish.addEventListener('change',()=>{dirty=true;save();});
    context.courseSelect.onchange=()=>{
        const previous=context.currentCourseId;
        journey.go(destination({course:context.courseSelect.value,q:null,problem:null})).then(ok=>{if(!ok)context.courseSelect.value=previous||'';});
    };
    for(const button of context.tabBtns)button.onclick=()=>journey.go(destination({tab:button.dataset.tab}));
    const filter=()=>{
        if(applying)return;
        journey.go(destination({q:context.filterKeyword.value,problem:context.filterProblem.value,page:'1',evidence:null}),{replace:true});
    };
    context.filterKeyword.addEventListener('input',filter);context.filterProblem.addEventListener('change',filter);
    const initial=new URL(location.href), saved=journey.recall('teacher-location');
    const course=initial.searchParams.get('course')||saved?.course||(context.currentCoursesList.length===1?context.currentCoursesList[0].course_id:null);
    if(context.currentCoursesList.length>1)context.courseSelect.prepend(new Option('请选择教学班级',''));
    if(course)initial.searchParams.set('course',course);
    if(!initial.searchParams.has('tab'))initial.searchParams.set('tab',saved?.tab||'gradebook');
    journey.amend(initial.href);
    await journey.configure({
        sameDocument:(url,current)=>url.pathname===current.pathname,
        save,
        beforeLeave:()=>{
            if(context.publishing){ScipOJPlatform.showToast('作业配置正在保存，请等待处理完成。','info');return false;}
            save();
            if(saveFailed&&dirty)return ScipOJPlatform.showConfirmDialog({title:'配置尚未保存',message:'本地草稿保存失败，请先保留填写内容。',confirmText:'确定离开',danger:true});
            return true;
        },
        render:async(url,options)=>{
            const id=url.searchParams.get('course'), tab=url.searchParams.get('tab')||'gradebook';
            const valid=context.currentCoursesList.some(e=>e.course_id===id);
            const access=document.getElementById('teacher-access-status');
            access.hidden=valid;access.textContent=id?'该班级不存在或您没有管理权限，请选择自己的班级。':'请先选择教学班级。';
            if(!['gradebook','roster','assignments'].includes(tab)){
                access.hidden=false;access.textContent='该教师页面不存在，请从下方标签选择。';
            }
            for(const button of context.tabBtns){const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}
            for(const [name,panel] of Object.entries(context.tabContents))panel.hidden=!valid||name!==tab;
            context.currentCourseId=valid?id:null;context.courseSelect.value=valid?id:'';
            if(!valid){renderedCourse=null;context.currentRosterData=[];context.currentAssignmentsList=[];return;}
            journey.courseContext({course:id,mode:null});
            const changed=renderedCourse!==id;
            renderedCourse=id;
            if(changed){
                context.currentRosterData=[];context.currentAssignmentsList=[];
                context.courseAssignmentsArea.textContent='正在加载当前班级的作业…';
                context.filterKeyword.value='';context.filterProblem.value='';
                document.getElementById('submission-detail').hidden=true;
                restore();context.handlers.updateCourseInviteDisplay();
                await Promise.all([context.handlers.loadGradebook(id),context.handlers.loadPendingRoster(id)]);
                if(context.currentCourseId!==id)return;
            }
            applying=true;
            const remembered=options.initial?saved:journey.recall('teacher-location');
            context.filterKeyword.value=url.searchParams.get('q')??(options.initial&&remembered?.course===id?remembered.keyword:'')??'';
            const problem=url.searchParams.get('problem')??(options.initial&&remembered?.course===id?remembered.problem:'');
            context.filterProblem.value=[...context.filterProblem.options].some(o=>o.value===problem)?problem:'';
            context.handlers.restorePagination(url.searchParams.get('page')||1,url.searchParams.get('size')||50);context.handlers.renderGradebookTable();
            applying=false;save();
            const evidence=url.searchParams.get('evidence');
            context.evidenceRequest=(context.evidenceRequest||0)+1;
            if(evidence){
                const row=context.currentRosterData.find(row=>row.assignment_id+'|'+row.user_id===evidence);
                if(row)await context.handlers.showSubmissionEvidence(row);
                else{access.hidden=false;access.textContent='该证据记录不存在或不属于当前班级。';document.getElementById('submission-detail').hidden=true;}
            }else document.getElementById('submission-detail').hidden=true;
            if(tab==='roster'&&!changed)await context.handlers.loadPendingRoster(id);
            if(tab==='assignments'&&!changed)await context.handlers.loadCourseAssignments(id);
        }
    });
    window.addEventListener('beforeunload',event=>{save();if(dirty&&saveFailed&&!journey.isLeaving()){event.preventDefault();event.returnValue='';}},{signal:window.ScipOJPageSession?.signal});
}
