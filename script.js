(() => {
  /* ---------- Mobile menu ---------- */
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');

  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  /* ---------- Highlight the section currently being read ---------- */
  const navAnchors = [...links.querySelectorAll('a')];
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navAnchors.forEach((a) =>
        a.classList.toggle('is-active', a.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  navAnchors.forEach((a) => {
    const section = document.querySelector(a.getAttribute('href'));
    if (section) sectionObserver.observe(section);
  });

  /* ---------- Reveal on scroll (also starts the Fig. 1 curve drawing) ---------- */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

  /* ---------- Keycaps press down when the matching real key is held ---------- */
  // Visual feedback only: E, L, R and Enter press their keycaps; nothing navigates.
  const keyName = (e) => (e.key === 'Enter' ? 'enter' : e.key.toLowerCase());
  const keysFor = (e) => (/^([a-z]|enter)$/.test(keyName(e))
    ? document.querySelectorAll(`[data-key="${keyName(e)}"]`)
    : []);
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    keysFor(e).forEach((k) => k.classList.add('is-press'));
  });
  document.addEventListener('keyup', (e) => keysFor(e).forEach((k) => k.classList.remove('is-press')));
  window.addEventListener('blur', () => document.querySelectorAll('.key.is-press').forEach((k) => k.classList.remove('is-press')));

  /* ---------- Footer year ---------- */
  document.getElementById('year').textContent = new Date().getFullYear();
})();
