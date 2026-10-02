'use strict';

const express = require('express');
const { requireRol } = require('../auth');
const { puedeVerClase, claseIdsProfesor, registrar } = require('../access');
const { texto, ETAPAS, cursoAcademicoActual, HttpError, media } = require('../helpers');

const router = express.Router();
const soloDireccion = requireRol('direccion');
router.use(requireRol('direccion', 'profesor'));

function profesores(db) {
  return db.all("SELECT id, nombre, apellidos FROM usuarios WHERE rol = 'profesor' AND activo = 1 ORDER BY apellidos, nombre");
}

function leer(body) {
  return {
    etapa: ETAPAS.includes(body.etapa) ? body.etapa : null,
    nivel: texto(body.nivel, 20),
    grupo: texto(body.grupo, 10).toUpperCase(),
    curso_academico: texto(body.curso_academico, 9),
    aula: texto(body.aula, 30) || null,
    tutor_id: body.tutor_id ? Number(body.tutor_id) : null,
  };
}

function validar(db, d, id = null) {
  const errores = [];
  if (!d.etapa) errores.push('Selecciona una etapa educativa.');
  if (!d.nivel) errores.push('Indica el nivel (p. ej. 1º, 2º...).');
  if (!d.grupo) errores.push('Indica el grupo (A, B...).');
  if (!/^\d{4}-\d{4}$/.test(d.curso_academico)) errores.push('El curso académico debe tener el formato 2026-2027.');
  if (d.tutor_id && !db.get("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'profesor'", d.tutor_id)) {
    errores.push('El tutor seleccionado no es un profesor.');
  }
  d.nombre = `${d.nivel} ${d.etapa || ''} ${d.grupo}`.replace(/\s+/g, ' ').trim();
  if (db.get('SELECT 1 FROM clases WHERE nombre = ? AND curso_academico = ? AND id IS NOT ?', d.nombre, d.curso_academico, id)) {
    errores.push(`Ya existe la clase ${d.nombre} en el curso ${d.curso_academico}.`);
  }
  return errores;
}

function cargarClase(req, res, next) {
  const clase = req.db.get(
    `SELECT c.*, u.nombre AS tutor_nombre, u.apellidos AS tutor_apellidos, u.email AS tutor_email
       FROM clases c LEFT JOIN usuarios u ON u.id = c.tutor_id WHERE c.id = ?`,
    Number(req.params.id),
  );
  if (!clase) return next(new HttpError(404, 'Clase no encontrada.'));
  if (!puedeVerClase(req.db, req.user, clase.id)) return next(new HttpError(403, 'No tienes acceso a esta clase.'));
  req.clase = clase;
  next();
}

router.get('/', (req, res) => {
  const db = req.db;
  let filtro = '';
  let params = [];
  if (req.user.rol === 'profesor') {
    const ids = claseIdsProfesor(db, req.user.id);
    filtro = `WHERE c.id IN (${ids.map(() => '?').join(',') || 'NULL'})`;
    params = ids;
  }
  const clases = db.all(
    `SELECT c.*, u.nombre AS tutor_nombre, u.apellidos AS tutor_apellidos,
            (SELECT COUNT(*) FROM alumnos a WHERE a.clase_id = c.id AND a.activo = 1) AS num_alumnos,
            (SELECT COUNT(*) FROM clase_asignaturas ca WHERE ca.clase_id = c.id) AS num_asignaturas
       FROM clases c LEFT JOIN usuarios u ON u.id = c.tutor_id ${filtro}
      ORDER BY c.curso_academico DESC,
               CASE c.etapa WHEN 'Infantil' THEN 1 WHEN 'Primaria' THEN 2 WHEN 'ESO' THEN 3 WHEN 'Bachillerato' THEN 4 ELSE 5 END,
               c.nivel, c.grupo`,
    ...params,
  );
  res.render('clases/lista', { titulo: 'Clases', clases });
});

router.get('/nueva', soloDireccion, (req, res) => {
  res.render('clases/form', {
    titulo: 'Nueva clase',
    clase: { curso_academico: cursoAcademicoActual() },
    profesores: profesores(req.db),
    ETAPAS,
    errores: [],
  });
});

router.post('/', soloDireccion, (req, res) => {
  const d = leer(req.body);
  const errores = validar(req.db, d);
  if (errores.length) {
    return res.status(400).render('clases/form', { titulo: 'Nueva clase', clase: d, profesores: profesores(req.db), ETAPAS, errores });
  }
  const r = req.db.run(
    'INSERT INTO clases (nombre, etapa, nivel, grupo, curso_academico, aula, tutor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    d.nombre,
    d.etapa,
    d.nivel,
    d.grupo,
    d.curso_academico,
    d.aula,
    d.tutor_id,
  );
  registrar(req.db, req.user.id, 'crear_clase', 'clase', Number(r.lastInsertRowid));
  req.flash('ok', `Clase ${d.nombre} creada. Añade ahora las asignaturas y su profesorado.`);
  res.redirect(`/clases/${r.lastInsertRowid}`);
});

