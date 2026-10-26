/* Formal grading API: no DOM or global authentication state. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ScipOJGradingAPI=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function create({context,keys,fetch,crypto}) {
  async function submitAssignment(assignmentId,codeText,clientIntegrity=null) {
    const {session,cfg,user}=await context();
    const requestScope = `${user.id}:submit:${assignmentId}`;
    const requestKey = await keys.get(requestScope,{assignment_id:assignmentId,code_text:codeText});
    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/submit-assignment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ assignment_id: assignmentId, code_text: codeText, client_integrity: clientIntegrity, request_key:requestKey }),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status} ${resp.statusText}` }));
    if (!resp.ok) {
      const code = json.code || "";
      if (resp.status === 401 || code === "UNAUTHORIZED") {
        throw new Error("登录已过期，请重新登录后再提交作业");
      }
      if (code === "NOT_ENROLLED" || (resp.status === 403 && json.error?.includes("未选修"))) {
        throw new Error("您未选修本门课程，请先输入课程邀请码选课！");
      }
      if (code === "STUDENT_NO_REQUIRED") {
        throw new Error("请先在个人资料中绑定真实学号与姓名再提交作业");
      }
      if (code === "IDENTITY_VERIFICATION_REQUIRED")
        throw new Error("考试提交要求教师核验学号与 GitHub 账号，请联系本课程教师在花名册确认");
      if (code === "VERIFICATION_SERVICE_UNAVAILABLE")
        throw new Error("考试身份核验服务暂不可用，本次代码尚未提交，请联系教师");
      if (code === "CODE_TOO_LARGE") {
        throw new Error("提交代码过长，请精简后重试（上限 200 KB UTF-8）");
      }
      if (resp.status === 429 || code.startsWith("SUBMISSION_RATE_LIMIT_")) {
        throw new Error(json.error || "正式提交过于频繁，请稍后再试；练习运行不受影响");
      }
      throw new Error(json.error || `提交作业失败 (HTTP ${resp.status})`);
    }
    if (!json.ok || !json.submission_id) throw new Error("提交响应未确认，请重试查询");
    keys.acknowledge(requestScope,requestKey);
    return json;
  }
  async function requestRegrade(submissionId, reason) {
    const {session,cfg,user}=await context();
    const requestScope = `${user.id}:regrade:${submissionId}`;
    const payload = { submission_id:submissionId,reason:reason||"教师手动复判" };
    const requestKey = await keys.get(requestScope,payload);
    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({...payload,request_key:requestKey}),
    });

    const json = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    if (!resp.ok) {
      throw new Error(json.error || "复判请求失败");
    }
    if (!json.ok || !json.grading_id) throw new Error("复判响应未确认，请重试查询");
    keys.acknowledge(requestScope,requestKey);
    return json;
  }

  const REGRADE_BATCH_LIMIT = 50;

  async function postRegradeBatch(payload, session, cfg, requestKey) {
    const resp = await fetch(`${cfg.SUPABASE_URL}/functions/v1/regrade-batch`, {
      method: "POST", headers: {"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({...payload,request_key:requestKey}),
    });
    const json=await resp.json().catch(()=>null);
    return {resp,json};
  }

  async function requestBatchRegrade(submissionIds, reason, onProgress) {
    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      throw new Error("未选择任何待复判记录");
    }

    const {session,cfg,user}=await context();
    const ids = Array.from(new Set(submissionIds.filter(Boolean))).sort();
    const chunks = [];
    for (let i = 0; i < ids.length; i += REGRADE_BATCH_LIMIT) {
      chunks.push(ids.slice(i, i + REGRADE_BATCH_LIMIT));
    }

    const scope=`${user.id}:regrade-batch`;
    const operationKey=await keys.get(scope,{ids,reason});
    let totalSuccess=0;
    const allResults=[];
    for(let c=0;c<chunks.length;c++) {
      const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${operationKey}:${c}`)));
      const h=Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32);
      const key=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
      const {resp,json}=await postRegradeBatch({submission_ids:chunks[c],reason},session,cfg,key);
      if(!resp.ok||!json?.ok) throw new Error(json?.error||"批量复判响应未确认，请重试；已保存任务不会重复创建");
      totalSuccess+=Number(json.success_count||0);
      allResults.push(...(json.results||[]));
      if(typeof onProgress==="function") onProgress(Math.min((c+1)*REGRADE_BATCH_LIMIT,ids.length),ids.length);
    }
    if(totalSuccess===ids.length) keys.acknowledge(scope,operationKey);
    return {ok:true,total:ids.length,success_count:totalSuccess,results:allResults};
  }


    return {submitAssignment,requestRegrade,requestBatchRegrade};
  }
  return {create};
});
