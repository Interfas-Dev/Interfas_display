// Met à jour l'aperçu (titre, signature, template) pendant la saisie.
// Le corps du message est synchronisé par l'éditeur (public/build/editor.js).
(function () {
  var select = document.getElementById('template_id');
  var preview = document.getElementById('preview');
  if (!select || !preview) return;
  var templates = JSON.parse(select.getAttribute('data-templates') || '[]');
  var frame = preview.querySelector('[data-slide]');
  var heading = document.getElementById('heading');
  var sigName = document.getElementById('signature_name');
  var sigRole = document.getElementById('signature_role');
  var surface = document.getElementById('editor');

  function current() {
    var id = Number(select.value);
    return templates.filter(function (t) { return t.id === id; })[0] || templates[0] || {};
  }

  function update() {
    var t = current();
    var look = t.look || { css: '', logoSrc: '/public/img/logo-interfas.png' };
    frame.className = 'slide-frame theme-' + t.theme + ' frame-' + t.frame + (look.logoRight ? ' logo-right' : '') + (look.customLogo ? ' logo-custom' : '');
    frame.style.cssText = look.css;
    frame.querySelector('.slide-logo').src = look.logoSrc;
    if (surface) {
      surface.className = 'editor-surface theme-' + t.theme;
      surface.style.cssText = look.css;
    }

    var h = heading.value.trim();
    var logo = frame.querySelector('.slide-logo');
    var title = frame.querySelector('.slide-heading');
    title.textContent = h;
    title.hidden = !h;
    logo.hidden = !t.show_logo;
    frame.querySelector('.slide-head').hidden = !h && !t.show_logo;

    var own = sigName.value.trim() || sigRole.value.trim();
    var name = own ? sigName.value.trim() : t.sig_name || '';
    var role = own ? sigRole.value.trim() : t.sig_role || '';
    frame.querySelector('.sig-name').textContent = name;
    frame.querySelector('.sig-role').textContent = role;
    frame.querySelector('.slide-signature').hidden = !name && !role;
    sigName.placeholder = t.sig_name || '';
    sigRole.placeholder = t.sig_role || '';
  }

  [select, heading, sigName, sigRole].forEach(function (el) {
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
  update();
})();