router.get('/:id', cargarClase, (req, res) => {
  const db = req.db;
  const c = req.clase;
  const alumnos = db
    .all(
      `SELECT a.id, a.numero_expediente, a.nombre, a.apellidos, a.fecha_nacimiento, a.alergias, a.necesidades_educativas,
              (SELECT COUNT(*) FROM asistencia s WHERE s.alumno_id = a.id) AS registros,
              (SELECT COUNT(*) FROM asistencia s WHERE s.alumno_id = a.id AND s.estado IN ('presente', 'retraso')) AS asistidos,
              (SELECT COUNT(*) FROM asistencia s WHERE s.alumno_id = a.id AND s.estado = 'ausente') AS faltas
         FROM alumnos a WHERE a.clase_id = ? AND a.activo = 1 ORDER BY a.apellidos, a.nombre`,
      c.id,
    )
    .map((a) => ({
      ...a,
      porcentaje: a.registros ? (100 * a.asistidos) / a.registros : null,
      media: media(db.all('SELECT nota, peso FROM notas WHERE alumno_id = ?', a.id)),
    }));
  const asignaturas = db.all(
    `SELECT ca.*, s.nombre AS asignatura, u.nombre AS prof_nombre, u.apellidos AS prof_apellidos
       FROM clase_asignaturas ca JOIN asignaturas s ON s.id = ca.asignatura_id LEFT JOIN usuarios u ON u.id = ca.profesor_id
      WHERE ca.clase_id = ? ORDER BY s.nombre`,
    c.id,
  );
  const todasAsignaturas =
    req.user.rol === 'direccion'
      ? db.all(
          'SELECT id, nombre FROM asignaturas WHERE id NOT IN (SELECT asignatura_id FROM clase_asignaturas WHERE clase_id = ?) ORDER BY nombre',
          c.id,
        )
      : [];
  res.render('clases/detalle', {
    titulo: c.nombre,
    clase: c,
    alumnos,
    asignaturas,
    todasAsignaturas,
    profesores: req.user.rol === 'direccion' ? profesores(db) : [],
  });
});

router.get('/:id/editar', soloDireccion, cargarClase, (req, res) => {
  res.render('clases/form', { titulo: 'Editar clase', clase: req.clase, profesores: profesores(req.db), ETAPAS, errores: [] });
});

router.post('/:id', soloDireccion, cargarClase, (req, res) => {
  const d = leer(req.body);
  const errores = validar(req.db, d, req.clase.id);
  if (errores.length) {
    return res.status(400).render('clases/form', {
      titulo: 'Editar clase',
      clase: { ...d, id: req.clase.id },
      profesores: profesores(req.db),
      ETAPAS,
      errores,
    });
  }
  req.db.run(
    'UPDATE clases SET nombre = ?, etapa = ?, nivel = ?, grupo = ?, curso_academico = ?, aula = ?, tutor_id = ? WHERE id = ?',
    d.nombre,
    d.etapa,
    d.nivel,
    d.grupo,
    d.curso_academico,
    d.aula,
    d.tutor_id,
    req.clase.id,
  );
  registrar(req.db, req.user.id, 'editar_clase', 'clase', req.clase.id);
  req.flash('ok', 'Clase actualizada.');
  res.redirect(`/clases/${req.clase.id}`);
});

router.post('/:id/eliminar', soloDireccion, cargarClase, (req, res) => {
  if (req.db.get('SELECT 1 FROM alumnos WHERE clase_id = ?', req.clase.id)) {
    req.flash('error', 'No se puede eliminar una clase con alumnos asignados.');
    return res.redirect(`/clases/${req.clase.id}`);
  }
  req.db.run('DELETE FROM clases WHERE id = ?', req.clase.id);
  registrar(req.db, req.user.id, 'eliminar_clase', 'clase', req.clase.id);
  req.flash('ok', 'Clase eliminada.');
  res.redirect('/clases');
});

// Asignaturas impartidas en la clase
router.post('/:id/asignaturas', soloDireccion, cargarClase, (req, res) => {
  const db = req.db;
  let asignaturaId = req.body.asignatura_id ? Number(req.body.asignatura_id) : null;
  const nueva = texto(req.body.nueva_asignatura, 80);
  if (!asignaturaId && nueva) {
    const existente = db.get('SELECT id FROM asignaturas WHERE nombre = ?', nueva);
    asignaturaId = existente ? existente.id : Number(db.run('INSERT INTO asignaturas (nombre) VALUES (?)', nueva).lastInsertRowid);
  }
  if (!asignaturaId || !db.get('SELECT 1 FROM asignaturas WHERE id = ?', asignaturaId)) {
    req.flash('error', 'Selecciona o escribe una asignatura.');
    return res.redirect(`/clases/${req.clase.id}`);
  }
  const profesorId = req.body.profesor_id ? Number(req.body.profesor_id) : null;
  if (profesorId && !db.get("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'profesor'", profesorId)) {
    req.flash('error', 'El profesor seleccionado no es válido.');
    return res.redirect(`/clases/${req.clase.id}`);
  }
  db.run(
    `INSERT INTO clase_asignaturas (clase_id, asignatura_id, profesor_id, horas_semana) VALUES (?, ?, ?, ?)
     ON CONFLICT(clase_id, asignatura_id) DO UPDATE SET profesor_id = excluded.profesor_id, horas_semana = excluded.horas_semana`,
    req.clase.id,
    asignaturaId,
    profesorId,
    req.body.horas_semana ? Number(req.body.horas_semana) || null : null,
  );
  registrar(db, req.user.id, 'asignar_asignatura', 'clase', req.clase.id);
  req.flash('ok', 'Asignatura asignada a la clase.');
  res.redirect(`/clases/${req.clase.id}`);
});

router.post('/:id/asignaturas/:caId/eliminar', soloDireccion, cargarClase, (req, res) => {
  req.db.run('DELETE FROM clase_asignaturas WHERE id = ? AND clase_id = ?', Number(req.params.caId), req.clase.id);
  req.flash('ok', 'Asignatura retirada de la clase.');
  res.redirect(`/clases/${req.clase.id}`);
});

module.exports = router;
