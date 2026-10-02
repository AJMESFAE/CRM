'use strict';

const express = require('express');
const { requireRol } = require('../auth');
const { esFecha, hoy, cursoAcademicoActual, ROLES } = require('../helpers');

const router = express.Router();
router.use(requireRol('direccion'));

router.get('/', (req, res) => {
  const db = req.db;
  const inicioCurso = `${cursoAcademicoActual().slice(0, 4)}-09-01`;
  const desde = esFecha(req.query.desde) ? req.query.desde : inicioCurso;
  const hasta = esFecha(req.query.hasta) ? req.query.hasta : hoy();

  const porClase = db.all(
    `SELECT c.id, c.nombre, u.nombre AS tutor_nombre, u.apellidos AS tutor_apellidos,
            (SELECT COUNT(*) FROM alumnos a WHERE a.clase_id = c.id AND a.activo = 1) AS alumnos,
            (SELECT COUNT(*) FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id
              WHERE a.clase_id = c.id AND s.fecha BETWEEN ? AND ?) AS registros,
            (SELECT COUNT(*) FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id
              WHERE a.clase_id = c.id AND s.fecha BETWEEN ? AND ? AND s.estado IN ('presente', 'retraso')) AS asistidos,
            (SELECT COUNT(*) FROM asistencia s JOIN alumnos a ON a.id = s.alumno_id
              WHERE a.clase_id = c.id AND s.fecha BETWEEN ? AND ? AND s.estado = 'ausente') AS faltas,
            (SELECT SUM(n.nota * n.peso) / SUM(n.peso) FROM notas n JOIN alumnos a ON a.id = n.alumno_id
              WHERE a.clase_id = c.id AND n.fecha BETWEEN ? AND ?) AS media
       FROM clases c LEFT JOIN usuarios u ON u.id = c.tutor_id ORDER BY c.nombre`,
    desde,
    hasta,
    desde,
    hasta,
    desde,
    hasta,
    desde,
    hasta,
  );

  const porAsignatura = db.all(
    `SELECT s.nombre, COUNT(n.id) AS num, SUM(n.nota * n.peso) / SUM(n.peso) AS media,
            SUM(n.nota < 5) AS suspensos
       FROM notas n JOIN asignaturas s ON s.id = n.asignatura_id
      WHERE n.fecha BETWEEN ? AND ? GROUP BY s.id ORDER BY media`,
    desde,
    hasta,
  );

  // Alumnos en riesgo: asistencia < 85 % o media suspensa en 2 o más asignaturas
  const riesgo = db
    .all(
      `SELECT a.id, a.nombre, a.apellidos, c.nombre AS clase,
              (SELECT COUNT(*) FROM asistencia s WHERE s.alumno_id = a.id AND s.fecha BETWEEN ? AND ?) AS registros,
              (SELECT COUNT(*) FROM asistencia s WHERE s.alumno_id = a.id AND s.fecha BETWEEN ? AND ?
                  AND s.estado IN ('presente', 'retraso')) AS asistidos,
              (SELECT COUNT(*) FROM (SELECT SUM(n.nota * n.peso) / SUM(n.peso) AS m FROM notas n
                  WHERE n.alumno_id = a.id AND n.fecha BETWEEN ? AND ? GROUP BY n.asignatura_id) WHERE m < 5) AS suspensas
         FROM alumnos a LEFT JOIN clases c ON c.id = a.clase_id WHERE a.activo = 1`,
      desde,
      hasta,
      desde,
      hasta,
      desde,
      hasta,
    )
    .map((a) => ({ ...a, porcentaje: a.registros ? (100 * a.asistidos) / a.registros : null }))
    .filter((a) => (a.porcentaje !== null && a.porcentaje < 85) || a.suspensas >= 2)
    .sort((x, y) => y.suspensas - x.suspensas || (x.porcentaje ?? 100) - (y.porcentaje ?? 100));

  const seguimientoPorTipo = db.all(
    'SELECT tipo, COUNT(*) AS n FROM seguimiento WHERE fecha BETWEEN ? AND ? GROUP BY tipo ORDER BY n DESC',
    desde,
    hasta,
  );

  res.render('informes/index', { titulo: 'Informes', desde, hasta, porClase, porAsignatura, riesgo, seguimientoPorTipo });
});

router.get('/actividad', (req, res) => {
  const actividad = req.db.all(
    `SELECT r.*, u.nombre, u.apellidos, u.rol FROM registro_actividad r LEFT JOIN usuarios u ON u.id = r.usuario_id
      ORDER BY r.id DESC LIMIT 300`,
  );
  res.render('informes/actividad', { titulo: 'Registro de actividad', actividad, ROLES });
});

module.exports = router;
