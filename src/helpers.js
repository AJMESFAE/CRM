'use strict';

const ROLES = { direccion: 'Dirección', profesor: 'Profesor/a', tutor: 'Padre/Madre/Tutor legal' };
const ESTADOS_ASISTENCIA = { presente: 'Presente', ausente: 'Falta', retraso: 'Retraso', justificada: 'Falta justificada' };
const TIPOS_NOTA = { examen: 'Examen', trabajo: 'Trabajo', deberes: 'Deberes', actitud: 'Actitud', oral: 'Exposición oral', final: 'Nota final' };
const TIPOS_SEGUIMIENTO = {
  academico: 'Académico',
  conducta: 'Conducta',
  salud: 'Salud',
  tutoria: 'Tutoría con la familia',
  positivo: 'Reconocimiento positivo',
  otro: 'Otro',
};
const ETAPAS = ['Infantil', 'Primaria', 'ESO', 'Bachillerato', 'FP'];
const PARENTESCOS = ['Madre', 'Padre', 'Tutor/a legal', 'Abuelo/a', 'Otro'];

function hoy() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function esFecha(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function fecha(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fechaHora(s) {
  if (!s) return '';
  return `${fecha(s)} ${String(s).slice(11, 16)}`;
}

function edad(fechaNacimiento) {
  if (!fechaNacimiento) return '';
  const n = new Date(fechaNacimiento);
  const h = new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
  return e;
}

function formatoNota(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toFixed(2).replace('.', ',');
}

// Calificación cualitativa (sistema español)
function calificacion(n) {
  if (n === null || n === undefined) return '';
  if (n < 5) return 'Insuficiente';
  if (n < 6) return 'Suficiente';
  if (n < 7) return 'Bien';
  if (n < 9) return 'Notable';
  return 'Sobresaliente';
}

function claseNota(n) {
  if (n === null || n === undefined) return '';
  return n < 5 ? 'nota-mal' : n >= 9 ? 'nota-top' : 'nota-ok';
}

function porcentaje(v) {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 10) / 10}%`.replace('.', ',');
}

function texto(v, max = 2000) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function check(v) {
  return v === 'on' || v === '1' || v === 1 || v === true ? 1 : 0;
}

// Media ponderada de una lista de notas
function media(notas) {
  if (!notas.length) return null;
  const pesos = notas.reduce((s, n) => s + n.peso, 0);
  return notas.reduce((s, n) => s + n.nota * n.peso, 0) / pesos;
}

function cursoAcademicoActual() {
  const d = new Date();
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

function trimestreActual() {
  const m = new Date().getMonth();
  if (m >= 8 && m <= 11) return 1;
  if (m <= 2) return 2;
  return 3;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  ROLES,
  ESTADOS_ASISTENCIA,
  TIPOS_NOTA,
  TIPOS_SEGUIMIENTO,
  ETAPAS,
  PARENTESCOS,
  hoy,
  esFecha,
  fecha,
  fechaHora,
  edad,
  formatoNota,
  calificacion,
  claseNota,
  porcentaje,
  texto,
  check,
  media,
  cursoAcademicoActual,
  trimestreActual,
  HttpError,
};
