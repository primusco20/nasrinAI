// Shows one legal document (Markdown in /legal/) with the same safe renderer
// as chat replies. ?doc=terms | privacy
(() => {
  'use strict';
  const allowed = { terms: '/legal/terms.md', privacy: '/legal/privacy.md' };
  const doc = new URLSearchParams(location.search).get('doc');
  const target = document.getElementById('doc');
  const path = allowed[doc] || allowed.terms;
  for (const a of document.querySelectorAll('.legal-nav a')) {
    if (a.getAttribute('href').endsWith('doc=' + (allowed[doc] ? doc : 'terms'))) a.setAttribute('aria-current', 'page');
  }
  // Back goes to the page that opened this one (Settings, the Terms sheet);
  // opened directly, it goes to the chat.
  document.getElementById('legalBack').addEventListener('click', (e) => {
    let fromHere = false;
    try { fromHere = new URL(document.referrer).origin === location.origin; } catch { /* no referrer */ }
    if (fromHere && history.length > 1) { e.preventDefault(); history.back(); }
  });
  fetch(path).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then((text) => {
    const { node } = window.NasrinFormat.render(text);
    target.replaceChildren(node);
    const h = target.querySelector('h3');
    if (h) document.title = 'NasrinAI · ' + h.textContent;
  }).catch(() => { target.textContent = 'This document could not be loaded. Please try again.'; });
})();
