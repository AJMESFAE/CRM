'use strict';

const express = require('express');
const { requireRol } = require('../auth');
const { alumnoIdsVisibles } = require('../access');
const { TIPOS_SEGUIMIENTO } = require('../helpers');

const router = express.Router();
router.use(requireRol('direccion', 'profesor'));

// Listado global de anotaciones de seguimiento de los alumnos visibles
router.get('/', (req, res) => {
  const db = req.db;
  const tipo = TIPOS_SEGUIMIENTO[req.query.tipo] ? req.query.tipo : null;
  const ids = alumnoIdsVisibles(db, req.user);
  const params = [...ids];
  let filtro = '';
  if (tipo) {
    filtro = 'AND s.tipo = ?';
    params.push(tipo);
  }
  const anotaciones = db.all(
    `SELECT s.*, a.nombre, a.apellidos, c.nombre AS clase, u.nombre AS autor_nombre, u.apellidos AS autor_apellidos
       FROM seguimiento s JOIN alumnos a ON a.id = s.alumno_id LEFT JOIN clases c ON c.id = a.clase_id
       LEFT JOIN usuarios u ON u.id = s.autor_id
      WHERE s.alumno_id IN (${ids.map(() => '?').join(',') || 'NULL'}) ${filtro}
      ORDER BY s.fecha DESC, s.id DESC LIMIT 200`,
    ...params,
  );
  res.render('seguimiento/lista', { titulo: 'Seguimiento', anotaciones, tipo, TIPOS_SEGUIMIENTO });
});

module.exports = router;
