'use strict';

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { requireRol } = require('../auth');
const { puedeVerAlumno, alumnoIdsVisibles, registrar } = require('../access');
const { resumenAsistencia } = require('./dashboard');
const { texto, check, esFecha, media, hoy, HttpError, TIPOS_SEGUIMIENTO, PARENTESCOS } = require('../helpers');

const router = express.Router();
const soloDireccion = requireRol('direccion');

const CAMPOS = [
  ['numero_expediente', 20],
  ['nombre', 80],
  ['apellidos', 120],
  ['fecha_nacimiento', 10],
  ['sexo', 1],
  ['dni_nie', 20],
  ['nacionalidad', 60],
  ['direccion', 200],
  ['localidad', 100],
  ['codigo_postal', 10],
  ['clase_id', 10],
  ['fecha_matricula', 10],
  ['alergias', 1000],
  ['condiciones_medicas', 1000],
  ['medicacion', 1000],
  ['necesidades_educativas', 1000],
  ['observaciones', 2000],
];
const CHECKS = ['autorizacion_imagenes', 'autorizacion_salidas', 'consentimiento_datos'];

function leerFormulario(body) {
  const datos = {};
  for (const [campo, max] of CAMPOS) datos[campo] = texto(body[campo], max) || null;
  for (const c of CHECKS) datos[c] = check(body[c]);
  datos.clase_id = datos.clase_id ? Number(datos.clase_id) : null;
  if (datos.sexo && !['M', 'F', 'X'].includes(datos.sexo)) datos.sexo = null;
  return datos;
}

function validar(db, datos, id = null) {
  const errores = [];
  if (!datos.nombre) errores.push('El nombre es obligatorio.');
  if (!datos.apellidos) errores.push('Los apellidos son obligatorios.');
  if (!datos.numero_expediente) errores.push('El número de expediente es obligatorio.');
  if (!esFecha(datos.fecha_nacimiento)) errores.push('La fecha de nacimiento no es válida.');
  if (datos.fecha_matricula && !esFecha(datos.fecha_matricula)) errores.push('La fecha de matrícula no es válida.');
  if (datos.clase_id && !db.get('SELECT 1 FROM clases WHERE id = ?', datos.clase_id)) errores.push('La clase no existe.');
  const dup = db.get('SELECT id FROM alumnos WHERE numero_expediente = ? AND id IS NOT ?', datos.numero_expediente, id);
  if (dup) errores.push('Ya existe un alumno con ese número de expediente.');
  return errores;
}

function cargarAlumno(req, res, next) {
  const id = Number(req.params.id);
  const alumno = req.db.get(
    `SELECT a.*, c.nombre AS clase, c.tutor_id AS tutor_clase_id
       FROM alumnos a LEFT JOIN clases c ON c.id = a.clase_id WHERE a.id = ?`,
    id,
  );
  if (!alumno) return next(new HttpError(404, 'Alumno no encontrado.'));
  if (!puedeVerAlumno(req.db, req.user, id)) return next(new HttpError(403, 'No tienes acceso a este alumno.'));
  req.alumno = alumno;
  next();
}

function esTutorLegal(db, user, alumnoId) {
  return user.rol === 'tutor' && !!db.get('SELECT 1 FROM alumno_tutores WHERE alumno_id = ? AND tutor_id = ?', alumnoId, user.id);
}

function clases(db) {
  return db.all('SELECT id, nombre, curso_academico FROM clases ORDER BY curso_academico DESC, nombre');
}

// Calificaciones agrupadas por asignatura y trimestre
function boletin(db, alumno) {
  const asignaturas = db.all(
    `SELECT s.id, s.nombre, u.nombre AS prof_nombre, u.apellidos AS prof_apellidos
       FROM asignaturas s
       LEFT JOIN clase_asignaturas ca ON ca.asignatura_id = s.id AND ca.clase_id = ?
       LEFT JOIN usuarios u ON u.id = ca.profesor_id
      WHERE ca.id IS NOT NULL OR s.id IN (SELECT asignatura_id FROM notas WHERE alumno_id = ?)
      ORDER BY s.nombre`,
    alumno.clase_id,
    alumno.id,
  );
  const notas = db.all('SELECT * FROM notas WHERE alumno_id = ? ORDER BY fecha, id', alumno.id);
  const filas = asignaturas.map((s) => {
    const propias = notas.filter((n) => n.asignatura_id === s.id);
    const trimestres = [1, 2, 3].map((t) => {
      const delTrim = propias.filter((n) => n.trimestre === t);
      const final = delTrim.find((n) => n.tipo === 'final');
      return { notas: delTrim, media: final ? final.nota : media(delTrim) };
    });
    const conMedia = trimestres.filter((t) => t.media !== null);
    return {
      ...s,
      trimestres,
      notas: propias,
      mediaCurso: conMedia.length ? conMedia.reduce((a, t) => a + t.media, 0) / conMedia.length : null,
    };
  });
  return filas;
}

