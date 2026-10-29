/* Shared surrounding navigation; page tools keep their own content. */
(() => {
 const context = window.ScipOJNavigation.resolveContext(location.href);
 window.ScipOJNavigation.applyContext(context);
 const journey=window.ScipOJJourney;
 const from=journey.safeURL(new URL(location.href).searchParams.get('from'));
 if(from&&from.href!==location.href){
  const link=document.createElement('a');link.className='btn-back journey-return';
  link.href=from.href;link.textContent='← 返回之前的页面';
  link.onclick=event=>{event.preventDefault();journey.back(from.href);};
  (document.querySelector('main')||document.body).prepend(link);
 }
})();
