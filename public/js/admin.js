// Demande une confirmation avant d'envoyer les formulaires marqués data-confirm.
document.addEventListener('submit', function (e) {
  var form = e.target;
  var msg = form.getAttribute && form.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
