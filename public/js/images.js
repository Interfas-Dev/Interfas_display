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
  var soundBtn = document.getElementById('image-sound');
  var IMAGE_MAX = 5 * 1024 * 1024;
  var VIDEO_MAX = 200 * 1024 * 1024;
  var IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var VIDEO_TYPES = ['video/mp4', 'video/webm'];
  var MAX_IMAGES = 8;
  function isVideo(file) { return /\.(mp4|webm)$/.test(file); }

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
      var pic;
      if (isVideo(img.file)) {
        pic = document.createElement('video');
        pic.muted = true; pic.loop = true; pic.autoplay = true; pic.playsInline = true;
      } else {
        pic = document.createElement('img');
        pic.alt = '';
        pic.draggable = false;
      }
      pic.src = '/media/' + img.file;
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
      soundBtn.hidden = !isVideo(images[selected].file);
      soundBtn.textContent = images[selected].sound ? '🔊 Son activé' : '🔇 Sans le son';
      soundBtn.setAttribute('aria-pressed', images[selected].sound ? 'true' : 'false');
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

  soundBtn.addEventListener('click', function () {
    if (selected < 0) return;
    images[selected].sound = !images[selected].sound;
    save();
    select(selected);
  });

  layerBtn.addEventListener('click', function () {
    if (selected < 0) return;
    images[selected].layer = images[selected].layer === 'back' ? 'front' : 'back';
    save();
    select(selected);
  });

  // Envoi avec progression (une vidéo peut être longue à téléverser).
  function upload(file, done) {
    var video = VIDEO_TYPES.indexOf(file.type) >= 0;
    if (!video && IMAGE_TYPES.indexOf(file.type) < 0) return say('Format non accepté : PNG, JPG, WebP, MP4 ou WebM uniquement.', true);
    if (file.size > (video ? VIDEO_MAX : IMAGE_MAX)) return say(video ? 'Vidéo trop lourde : 200 Mo maximum.' : 'Image trop lourde : 5 Mo maximum.', true);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/media');
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) say('Envoi en cours… ' + Math.round((e.loaded / e.total) * 100) + ' %');
    };
    xhr.onload = function () {
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* réponse non JSON */ }
      if (xhr.status !== 201) {
        return say(data.error || (xhr.status === 413 ? 'Fichier trop lourd.' : 'Envoi impossible (erreur ' + xhr.status + ').'), true);
      }
      say();
      done(data);
    };
    xhr.onerror = function () { say('Envoi interrompu : vérifie la connexion et réessaie.', true); };
    say('Envoi en cours…');
    xhr.send(file);
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (images.length >= MAX_IMAGES) return say(MAX_IMAGES + ' images ou vidéos au maximum par message.', true);
    upload(file, function (data) {
      images.push({ file: data.file, x: 35, y: 30, w: 30, layer: 'front' });
      save();
      select(images.length - 1);
    });
  });

  // --- Vidéo plein écran ---
  var fullInput = document.getElementById('video_file');
  var fullFile = document.getElementById('video-full-file');
  var fullName = document.getElementById('video-full-name');
  var fullRemove = document.getElementById('video-full-remove');
  var fullSound = document.getElementById('video_sound');
  var fullBox = frame.querySelector('.slide-fullvideo');

  function renderFull() {
    var file = fullInput.value;
    fullBox.hidden = !file;
    fullBox.innerHTML = '';
    if (file) {
      var v = document.createElement('video');
      v.src = '/media/' + file;
      v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      fullBox.appendChild(v);
    }
    fullName.textContent = file ? 'Vidéo plein écran choisie.' : 'Aucune vidéo plein écran.';
    fullRemove.hidden = !file;
    fullSound.disabled = !file;
  }

  fullFile.addEventListener('change', function () {
    var file = fullFile.files && fullFile.files[0];
    fullFile.value = '';
    if (!file) return;
    if (VIDEO_TYPES.indexOf(file.type) < 0) return say('Pour le plein écran, choisis une vidéo MP4 ou WebM.', true);
    upload(file, function (data) {
      fullInput.value = data.file;
      renderFull();
    });
  });
  fullRemove.addEventListener('click', function () {
    fullInput.value = '';
    fullSound.checked = false;
    renderFull();
  });

  renderFull();
  render();
})();
