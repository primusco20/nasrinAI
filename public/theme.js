// Applies the saved appearance (Light or Dark) before the page is drawn, so
// there is no flash of the wrong colours. System needs nothing: CSS follows the phone.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('nasrin.theme'));
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    if (JSON.parse(localStorage.getItem('nasrin.motion')) === 'reduce') document.documentElement.setAttribute('data-motion', 'reduce');
  } catch (e) { /* private mode: follow the phone */ }
})();