// ---------------------------------------------------------------- Listado
router.get('/', (req, res) => {
  const db = req.db;
  const q = texto(req.query.q, 100);
  const claseId = req.query.clase ? Number(req.query.clase) : null;
  const estado = req.query.estado === 'baja' ? 0 : 1;
  const ids = alumnoIdsVisibles(db, req.user);
  if (req.user.rol === 'tutor' && ids.length === 1) return res.redirect(`/alumnos/${ids[0]}`);

  const where = ['a.activo = ?'];
  const params = [estado];
  if (req.user.rol !== 'direccion') {
    where.push(`a.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    params.push(...ids);
  }
  if (q) {
    where.push("(a.nombre || ' ' || a.apellidos LIKE ? OR a.numero_expediente LIKE ? OR a.dni_nie LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (claseId) {
    where.push('a.clase_id = ?');
    params.push(claseId);
  }
  const alumnos = db.all(
    `SELECT a.id, a.numero_expediente, a.nombre, a.apellidos, a.fecha_nacimiento, a.alergias, a.necesidades_educativas,
            c.nombre AS clase,
            (SELECT COUNT(*) FROM asistencia s WHERE s.alumno_id = a.id AND s.estado = 'ausente') AS faltas
       FROM alumnos a LEFT JOIN clases c ON c.id = a.clase_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.nombre, a.apellidos, a.nombre`,
    ...params,
  );
  const clasesFiltro =
    req.user.rol === 'direccion'
      ? clases(db)
      : db.all(
          `SELECT DISTINCT c.id, c.nombre FROM clases c JOIN alumnos a ON a.clase_id = c.id
            WHERE a.id IN (${ids.map(() => '?').join(',') || 'NULL'}) ORDER BY c.nombre`,
          ...ids,
        );
  res.render('alumnos/lista', { titulo: 'Alumnos', alumnos, clases: clasesFiltro, q, claseId, estado });
});

router.get('/exportar.csv', soloDireccion, (req, res) => {
  const filas = req.db.all(
    `SELECT a.numero_expediente, a.apellidos, a.nombre, a.fecha_nacimiento, a.dni_nie, c.nombre AS clase,
            a.direccion, a.localidad, a.codigo_postal,
            (SELECT group_concat(u.nombre || ' ' || u.apellidos || ' (' || at.parentesco || ') ' || IFNULL(u.telefono, '') || ' ' || u.email, ' | ')
               FROM alumno_tutores at JOIN usuarios u ON u.id = at.tutor_id WHERE at.alumno_id = a.id) AS familia
       FROM alumnos a LEFT JOIN clases c ON c.id = a.clase_id WHERE a.activo = 1 ORDER BY c.nombre, a.apellidos`,
  );
  const cols = ['numero_expediente', 'apellidos', 'nombre', 'fecha_nacimiento', 'dni_nie', 'clase', 'direccion', 'localidad', 'codigo_postal', 'familia'];
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evitar inyección de fórmulas en hojas de cálculo
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(';'), ...filas.map((f) => cols.map((c) => esc(f[c])).join(';'))].join('\r\n');
  registrar(req.db, req.user.id, 'exportar_alumnos');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="alumnos-${hoy()}.csv"`);
  res.send(`﻿${csv}`);
});

// ---------------------------------------------------------------- Alta
router.get('/nuevo', soloDireccion, (req, res) => {
  res.render('alumnos/form', {
    titulo: 'Nuevo alumno',
    alumno: { fecha_matricula: hoy(), clase_id: req.query.clase ? Number(req.query.clase) : null },
    clases: clases(req.db),
    errores: [],
  });
});

router.post('/', soloDireccion, (req, res) => {
  const datos = leerFormulario(req.body);
  const errores = validar(req.db, datos);
  if (errores.length) {
    return res.status(400).render('alumnos/form', { titulo: 'Nuevo alumno', alumno: datos, clases: clases(req.db), errores });
  }
  const cols = Object.keys(datos);
  const r = req.db.run(
    `INSERT INTO alumnos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ...cols.map((c) => datos[c]),
  );
  registrar(req.db, req.user.id, 'crear_alumno', 'alumno', Number(r.lastInsertRowid));
  req.flash('ok', 'Alumno dado de alta. Ahora puedes vincular a sus padres/tutores legales.');
  res.redirect(`/alumnos/${r.lastInsertRowid}?tab=familia`);
});

// ---------------------------------------------------------------- Ficha
router.get('/:id', cargarAlumno, (req, res) => {
  const db = req.db;
  const a = req.alumno;
  const u = req.user;
  const tab = ['datos', 'familia', 'asistencia', 'notas', 'seguimiento'].includes(req.query.tab) ? req.query.tab : 'datos';

  const tutores = db.all(
    `SELECT u.id, u.nombre, u.apellidos, u.email, u.telefono, u.telefono_secundario, u.dni, u.profesion,
            at.parentesco, at.contacto_principal, at.custodia, at.autorizado_recogida
       FROM alumno_tutores at JOIN usuarios u ON u.id = at.tutor_id
      WHERE at.alumno_id = ? ORDER BY at.contacto_principal DESC, u.apellidos`,
    a.id,
  );
  const contactos = db.all('SELECT * FROM contactos_emergencia WHERE alumno_id = ? ORDER BY nombre', a.id);
  const profesorado = a.clase_id
    ? db.all(
        `SELECT s.nombre AS asignatura, u.id AS profesor_id, u.nombre, u.apellidos, u.email
           FROM clase_asignaturas ca JOIN asignaturas s ON s.id = ca.asignatura_id
           LEFT JOIN usuarios u ON u.id = ca.profesor_id
          WHERE ca.clase_id = ? ORDER BY s.nombre`,
        a.clase_id,
      )
    : [];
  const tutorClase = a.tutor_clase_id
    ? db.get('SELECT id, nombre, apellidos, email, telefono FROM usuarios WHERE id = ?', a.tutor_clase_id)
    : null;
  const asistencia = db.all(
    `SELECT s.*, u.nombre AS reg_nombre, u.apellidos AS reg_apellidos FROM asistencia s
       LEFT JOIN usuarios u ON u.id = s.registrado_por
      WHERE s.alumno_id = ? AND s.estado != 'presente' ORDER BY s.fecha DESC`,
    a.id,
  );
  const seguimiento = db.all(
    `SELECT s.*, u.nombre AS autor_nombre, u.apellidos AS autor_apellidos, u.rol AS autor_rol
       FROM seguimiento s LEFT JOIN usuarios u ON u.id = s.autor_id
      WHERE s.alumno_id = ? ${u.rol === 'tutor' ? 'AND s.visible_familia = 1' : ''}
      ORDER BY s.fecha DESC, s.id DESC`,
    a.id,
  );
  const tutoresDisponibles =
    u.rol === 'direccion'
      ? db.all(
          `SELECT id, nombre, apellidos, email FROM usuarios WHERE rol = 'tutor' AND activo = 1
              AND id NOT IN (SELECT tutor_id FROM alumno_tutores WHERE alumno_id = ?) ORDER BY apellidos`,
          a.id,
        )
      : [];

  registrar(db, u.id, 'ver_ficha', 'alumno', a.id);
  res.render('alumnos/ficha', {
    titulo: `${a.nombre} ${a.apellidos}`,
    alumno: a,
    tab,
    tutores,
    contactos,
    profesorado,
    tutorClase,
    resumen: resumenAsistencia(db, a.id),
    asistencia,
    boletin: boletin(db, a),
    seguimiento,
    tutoresDisponibles,
    esTutorLegal: esTutorLegal(db, u, a.id),
    TIPOS_SEGUIMIENTO,
    PARENTESCOS,
  });
});

router.get('/:id/boletin', cargarAlumno, (req, res) => {
  const a = req.alumno;
  const tutorClase = a.tutor_clase_id ? req.db.get('SELECT nombre, apellidos FROM usuarios WHERE id = ?', a.tutor_clase_id) : null;
  res.render('alumnos/boletin', {
    titulo: `Boletín de ${a.nombre} ${a.apellidos}`,
    alumno: a,
    boletin: boletin(req.db, a),
    resumen: resumenAsistencia(req.db, a.id),
    tutorClase,
  });
});

// ---------------------------------------------------------------- Edición
router.get('/:id/editar', soloDireccion, cargarAlumno, (req, res) => {
  res.render('alumnos/form', { titulo: 'Editar alumno', alumno: req.alumno, clases: clases(req.db), errores: [] });
});

router.post('/:id', soloDireccion, cargarAlumno, (req, res) => {
  const datos = leerFormulario(req.body);
  const errores = validar(req.db, datos, req.alumno.id);
  if (errores.length) {
    return res.status(400).render('alumnos/form', {
      titulo: 'Editar alumno',
      alumno: { ...datos, id: req.alumno.id },
      clases: clases(req.db),
      errores,
    });
  }
  const cols = Object.keys(datos);
  req.db.run(`UPDATE alumnos SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => datos[c]), req.alumno.id);
  registrar(req.db, req.user.id, 'editar_alumno', 'alumno', req.alumno.id);
  req.flash('ok', 'Datos del alumno actualizados.');
  res.redirect(`/alumnos/${req.alumno.id}`);
});

