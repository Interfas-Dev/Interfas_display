// Rotation des messages, chacun pendant sa propre durée (data-duration, en
// secondes). La page se recharge régulièrement pour suivre la planification ;
// la mise à jour en temps réel arrivera à l'étape 6.
(function () {
  var RELOAD_MS = 60000;
  var slides = document.querySelectorAll('.slide');
  var index = 0;

  function durationOf(slide) {
    var s = Number(slide.getAttribute('data-duration'));
    return (s > 0 ? s : 10) * 1000;
  }

  function next() {
    slides[index].classList.remove('active');
    index = (index + 1) % slides.length;
    slides[index].classList.add('active');
    setTimeout(next, durationOf(slides[index]));
  }

  if (slides.length > 1) setTimeout(next, durationOf(slides[0]));
  setTimeout(function () { location.reload(); }, RELOAD_MS);
})();
