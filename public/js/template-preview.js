// Formulaire de template : aperçu en direct des réglages de style, envois
// (logo, image de fond, police) et avertissement de lisibilité.
// Le calcul des variables reprend styleVars() de src/content/style.ts.
(function () {
  var form = document.getElementById('template-form');
  var preview = document.getElementById('template-preview');
  if (!form || !preview) return;
  var frame = preview.querySelector('[data-slide]');
  var presets = JSON.parse(form.getAttribute('data-presets') || '{}');
  var fonts = JSON.parse(form.getAttribute('data-fonts') || '[]');
  var INTERFAS_LOGO = '/public/img/logo-interfas.png';

  function field(name) { return form.querySelector('[name="s_' + name + '"]'); }
  function val(name) { var el = field(name); return el ? el.value : ''; }

  function fontCss(key) {
    for (var i = 0; i < fonts.length; i++) if (fonts[i].key === key) return fonts[i].css;
    return fonts.length ? fonts[0].css : 'sans-serif';
  }

  function style() {
    var bg2 = field('bg2');
    return {
      bg: val('bg'), bg2: bg2 && !bg2.disabled ? bg2.value : '', bgImage: val('bgImage'),
      text: val('text'), heading: val('heading'), marker: val('marker'), muted: val('muted'),
      frameColor: val('frameColor'), frameWidth: Number(val('frameWidth')),
      fontHeading: val('fontHeading'), fontBody: val('fontBody'),
      headingSize: Number(val('headingSize')), headingWeight: val('headingWeight'),
      headingUpper: field('headingUpper').checked, headingAlign: val('headingAlign'),
      bodySize: Number(val('bodySize')), bodyAlign: val('bodyAlign'),
      sigSize: Number(val('sigSize')), sigAlign: val('sigAlign'),
      logo: val('logo'), logoSize: Number(val('logoSize')), logoPos: val('logoPos'),
      padX: Number(val('padX')), padY: Number(val('padY')),
    };
  }

  var JUSTIFY = { left: 'start', center: 'center', right: 'end' };
  var ITEMS = { left: 'flex-start', center: 'center', right: 'center' };

  function vars(s) {
    var bgImage = s.bgImage ? 'url(/media/' + s.bgImage + ')' : s.bg2 ? 'linear-gradient(135deg, ' + s.bg + ', ' + s.bg2 + ')' : 'none';
    return [
      '--slide-bg:' + s.bg, '--tpl-bg-image:' + bgImage,
      '--slide-text:' + s.text, '--slide-heading:' + s.heading, '--slide-marker:' + s.marker, '--slide-muted:' + s.muted,
      '--frame-c:' + s.frameColor, '--frame-w:' + s.frameWidth + 'em',
      '--tpl-font-heading:' + fontCss(s.fontHeading), '--tpl-font-body:' + fontCss(s.fontBody),
      '--tpl-heading-size:' + s.headingSize + 'em', '--tpl-heading-weight:' + s.headingWeight,
      '--tpl-heading-transform:' + (s.headingUpper ? 'uppercase' : 'none'), '--tpl-heading-align:' + s.headingAlign,
      '--tpl-heading-flex:' + (s.headingAlign === 'left' && s.logoPos === 'left' ? '0 1 auto' : '1'),
      '--tpl-body-size:' + s.bodySize + 'em', '--tpl-body-align:' + s.bodyAlign, '--tpl-list-display:' + (s.bodyAlign === 'left' ? 'block' : 'inline-block'),
      '--tpl-sig-size:' + s.sigSize + 'em', '--tpl-sig-justify:' + JUSTIFY[s.sigAlign], '--tpl-sig-items:' + ITEMS[s.sigAlign],
      '--tpl-logo-size:' + s.logoSize + 'em', '--tpl-pad-x:' + s.padX + 'em', '--tpl-pad-y:' + s.padY + 'em',
    ].join(';');
  }

  /* --- Lisibilité (contraste WCAG) --- */
  function lum(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255].map(function (c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }).reduce(function (acc, c, i) { return acc + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function fmt(r) { return r.toFixed(1).replace('.', ',') + ':1'; }

  function checkContrast(s) {
    var box = document.getElementById('contrast-warning');
    if (!box) return;
    var backs = s.bg2 ? [s.bg, s.bg2] : [s.bg];
    function worst(c) { return Math.min.apply(null, backs.map(function (b) { return ratio(c, b); })); }
    var issues = [];
    var t = worst(s.text), h = worst(s.heading);
    if (t < 4.5) issues.push('le texte (' + fmt(t) + ', 4,5:1 conseillé)');
    if (h < 3) issues.push('le titre (' + fmt(h) + ', 3:1 conseillé)');
    var msg = issues.length ? '⚠ Peu lisible de loin : ' + issues.join(' et ') + ' ressort mal sur le fond.' : '';
    if (s.bgImage) msg = (msg ? msg + ' ' : '') + 'Avec une image de fond, vérifie la lisibilité sur l\'aperçu.';
    box.textContent = msg;
    box.hidden = !msg;
  }

  /* --- Aperçu --- */
  function outputs() {
    Array.prototype.forEach.call(form.querySelectorAll('.range-field'), function (f) {
      var input = f.querySelector('input'), out = f.querySelector('output');
      var unit = out.getAttribute('data-unit');
      out.textContent = unit === '%' ? Math.round(Number(input.value) * 100) + ' %' : String(input.value).replace('.', ',') + ' em';
    });
  }

  function update() {
    var theme = (form.querySelector('input[name=theme]:checked') || {}).value || 'light';
    var s = style();
    frame.className = 'slide-frame theme-' + theme + ' frame-none' + (s.logoPos === 'right' ? ' logo-right' : '') + (s.logo !== 'interfas' ? ' logo-custom' : '');
    frame.style.cssText = vars(s);
    var logo = frame.querySelector('.slide-logo');
    logo.src = s.logo === 'interfas' ? INTERFAS_LOGO : '/media/' + s.logo;
    logo.hidden = !form.querySelector('input[name=show_logo]').checked;
    var name = form.querySelector('#default_signature_name').value.trim();
    var role = form.querySelector('#default_signature_role').value.trim();
    frame.querySelector('.sig-name').textContent = name || preview.getAttribute('data-sample-name');
    frame.querySelector('.sig-role').textContent = role || preview.getAttribute('data-sample-role');
    outputs();
    checkContrast(s);
  }

  // Changer de thème de départ remet ses couleurs.
  Array.prototype.forEach.call(form.querySelectorAll('input[name=theme]'), function (r) {
    r.addEventListener('change', function () {
      var c = presets.themes && presets.themes[r.value];
      if (!c) return;
      ['bg', 'text', 'heading', 'marker', 'muted'].forEach(function (k) { field(k).value = c[k].toLowerCase(); });
      setGradient(false);
      update();
    });
  });

  var gradient = document.getElementById('bg-gradient');
  function setGradient(on) {
    gradient.checked = on;
    var bg2 = field('bg2');
    bg2.disabled = !on;
    document.getElementById('bg2-field').hidden = !on;
  }
  gradient.addEventListener('change', function () { setGradient(gradient.checked); update(); });

  /* --- Envoi d'un logo ou d'une image de fond --- */
  var picker = document.getElementById('style-upload');
  var target = null;
  function status(name, text) { var el = form.querySelector('[data-upload-status="' + name + '"]'); if (el) el.textContent = text; }
  function clearBtn(name) { return form.querySelector('[data-clear="' + name + '"]'); }

  Array.prototype.forEach.call(form.querySelectorAll('[data-upload]'), function (btn) {
    btn.addEventListener('click', function () { target = btn.getAttribute('data-upload'); picker.value = ''; picker.click(); });
  });
  Array.prototype.forEach.call(form.querySelectorAll('[data-clear]'), function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-clear');
      field(name).value = name === 'logo' ? 'interfas' : '';
      btn.hidden = true;
      status(name, name === 'logo' ? 'Logo Interfas.' : '');
      update();
    });
  });
  picker.addEventListener('change', function () {
    var file = picker.files && picker.files[0];
    var name = target;
    if (!file || !name) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { status(name, 'Format non accepté : PNG, JPG, WebP ou GIF.'); return; }
    if (file.size > 5 * 1024 * 1024 && file.type !== 'image/gif') { status(name, 'Image trop lourde : 5 Mo maximum.'); return; }
    status(name, 'Envoi en cours…');
    fetch('/admin/media', { method: 'POST', headers: { 'content-type': file.type }, body: file, credentials: 'same-origin' })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || 'Envoi impossible.');
        field(name).value = r.data.file;
        clearBtn(name).hidden = false;
        status(name, name === 'logo' ? 'Logo envoyé.' : 'Image de fond utilisée.');
        update();
      })
      .catch(function (err) { status(name, err.message || 'Envoi impossible.'); });
  });

  /* --- Ajout d'une police --- */
  var fontSend = document.getElementById('font-send');
  if (fontSend) {
    fontSend.addEventListener('click', function () {
      var nameInput = document.getElementById('font-name');
      var fileInput = document.getElementById('font-file');
      var out = document.getElementById('font-status');
      var file = fileInput.files && fileInput.files[0];
      var fontName = nameInput.value.trim() || (file ? file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().slice(0, 40) : '');
      if (!file) { out.textContent = 'Choisis un fichier de police.'; return; }
      if (!fontName) { out.textContent = 'Donne un nom à la police.'; return; }
      if (file.size > 2 * 1024 * 1024) { out.textContent = 'Police trop lourde : 2 Mo maximum.'; return; }
      out.textContent = 'Envoi en cours…';
      fetch('/admin/templates/fonts?name=' + encodeURIComponent(fontName), {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, credentials: 'same-origin',
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.error || 'Envoi impossible.');
          var f = r.data;
          var css = "'" + f.family + "', system-ui, sans-serif";
          fonts.push({ key: f.key, label: f.label, css: css });
          var faces = document.getElementById('custom-fonts');
          if (faces) faces.textContent += "\n@font-face{font-family:'" + f.family + "';src:url(" + f.url + ');font-display:swap;}';
          ['fontHeading', 'fontBody'].forEach(function (k) {
            var opt = document.createElement('option');
            opt.value = f.key;
            opt.textContent = f.label;
            field(k).appendChild(opt);
          });
          field('fontHeading').value = f.key;
          nameInput.value = '';
          fileInput.value = '';
          out.textContent = 'Police « ' + fontName + ' » ajoutée et choisie pour le titre.';
          update();
        })
        .catch(function (err) { out.textContent = err.message || 'Envoi impossible.'; });
    });
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
})();
