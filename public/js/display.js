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

  function schedule() {
    clearTimeout(timer);
    var list = slides();
    if (list.length > 1) timer = setTimeout(next, durationOf(list[index]));
  }

  function next() {
    var list = slides();
    list[index].classList.remove('active');
    index = (index + 1) % list.length;
    list[index].classList.add('active');
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

  schedule();
  connect();
  setTimeout(function () { location.reload(); }, FULL_RELOAD_MS);
})();
