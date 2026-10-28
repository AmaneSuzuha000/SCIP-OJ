/* Shared surrounding navigation; page tools keep their own content. */
(() => {
 const context = window.ScipOJNavigation.resolveContext(location.href);
 window.ScipOJNavigation.applyContext(context);
 document.getElementById('btn-course-menu')?.addEventListener('click', event => {
  const button=event.currentTarget, expanded=button.getAttribute('aria-expanded')!=='true';
  button.setAttribute('aria-expanded',String(expanded));
  document.querySelector('.studio-rail')?.classList.toggle('rail-menu-open',expanded);
 });
})();
