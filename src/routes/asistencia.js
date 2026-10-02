'use strict';

const express = require('express');
const { requireRol } = require('../auth');
const { puedePasarLista, claseIdsProfesor, registrar } = require('../access');
const { hoy, esFecha, texto, ESTADOS_ASISTENCIA, HttpError, fecha: fmtFecha } = require('../helpers');

const router = express.Router();
router.use(requireRol('direccion', 'profesor'));

function clasesDisponibles(db, user) {
  if (user.rol === 'direccion') return db.all('SELECT id, nombre FROM clases ORDER BY nombre');
  const ids = claseIdsProfesor(db, user.id);
  return db.all(`SELECT id, nombre FROM clases WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'}) ORDER BY nombre`, ...ids);
}

// Pasar lista
router.get('/', (req, res, next) => {
  const db = req.db;
  const clases = clasesDisponibles(db, req.user);
  const claseId = req.query.clase ? Number(req.query.clase) : clases.length === 1 ? clases[0].id : null;
  const fecha = esFecha(req.query.fecha) ? req.query.fecha : hoy();
  let alumnos = [];
  let clase = null;
  if (claseId) {
    if (!puedePasarLista(db, req.user, claseId)) return next(new HttpError(403, 'No puedes pasar lista en esta clase.'));
    clase = db.get('SELECT * FROM clases WHERE id = ?', claseId);
    if (!clase) return next(new HttpError(404, 'Clase no encontrada.'));
    alumnos = db.all(
      `SELECT a.id, a.nombre, a.apellidos, s.estado, s.observacion, s.motivo_familia
         FROM alumnos a LEFT JOIN asistencia s ON s.alumno_id = a.id AND s.fecha = ?
        WHERE a.clase_id = ? AND a.activo = 1 ORDER BY a.apellidos, a.nombre`,
      fecha,
      claseId,
    );
  }
  const yaRegistrada = alumnos.some((a) => a.estado);
  res.render('asistencia/pasar', { titulo: 'Pasar lista', clases, clase, alumnos, fecha, yaRegistrada, ESTADOS_ASISTENCIA });
});

router.post('/', (req, res, next) => {
  const db = req.db;
  const claseId = Number(req.body.clase_id);
  const fecha = req.body.fecha;
  if (!esFecha(fecha)) return next(new HttpError(400, 'Fecha no válida.'));
  if (fecha > hoy()) {
    req.flash('error', 'No se puede registrar la asistencia de un día futuro.');
    return res.redirect(`/asistencia?clase=${claseId}`);
  }
  if (!puedePasarLista(db, req.user, claseId)) return next(new HttpError(403, 'No puedes pasar lista en esta clase.'));

  const alumnos = db.all('SELECT id, nombre, apellidos FROM alumnos WHERE clase_id = ? AND activo = 1', claseId);
  const notificar = req.body.notificar === 'on';
  let faltas = 0;
  db.tx(() => {
    for (const a of alumnos) {
      const estado = req.body[`estado_${a.id}`];
      if (!ESTADOS_ASISTENCIA[estado]) continue;
      const observacion = texto(req.body[`obs_${a.id}`], 300) || null;
      const previo = db.get('SELECT estado FROM asistencia WHERE alumno_id = ? AND fecha = ?', a.id, fecha);
      db.run(
        `INSERT INTO asistencia (alumno_id, fecha, estado, observacion, registrado_por) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(alumno_id, fecha) DO UPDATE SET estado = excluded.estado, observacion = excluded.observacion,
           registrado_por = excluded.registrado_por, actualizado_en = datetime('now')`,
        a.id,
        fecha,
        estado,
        observacion,
        req.user.id,
      );
      // Avisar a la familia solo de faltas/retrasos nuevos
      if (notificar && (estado === 'ausente' || estado === 'retraso') && (!previo || previo.estado !== estado)) {
        faltas++;
        const tutores = db.all('SELECT tutor_id FROM alumno_tutores WHERE alumno_id = ?', a.id);
        for (const t of tutores) {
          db.run(
            'INSERT INTO mensajes (remitente_id, destinatario_id, alumno_id, asunto, cuerpo) VALUES (?, ?, ?, ?, ?)',
            req.user.id,
            t.tutor_id,
            a.id,
            `${estado === 'ausente' ? 'Falta de asistencia' : 'Retraso'}: ${a.nombre} ${a.apellidos} (${fmtFecha(fecha)})`,
            `Les informamos de que ${a.nombre} ${estado === 'ausente' ? 'no ha asistido a clase' : 'ha llegado con retraso'} el día ${fmtFecha(fecha)}.` +
              `${observacion ? `\n\nObservación: ${observacion}` : ''}\n\nPueden justificarlo desde la ficha del alumno, pestaña "Asistencia".`,
          );
        }
      }
    }
  });
  registrar(db, req.user.id, 'pasar_lista', 'clase', claseId);
  req.flash('ok', `Asistencia del ${fmtFecha(fecha)} guardada.${notificar && faltas ? ` Se ha avisado a ${faltas} familia(s).` : ''}`);
  res.redirect(`/asistencia?clase=${claseId}&fecha=${fecha}`);
});

