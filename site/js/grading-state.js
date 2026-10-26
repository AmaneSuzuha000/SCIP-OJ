/* Shared submission interpretation. No DOM, authentication or network access. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ScipOJGradingState=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function normalizeSubmission(submission){
    const raw=Array.isArray(submission.gradings)?submission.gradings:submission.gradings?[submission.gradings]:[];
    const attempts=[...raw].sort((a,b)=>{
      const time=(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0);
      return time||String(b.id||'').localeCompare(String(a.id||''));
    });
    const assignment=Array.isArray(submission.assignments)?submission.assignments[0]:submission.assignments;
    const successful=attempts.find(g=>g.status==='done'&&Number.isInteger(g.score)&&g.score>=0&&g.score<=100);
    // Course gradebook applies the current assignment threshold. The raw report
    // and its frozen execution threshold remain available in attempts.
    const threshold=assignment?.pass_score??successful?.config_snapshot?.pass_score;
    const effectiveGrade=successful?{...successful,
      passed:typeof threshold==='number'?successful.score>=threshold:successful.passed}:null;
    return {...submission,gradings:attempts,latestAttempt:attempts[0]||null,effectiveGrade};
  }
  return {normalizeSubmission};
});