router.post('/:id/estado', soloDireccion, cargarAlumno, (req, res) => {
  const activo = req.alumno.activo ? 0 : 1;
  req.db.run('UPDATE alumnos SET activo = ? WHERE id = ?', activo, req.alumno.id);
  registrar(req.db, req.user.id, activo ? 'alta_alumno' : 'baja_alumno', 'alumno', req.alumno.id);
  req.flash('ok', activo ? 'Alumno reactivado.' : 'Alumno dado de baja.');
  res.redirect(`/alumnos/${req.alumno.id}`);
});

// ---------------------------------------------------------------- Familia
router.post('/:id/tutores', soloDireccion, cargarAlumno, (req, res) => {
  const db = req.db;
  const b = req.body;
  const parentesco = texto(b.parentesco, 40) || 'Tutor/a legal';
  let tutorId = b.tutor_id ? Number(b.tutor_id) : null;
  let passwordTemporal = null;

  if (!tutorId) {
    const email = texto(b.email, 120).toLowerCase();
    const nombre = texto(b.nombre, 80);
    const apellidos = texto(b.apellidos, 120);
    if (!email || !nombre || !apellidos || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      req.flash('error', 'Indica nombre, apellidos y un email válido del padre/madre/tutor.');
      return res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
    }
    const existente = db.get('SELECT id, rol FROM usuarios WHERE email = ?', email);
    if (existente && existente.rol !== 'tutor') {
      req.flash('error', 'Ese email pertenece a un usuario que no es padre/tutor.');
      return res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
    }
    if (existente) {
      tutorId = existente.id;
    } else {
      passwordTemporal = crypto.randomBytes(6).toString('base64url');
      const r = db.run(
        `INSERT INTO usuarios (email, password_hash, rol, nombre, apellidos, dni, telefono, profesion)
         VALUES (?, ?, 'tutor', ?, ?, ?, ?, ?)`,
        email,
        bcrypt.hashSync(passwordTemporal, 10),
        nombre,
        apellidos,
        texto(b.dni, 20),
        texto(b.telefono, 30),
        texto(b.profesion, 100),
      );
      tutorId = Number(r.lastInsertRowid);
      registrar(db, req.user.id, 'crear_usuario', 'usuario', tutorId);
    }
  } else if (!db.get("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'tutor'", tutorId)) {
    req.flash('error', 'El usuario seleccionado no es un padre/tutor.');
    return res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
  }

  db.tx(() => {
    if (check(b.contacto_principal)) db.run('UPDATE alumno_tutores SET contacto_principal = 0 WHERE alumno_id = ?', req.alumno.id);
    db.run(
      `INSERT INTO alumno_tutores (alumno_id, tutor_id, parentesco, contacto_principal, custodia, autorizado_recogida)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(alumno_id, tutor_id) DO UPDATE SET parentesco = excluded.parentesco,
         contacto_principal = excluded.contacto_principal, custodia = excluded.custodia,
         autorizado_recogida = excluded.autorizado_recogida`,
      req.alumno.id,
      tutorId,
      parentesco,
      check(b.contacto_principal),
      check(b.custodia),
      check(b.autorizado_recogida),
    );
  });
  registrar(db, req.user.id, 'vincular_tutor', 'alumno', req.alumno.id);
  req.flash(
    'ok',
    passwordTemporal
      ? `Familiar creado y vinculado. Contraseña temporal de acceso: ${passwordTemporal} (comunícala de forma segura).`
      : 'Familiar vinculado al alumno.',
  );
  res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
});

