'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Confirmación antes de acciones destructivas
  document.querySelectorAll('form[data-confirm]').forEach((f) => {
    f.addEventListener('submit', (e) => {
      if (!window.confirm(f.dataset.confirm)) e.preventDefault();
    });
  });

  // Pasar lista: marcar a todos con un estado
  document.querySelectorAll('[data-marcar-todos]').forEach((b) => {
    b.addEventListener('click', () => {
      const estado = b.dataset.marcarTodos;
      document.querySelectorAll(`input[type=radio][value="${estado}"]`).forEach((r) => {
        r.checked = true;
      });
    });
  });

  // Envío automático de filtros
  document.querySelectorAll('select[data-autosubmit]').forEach((s) => {
    s.addEventListener('change', () => s.form.submit());
  });

  // Imprimir
  document.querySelectorAll('[data-imprimir]').forEach((b) => b.addEventListener('click', () => window.print()));
});
