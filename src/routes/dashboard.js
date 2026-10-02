'use strict';

const express = require('express');
const { hoy, trimestreActual, media } = require('../helpers');
const { claseIdsProfesor } = require('../access');

const router = express.Router();

function resumenAsistencia(db, alumnoId) {
  const r = db.get(
    `SELECT COUNT(*) AS total,
            SUM(estado IN ('presente', 'retraso')) AS asistidos,
            SUM(estado = 'ausente') AS faltas,
            SUM(estado = 'justificada') AS justificadas,
            SUM(estado = 'retraso') AS retrasos
       FROM asistencia WHERE alumno_id = ?`,
    alumnoId,
  );
  return { ...r, porcentaje: r.total ? (100 * r.asistidos) / r.total : null };
}

router.get('/', (req, res) => {
  const db = req.db;
  const u = req.user;
  const fechaHoy = hoy();

  if (u.rol === 'direccion') {
    const totales = db.get(
      `SELECT (SELECT COUNT(*) FROM alumnos WHERE activo = 1) AS alumnos,
              (SELECT COUNT(*) FROM usuarios WHERE rol = 'profesor' AND activo = 1) AS profesores,
              (SELECT COUNT(*) FROM usuarios WHERE rol = 'tutor' AND activo = 1) AS familias,
              (SELECT COUNT(*) FROM clases) AS clases`,
    );
    const asistenciaHoy = db.get(
      `SELECT COUNT(*) AS registrados, SUM(estado = 'ausente') AS faltas, SUM(estado = 'retraso') AS retrasos,
              SUM(estado = 'justificada') AS justificadas
         FROM asistencia WHERE fecha = ?`,
      fechaHoy,
    );
    const clasesSinLista = db.all(
      `SELECT c.id, c.nombre FROM clases c
        WHERE EXISTS (SELECT 1 FROM alumnos a WHERE a.clase_id = c.id AND a.activo = 1)
          AND NOT EXISTS (SELECT 1 FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id
                           WHERE a.clase_id = c.id AND s.fecha = ?)
        ORDER BY c.nombre`,
      fechaHoy,
    );
    const masFaltas = db.all(
      `SELECT a.id, a.nombre, a.apellidos, c.nombre AS clase, COUNT(*) AS faltas
         FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id LEFT JOIN clases c ON c.id = a.clase_id
        WHERE s.estado = 'ausente' AND s.fecha >= date('now', '-30 day')
        GROUP BY a.id ORDER BY faltas DESC LIMIT 5`,
    );
    const pendientes = db.get(
      "SELECT COUNT(*) AS n FROM asistencia WHERE motivo_familia IS NOT NULL AND estado IN ('ausente', 'retraso')",
    ).n;
    const ultimos = db.all(
      `SELECT s.*, a.nombre, a.apellidos, u.nombre AS autor_nombre, u.apellidos AS autor_apellidos
         FROM seguimiento s JOIN alumnos a ON a.id = s.alumno_id LEFT JOIN usuarios u ON u.id = s.autor_id
        ORDER BY s.fecha DESC, s.id DESC LIMIT 6`,
    );
    return res.render('dashboard/direccion', {
      titulo: 'Panel de Dirección',
      totales,
      asistenciaHoy,
      clasesSinLista,
      masFaltas,
      pendientes,
      ultimos,
    });
  }

  if (u.rol === 'profesor') {
    const ids = claseIdsProfesor(db, u.id);
    const marcadores = ids.map(() => '?').join(',') || 'NULL';
    const clases = db.all(
      `SELECT c.*, (c.tutor_id = ?) AS soy_tutor,
              (SELECT COUNT(*) FROM alumnos a WHERE a.clase_id = c.id AND a.activo = 1) AS num_alumnos,
              (SELECT COUNT(*) FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id
                WHERE a.clase_id = c.id AND s.fecha = ?) AS registrados_hoy
         FROM clases c WHERE c.id IN (${marcadores}) ORDER BY c.nombre`,
      u.id,
      fechaHoy,
      ...ids,
    );
    const asignaturas = db.all(
      `SELECT ca.clase_id, ca.asignatura_id, c.nombre AS clase, s.nombre AS asignatura
         FROM clase_asignaturas ca JOIN clases c ON c.id = ca.clase_id JOIN asignaturas s ON s.id = ca.asignatura_id
        WHERE ca.profesor_id = ? ORDER BY c.nombre, s.nombre`,
      u.id,
    );
    const pendientes = db.all(
      `SELECT s.id, s.fecha, s.estado, s.motivo_familia, a.id AS alumno_id, a.nombre, a.apellidos, c.nombre AS clase
         FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id JOIN clases c ON c.id = a.clase_id
        WHERE s.motivo_familia IS NOT NULL AND s.estado IN ('ausente', 'retraso') AND c.id IN (${marcadores})
        ORDER BY s.fecha DESC LIMIT 10`,
      ...ids,
    );
    const ultimos = db.all(
      `SELECT s.*, a.nombre, a.apellidos FROM seguimiento s JOIN alumnos a ON a.id = s.alumno_id
        WHERE s.autor_id = ? ORDER BY s.fecha DESC, s.id DESC LIMIT 5`,
      u.id,
    );
    return res.render('dashboard/profesor', {
      titulo: 'Mi panel',
      clases,
      asignaturas,
      pendientes,
      ultimos,
      fechaHoy,
    });
  }

  // Padres / tutores legales
  const trimestre = trimestreActual();
  const hijos = db
    .all(
      `SELECT a.*, c.nombre AS clase, t.nombre AS tutor_nombre, t.apellidos AS tutor_apellidos, t.id AS tutor_clase_id
         FROM alumno_tutores at JOIN alumnos a ON a.id = at.alumno_id
         LEFT JOIN clases c ON c.id = a.clase_id LEFT JOIN usuarios t ON t.id = c.tutor_id
        WHERE at.tutor_id = ? ORDER BY a.fecha_nacimiento`,
      u.id,
    )
    .map((a) => {
      const notas = db.all('SELECT nota, peso FROM notas WHERE alumno_id = ? AND trimestre = ?', a.id, trimestre);
      const ultimasNotas = db.all(
        `SELECT n.*, s.nombre AS asignatura FROM notas n JOIN asignaturas s ON s.id = n.asignatura_id
          WHERE n.alumno_id = ? ORDER BY n.fecha DESC, n.id DESC LIMIT 4`,
        a.id,
      );
      const seguimiento = db.all(
        `SELECT * FROM seguimiento WHERE alumno_id = ? AND visible_familia = 1 ORDER BY fecha DESC, id DESC LIMIT 3`,
        a.id,
      );
      return { ...a, asistencia: resumenAsistencia(db, a.id), media: media(notas), ultimasNotas, seguimiento };
    });
  res.render('dashboard/tutor', { titulo: 'Mis hijos', hijos, trimestre });
});

module.exports = router;
module.exports.resumenAsistencia = resumenAsistencia;