router.post('/:id/tutores/:tutorId/eliminar', soloDireccion, cargarAlumno, (req, res) => {
  req.db.run('DELETE FROM alumno_tutores WHERE alumno_id = ? AND tutor_id = ?', req.alumno.id, Number(req.params.tutorId));
  registrar(req.db, req.user.id, 'desvincular_tutor', 'alumno', req.alumno.id);
  req.flash('ok', 'Familiar desvinculado.');
  res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
});

// Contactos de emergencia: Dirección o la propia familia
function puedeEditarContactos(req, res, next) {
  if (req.user.rol === 'direccion' || esTutorLegal(req.db, req.user, req.alumno.id)) return next();
  next(new HttpError(403, 'No puedes modificar los contactos de este alumno.'));
}

router.post('/:id/contactos', cargarAlumno, puedeEditarContactos, (req, res) => {
  const nombre = texto(req.body.nombre, 120);
  const telefono = texto(req.body.telefono, 30);
  if (!nombre || !telefono) {
    req.flash('error', 'Nombre y teléfono son obligatorios.');
  } else {
    req.db.run(
      'INSERT INTO contactos_emergencia (alumno_id, nombre, parentesco, telefono, autorizado_recogida) VALUES (?, ?, ?, ?, ?)',
      req.alumno.id,
      nombre,
      texto(req.body.parentesco, 40),
      telefono,
      check(req.body.autorizado_recogida),
    );
    registrar(req.db, req.user.id, 'añadir_contacto', 'alumno', req.alumno.id);
    req.flash('ok', 'Contacto añadido.');
  }
  res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
});