// Resumen mensual por clase
router.get('/resumen', (req, res, next) => {
  const db = req.db;
  const clases = clasesDisponibles(db, req.user);
  const claseId = req.query.clase ? Number(req.query.clase) : clases[0] && clases[0].id;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoy().slice(0, 7);
  if (claseId && !puedePasarLista(db, req.user, claseId)) return next(new HttpError(403, 'No tienes acceso a esta clase.'));

  const [y, m] = mes.split('-').map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  const dias = [];
  for (let d = 1; d <= diasMes; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) dias.push({ dia: d, fecha: `${mes}-${String(d).padStart(2, '0')}` });
  }
  let filas = [];
  if (claseId) {
    const registros = db.all(
      `SELECT s.alumno_id, s.fecha, s.estado FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id
        WHERE a.clase_id = ? AND s.fecha LIKE ?`,
      claseId,
      `${mes}-%`,
    );
    filas = db
      .all('SELECT id, nombre, apellidos FROM alumnos WHERE clase_id = ? AND activo = 1 ORDER BY apellidos, nombre', claseId)
      .map((a) => {
        const propios = registros.filter((r) => r.alumno_id === a.id);
        const porFecha = Object.fromEntries(propios.map((r) => [r.fecha, r.estado]));
        const cuenta = (e) => propios.filter((r) => r.estado === e).length;
        return {
          ...a,
          porFecha,
          faltas: cuenta('ausente'),
          justificadas: cuenta('justificada'),
          retrasos: cuenta('retraso'),
          porcentaje: propios.length ? (100 * (cuenta('presente') + cuenta('retraso'))) / propios.length : null,
        };
      });
  }
  res.render('asistencia/resumen', { titulo: 'Resumen de asistencia', clases, claseId, mes, dias, filas });
});

// Justificaciones enviadas por las familias pendientes de revisar
router.get('/justificaciones', (req, res) => {
  const db = req.db;
  const ids = clasesDisponibles(db, req.user).map((c) => c.id);
  const pendientes = db.all(
    `SELECT s.*, a.nombre, a.apellidos, c.nombre AS clase FROM asistencia s
       JOIN alumnos a ON a.id = s.alumno_id JOIN clases c ON c.id = a.clase_id
      WHERE s.motivo_familia IS NOT NULL AND s.estado IN ('ausente', 'retraso')
        AND c.id IN (${ids.map(() => '?').join(',') || 'NULL'})
      ORDER BY s.fecha DESC`,
    ...ids,
  );
  res.render('asistencia/justificaciones', { titulo: 'Justificaciones pendientes', pendientes });
});

router.post('/:id/revisar', (req, res, next) => {
  const db = req.db;
  const reg = db.get('SELECT s.*, a.clase_id FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id WHERE s.id = ?', Number(req.params.id));
  if (!reg) return next(new HttpError(404, 'Registro no encontrado.'));
  if (!puedePasarLista(db, req.user, reg.clase_id)) return next(new HttpError(403, 'No tienes acceso a esta clase.'));
  if (req.body.accion === 'aceptar') {
    db.run(
      "UPDATE asistencia SET estado = 'justificada', registrado_por = ?, actualizado_en = datetime('now') WHERE id = ?",
      req.user.id,
      reg.id,
    );
    req.flash('ok', 'Falta justificada.');
  } else {
    db.run(
      `UPDATE asistencia SET observacion = trim(IFNULL(observacion, '') || ' [Justificación no aceptada: ' || motivo_familia || ']'),
              motivo_familia = NULL, registrado_por = ?, actualizado_en = datetime('now') WHERE id = ?`,
      req.user.id,
      reg.id,
    );
    req.flash('ok', 'Justificación rechazada.');
  }
  registrar(db, req.user.id, 'revisar_justificacion', 'alumno', reg.alumno_id);
  res.redirect(req.body.volver === 'ficha' ? `/alumnos/${reg.alumno_id}?tab=asistencia` : '/asistencia/justificaciones');
});

module.exports = router;
