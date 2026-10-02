'use strict';

const express = require('express');
const { destinatariosPermitidos, alumnoIdsVisibles, puedeVerAlumno } = require('../access');
const { texto, HttpError } = require('../helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const carpeta = req.query.carpeta === 'enviados' ? 'enviados' : 'recibidos';
  const campo = carpeta === 'enviados' ? 'm.remitente_id' : 'm.destinatario_id';
  const otro = carpeta === 'enviados' ? 'm.destinatario_id' : 'm.remitente_id';
  const mensajes = req.db.all(
    `SELECT m.*, u.nombre AS otro_nombre, u.apellidos AS otro_apellidos, u.rol AS otro_rol,
            a.nombre AS alumno_nombre, a.apellidos AS alumno_apellidos
       FROM mensajes m JOIN usuarios u ON u.id = ${otro} LEFT JOIN alumnos a ON a.id = m.alumno_id
      WHERE ${campo} = ? ORDER BY m.id DESC LIMIT 200`,
    req.user.id,
  );
  res.render('mensajes/lista', { titulo: 'Mensajes', mensajes, carpeta });
});

function alumnosParaMensaje(db, user) {
  const ids = alumnoIdsVisibles(db, user);
  if (!ids.length) return [];
  return db.all(
    `SELECT a.id, a.nombre, a.apellidos, c.nombre AS clase FROM alumnos a LEFT JOIN clases c ON c.id = a.clase_id
      WHERE a.activo = 1 AND a.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.nombre, a.apellidos`,
    ...ids,
  );
}

router.get('/nuevo', (req, res) => {
  res.render('mensajes/nuevo', {
    titulo: 'Nuevo mensaje',
    destinatarios: destinatariosPermitidos(req.db, req.user),
    alumnos: alumnosParaMensaje(req.db, req.user),
    para: Number(req.query.para) || null,
    alumnoId: Number(req.query.alumno) || null,
    asunto: texto(req.query.asunto, 150),
    error: null,
  });
});

router.post('/', (req, res) => {
  const db = req.db;
  const para = Number(req.body.destinatario_id);
  const alumnoId = req.body.alumno_id ? Number(req.body.alumno_id) : null;
  const asunto = texto(req.body.asunto, 150);
  const cuerpo = texto(req.body.cuerpo, 5000);
  const permitidos = destinatariosPermitidos(db, req.user);
  let error = null;
  if (!permitidos.some((d) => d.id === para)) error = 'Selecciona un destinatario válido.';
  else if (alumnoId && !puedeVerAlumno(db, req.user, alumnoId)) error = 'Alumno no válido.';
  else if (!asunto || !cuerpo) error = 'El asunto y el mensaje son obligatorios.';
  if (error) {
    return res.status(400).render('mensajes/nuevo', {
      titulo: 'Nuevo mensaje',
      destinatarios: permitidos,
      alumnos: alumnosParaMensaje(db, req.user),
      para,
      alumnoId,
      asunto,
      cuerpo,
      error,
    });
  }
  db.run(
    'INSERT INTO mensajes (remitente_id, destinatario_id, alumno_id, asunto, cuerpo) VALUES (?, ?, ?, ?, ?)',
    req.user.id,
    para,
    alumnoId,
    asunto,
    cuerpo,
  );
  req.flash('ok', 'Mensaje enviado.');
  res.redirect('/mensajes?carpeta=enviados');
});

router.get('/:id', (req, res, next) => {
  const m = req.db.get(
    `SELECT m.*, r.nombre AS rem_nombre, r.apellidos AS rem_apellidos, r.rol AS rem_rol,
            d.nombre AS dest_nombre, d.apellidos AS dest_apellidos, d.rol AS dest_rol,
            a.nombre AS alumno_nombre, a.apellidos AS alumno_apellidos
       FROM mensajes m JOIN usuarios r ON r.id = m.remitente_id JOIN usuarios d ON d.id = m.destinatario_id
       LEFT JOIN alumnos a ON a.id = m.alumno_id WHERE m.id = ?`,
    Number(req.params.id),
  );
  if (!m || (m.remitente_id !== req.user.id && m.destinatario_id !== req.user.id)) {
    return next(new HttpError(404, 'Mensaje no encontrado.'));
  }
  if (m.destinatario_id === req.user.id && !m.leido) {
    req.db.run('UPDATE mensajes SET leido = 1 WHERE id = ?', m.id);
    res.locals.noLeidos = Math.max(0, res.locals.noLeidos - 1);
  }
  const puedeResponder = destinatariosPermitidos(req.db, req.user).some((d) => d.id === m.remitente_id);
  res.render('mensajes/ver', { titulo: m.asunto, m, puedeResponder });
});

module.exports = router;