router.post('/:id/contactos/:cid/eliminar', cargarAlumno, puedeEditarContactos, (req, res) => {
  req.db.run('DELETE FROM contactos_emergencia WHERE id = ? AND alumno_id = ?', Number(req.params.cid), req.alumno.id);
  req.flash('ok', 'Contacto eliminado.');
  res.redirect(`/alumnos/${req.alumno.id}?tab=familia`);
});

// ---------------------------------------------------------------- Justificación de faltas (familia)
router.post('/:id/asistencia/:aid/justificar', cargarAlumno, (req, res, next) => {
  if (!esTutorLegal(req.db, req.user, req.alumno.id)) return next(new HttpError(403, 'Solo la familia puede justificar faltas.'));
  const motivo = texto(req.body.motivo, 500);
  if (!motivo) {
    req.flash('error', 'Indica el motivo de la falta.');
    return res.redirect(`/alumnos/${req.alumno.id}?tab=asistencia`);
  }
  const r = req.db.run(
    `UPDATE asistencia SET motivo_familia = ?, motivo_familia_en = datetime('now')
      WHERE id = ? AND alumno_id = ? AND estado IN ('ausente', 'retraso')`,
    motivo,
    Number(req.params.aid),
    req.alumno.id,
  );
  req.flash(r.changes ? 'ok' : 'error', r.changes ? 'Justificación enviada al centro.' : 'No se ha encontrado la falta.');
  res.redirect(`/alumnos/${req.alumno.id}?tab=asistencia`);
});

// ---------------------------------------------------------------- Seguimiento
router.post('/:id/seguimiento', requireRol('direccion', 'profesor'), cargarAlumno, (req, res) => {
  const tipo = req.body.tipo;
  const titulo = texto(req.body.titulo, 150);
  const descripcion = texto(req.body.descripcion, 4000);
  const fecha = esFecha(req.body.fecha) ? req.body.fecha : hoy();
  if (!TIPOS_SEGUIMIENTO[tipo] || !titulo || !descripcion) {
    req.flash('error', 'Completa el tipo, el título y la descripción.');
  } else {
    req.db.run(
      `INSERT INTO seguimiento (alumno_id, fecha, tipo, titulo, descripcion, visible_familia, autor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.alumno.id,
      fecha,
      tipo,
      titulo,
      descripcion,
      check(req.body.visible_familia),
      req.user.id,
    );
    registrar(req.db, req.user.id, 'crear_seguimiento', 'alumno', req.alumno.id);
    req.flash('ok', 'Anotación de seguimiento registrada.');
  }
  res.redirect(`/alumnos/${req.alumno.id}?tab=seguimiento`);
});

router.post('/:id/seguimiento/:sid/eliminar', requireRol('direccion', 'profesor'), cargarAlumno, (req, res, next) => {
  const s = req.db.get('SELECT * FROM seguimiento WHERE id = ? AND alumno_id = ?', Number(req.params.sid), req.alumno.id);
  if (!s) return next(new HttpError(404, 'Anotación no encontrada.'));
  if (req.user.rol !== 'direccion' && s.autor_id !== req.user.id) {
    return next(new HttpError(403, 'Solo el autor o Dirección pueden eliminar esta anotación.'));
  }
  req.db.run('DELETE FROM seguimiento WHERE id = ?', s.id);
  registrar(req.db, req.user.id, 'eliminar_seguimiento', 'alumno', req.alumno.id);
  req.flash('ok', 'Anotación eliminada.');
  res.redirect(`/alumnos/${req.alumno.id}?tab=seguimiento`);
});

module.exports = router;
module.exports.boletin = boletin;
