// Écran de l'atelier : rotation des messages (chacun pendant sa durée) et mise à
// jour en temps réel via Server-Sent Events. Quand le serveur signale un
// changement, on recharge seulement le contenu, sans écran noir.
(function () {
  var stage = document.getElementById('stage');
  var banner = document.getElementById('connection');
  var timer = null;
  var index = 0;
  var FULL_RELOAD_MS = 6 * 60 * 60 * 1000; // rechargement complet de sécurité toutes les 6 h

  function slides() { return stage.querySelectorAll('.slide'); }
  function durationOf(slide) {
    var s = Number(slide.getAttribute('data-duration'));
    return (s > 0 ? s : 10) * 1000;
  }

  var SAFETY_MS = 15 * 60 * 1000; // une vidéo plein écran bloquée ne fige pas l'écran

  function videos(slide) { return slide ? slide.querySelectorAll('video') : []; }

  // Lecture avec le son si demandé ; si le navigateur refuse la lecture
  // automatique avec son, on rejoue sans le son plutôt que de rester figé.
  function play(video) {
    video.muted = !video.hasAttribute('data-sound');
    var p = video.play();
    if (p && p.catch) {
      p.catch(function () {
        video.muted = true;
        video.play().catch(function () {});
      });
    }
  }

  function stopVideos(slide) {
    Array.prototype.forEach.call(videos(slide), function (v) { v.pause(); });
  }

  function startSlide(slide) {
    Array.prototype.forEach.call(videos(slide), function (v) {
      try { v.currentTime = 0; } catch (e) { /* métadonnées pas encore chargées */ }
      play(v);
    });
  }

  function schedule() {
    clearTimeout(timer);
    var list = slides();
    var slide = list[index];
    if (!slide) return;
    var full = slide.hasAttribute('data-video') ? slide.querySelector('.slide-fullvideo video') : null;
    if (full) {
      // Message vidéo plein écran : il dure le temps de la vidéo.
      full.loop = list.length === 1;
      if (list.length > 1) {
        full.onended = function () { next(); };
        full.onerror = function () { clearTimeout(timer); timer = setTimeout(next, 5000); };
        timer = setTimeout(next, SAFETY_MS);
      }
      return;
    }
    if (list.length > 1) timer = setTimeout(next, durationOf(slide));
  }

  function next() {
    var list = slides();
    var prev = list[index];
    var full = prev && prev.querySelector('.slide-fullvideo video');
    if (full) { full.onended = null; full.onerror = null; }
    prev.classList.remove('active');
    stopVideos(prev);
    index = (index + 1) % list.length;
    list[index].classList.add('active');
    startSlide(list[index]);
    schedule();
  }

  function refresh() {
    fetch('/display/slides', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        // Rester si possible sur le message en cours.
        var current = slides()[index];
        var currentId = current && current.getAttribute('data-id');
        stage.innerHTML = html;
        var list = slides();
        index = 0;
        for (var i = 0; i < list.length; i++) {
          if (currentId && list[i].getAttribute('data-id') === currentId) index = i;
          list[i].classList.toggle('active', i === index);
        }
        startSlide(list[index]);
        schedule();
      })
      .catch(function () { setTimeout(refresh, 5000); });
  }

  function connect() {
    if (!window.EventSource) {
      setInterval(refresh, 60000);
      return;
    }
    var source = new EventSource('/display/events');
    var wasDown = false;
    source.addEventListener('change', refresh);
    source.onopen = function () {
      banner.hidden = true;
      // Après une coupure, on a pu manquer des changements.
      if (wasDown) refresh();
      wasDown = false;
    };
    source.onerror = function () {
      wasDown = true;
      banner.hidden = false;
    };
  }

  startSlide(slides()[index]);
  schedule();
  connect();
  setTimeout(function () { location.reload(); }, FULL_RELOAD_MS);
})();
