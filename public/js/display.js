// Rotation simple des messages. La durée par message et la mise à jour en
// temps réel arriveront aux étapes 5 et 6.
(function () {
  var DEFAULT_DURATION_MS = 10000;
  var RELOAD_MS = 60000;
  var slides = document.querySelectorAll('.slide');
  var index = 0;
  if (slides.length > 1) {
    setInterval(function () {
      slides[index].classList.remove('active');
      index = (index + 1) % slides.length;
      slides[index].classList.add('active');
    }, DEFAULT_DURATION_MS);
  }
  // En attendant le temps réel : recharge la page régulièrement.
  setTimeout(function () { location.reload(); }, RELOAD_MS);
})();
