// Images posées librement sur l'aperçu : ajout, déplacement, redimensionnement,
// plan (devant / derrière le texte). Positions en % de la diapo, enregistrées
// dans le champ caché « images » avec le reste du formulaire.
(function () {
  var input = document.getElementById('images');
  var preview = document.getElementById('preview');
  if (!input || !preview) return;
  var frame = preview.querySelector('[data-slide]');
  var fileInput = document.getElementById('image-file');
  var tools = document.getElementById('image-tools');
  var layerBtn = document.getElementById('image-layer');
  var removeBtn = document.getElementById('image-remove');
  var status = document.getElementById('image-status');
  var HINT = status.textContent;
  var MAX_BYTES = 5 * 1024 * 1024;
  var MAX_IMAGES = 8;

  var images = [];
  try { images = JSON.parse(input.value || '[]'); } catch (e) { images = []; }
  var selected = -1;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function round(v) { return Math.round(v * 100) / 100; }
  function save() { input.value = JSON.stringify(images); }
  function say(text, isError) {
    status.textContent = text || HINT;
    status.classList.toggle('field-error', !!isError);
  }

  function place(el, img) {
    el.style.left = img.x + '%';
    el.style.top = img.y + '%';
    el.style.width = img.w + '%';
  }

  function render() {
    Array.prototype.forEach.call(frame.querySelectorAll('.slide-image'), function (el) { el.remove(); });
    images.forEach(function (img, i) {
      var box = document.createElement('div');
      box.className = 'slide-image editable layer-' + (img.layer === 'back' ? 'back' : 'front') + (i === selected ? ' is-selected' : '');
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-label', 'Image ' + (i + 1) + ' : glisser pour déplacer, flèches pour ajuster');
      box.dataset.index = String(i);
      var pic = document.createElement('img');
      pic.src = '/media/' + img.file;
      pic.alt = '';
      pic.draggable = false;
      box.appendChild(pic);
      var handle = document.createElement('span');
      handle.className = 'image-handle';
      handle.title = 'Redimensionner';
      box.appendChild(handle);
      place(box, img);
      frame.appendChild(box);
    });
    tools.hidden = selected < 0;
    if (selected >= 0) {
      layerBtn.textContent = images[selected].layer === 'back' ? 'Passer devant le texte' : 'Passer derrière le texte';
    }
  }

  function select(i) {
    selected = i;
    render();
    if (i >= 0) {
      var el = frame.querySelector('.slide-image[data-index="' + i + '"]');
      if (el) el.focus({ preventScroll: true });
    }
  }

  // Glisser (déplacer) ou tirer le coin (redimensionner)
  frame.addEventListener('pointerdown', function (e) {
    var box = e.target.closest('.slide-image.editable');
    if (!box) {
      if (selected >= 0) select(-1);
      return;
    }
    e.preventDefault();
    var i = Number(box.dataset.index);
    if (i !== selected) select(i);
    box = frame.querySelector('.slide-image[data-index="' + i + '"]');
    var img = images[i];
    var rect = frame.getBoundingClientRect();
    var resizing = e.target.classList.contains('image-handle');
    var start = { x: e.clientX, y: e.clientY, ix: img.x, iy: img.y, iw: img.w };
    box.setPointerCapture(e.pointerId);
    box.classList.add('is-moving');

    function move(ev) {
      var dx = ((ev.clientX - start.x) / rect.width) * 100;
      var dy = ((ev.clientY - start.y) / rect.height) * 100;
      if (resizing) {
        img.w = round(clamp(start.iw + dx, 3, 100));
      } else {
        img.x = round(clamp(start.ix + dx, -img.w + 2, 98));
        img.y = round(clamp(start.iy + dy, -50, 98));
      }
      place(box, img);
    }
    function up() {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      box.classList.remove('is-moving');
      save();
    }
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  });

  // Clavier : flèches pour déplacer, Maj+flèches pour aller plus vite, +/- pour la taille, Suppr pour retirer
  frame.addEventListener('keydown', function (e) {
    var box = e.target.closest && e.target.closest('.slide-image.editable');
    if (!box) return;
    var img = images[Number(box.dataset.index)];
    var step = e.shiftKey ? 5 : 0.5;
    var handled = true;
    if (e.key === 'ArrowLeft') img.x = clamp(img.x - step, -img.w + 2, 98);
    else if (e.key === 'ArrowRight') img.x = clamp(img.x + step, -img.w + 2, 98);
    else if (e.key === 'ArrowUp') img.y = clamp(img.y - step, -50, 98);
    else if (e.key === 'ArrowDown') img.y = clamp(img.y + step, -50, 98);
    else if (e.key === '+' || e.key === '=') img.w = clamp(img.w + step * 2, 3, 100);
    else if (e.key === '-') img.w = clamp(img.w - step * 2, 3, 100);
    else if (e.key === 'Delete' || e.key === 'Backspace') { removeSelected(); return e.preventDefault(); }
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    img.x = round(img.x); img.y = round(img.y); img.w = round(img.w);
    place(box, img);
    save();
  });

  function removeSelected() {
    if (selected < 0) return;
    images.splice(selected, 1);
    selected = -1;
    save();
    render();
  }
  removeBtn.addEventListener('click', removeSelected);

  layerBtn.addEventListener('click', function () {
    if (selected < 0) return;
    images[selected].layer = images[selected].layer === 'back' ? 'front' : 'back';
    save();
    select(selected);
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (images.length >= MAX_IMAGES) return say(MAX_IMAGES + ' images au maximum par message.', true);
    if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) < 0) return say('Format non accepté : PNG, JPG ou WebP uniquement.', true);
    if (file.size > MAX_BYTES) return say('Image trop lourde : 5 Mo maximum.', true);
    say('Envoi de l’image…');
    fetch('/admin/media', { method: 'POST', headers: { 'content-type': file.type }, body: file, credentials: 'same-origin' })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || (res.status === 413 ? 'Image trop lourde : 5 Mo maximum.' : 'Envoi impossible (erreur ' + res.status + ').'));
          return data;
        });
      })
      .then(function (data) {
        images.push({ file: data.file, x: 35, y: 30, w: 30, layer: 'front' });
        save();
        say();
        select(images.length - 1);
      })
      .catch(function (err) { say(err.message, true); });
  });

  render();
})();
