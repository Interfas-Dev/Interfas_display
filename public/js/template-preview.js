// Aperçu en direct du formulaire de template.
(function () {
  var form = document.getElementById('template-form');
  var preview = document.getElementById('template-preview');
  if (!form || !preview) return;
  var frame = preview.querySelector('[data-slide]');

  function update() {
    var theme = (form.querySelector('input[name=theme]:checked') || {}).value || 'light';
    var cadre = (form.querySelector('input[name=frame]:checked') || {}).value || 'none';
    frame.className = 'slide-frame theme-' + theme + ' frame-' + cadre;
    frame.querySelector('.slide-logo').hidden = !form.querySelector('input[name=show_logo]').checked;
    var name = form.querySelector('#default_signature_name').value.trim();
    var role = form.querySelector('#default_signature_role').value.trim();
    frame.querySelector('.sig-name').textContent = name || preview.getAttribute('data-sample-name');
    frame.querySelector('.sig-role').textContent = role || preview.getAttribute('data-sample-role');
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
})();
