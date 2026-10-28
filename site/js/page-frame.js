/* Shared surrounding navigation; page tools keep their own content. */
(() => {
 const learning = document.querySelector('#nav-learning-space')?.classList.contains('active');
 const space = new URLSearchParams(location.search).get('space') === 'learn' || learning ? 'learn' : 'course';
 for (const item of document.querySelectorAll('[data-space-nav],[data-space-content]')) {
  item.hidden = (item.dataset.spaceNav || item.dataset.spaceContent) !== space;
 }
 document.getElementById('btn-course-menu')?.addEventListener('click', event => {
  const button=event.currentTarget, expanded=button.getAttribute('aria-expanded')!=='true';
  button.setAttribute('aria-expanded',String(expanded));
  document.querySelector('.studio-rail')?.classList.toggle('rail-menu-open',expanded);
 });
})();
