'use strict';

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { requireRol } = require('../auth');
const { registrar } = require('../access');
const { texto, ROLES, HttpError } = require('../helpers');

const router = express.Router();
router.use(requireRol('direccion'));

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function leer(body) {
  return {
    rol: Object.keys(ROLES).includes(body.rol) ? body.rol : null,
    email: texto(body.email, 120).toLowerCase(),
    nombre: texto(body.nombre, 80),
    apellidos: texto(body.apellidos, 120),
    dni: texto(body.dni, 20),
    telefono: texto(body.telefono, 30),
    telefono_secundario: texto(body.telefono_secundario, 30),
    direccion: texto(body.direccion, 200),
    localidad: texto(body.localidad, 100),
    codigo_postal: texto(body.codigo_postal, 10),
    especialidad: texto(body.especialidad, 100),
    cargo: texto(body.cargo, 100),
    profesion: texto(body.profesion, 100),
  };
}

function validar(db, d, id = null) {
  const errores = [];
  if (!d.rol) errores.push('Selecciona un perfil.');
  if (!d.nombre || !d.apellidos) errores.push('Nombre y apellidos son obligatorios.');
  if (!EMAIL.test(d.email)) errores.push('El email no es válido.');
  else if (db.get('SELECT 1 FROM usuarios WHERE email = ? AND id IS NOT ?', d.email, id)) errores.push('Ya existe un usuario con ese email.');
  return errores;
}

function cargar(req, res, next) {
  const u = req.db.get('SELECT * FROM usuarios WHERE id = ?', Number(req.params.id));
  if (!u) return next(new HttpError(404, 'Usuario no encontrado.'));
  req.usuario = u;
  next();
}

router.get('/', (req, res) => {
  const rol = Object.keys(ROLES).includes(req.query.rol) ? req.query.rol : 'profesor';
  const q = texto(req.query.q, 100);
  const params = [rol];
  let filtro = '';
  if (q) {
    filtro = "AND (u.nombre || ' ' || u.apellidos LIKE ? OR u.email LIKE ? OR u.dni LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const usuarios = req.db.all(
    `SELECT u.*,
            (SELECT group_concat(c.nombre, ', ') FROM clases c WHERE c.tutor_id = u.id) AS tutorias,
            (SELECT COUNT(*) FROM clase_asignaturas ca WHERE ca.profesor_id = u.id) AS num_asignaturas,
            (SELECT group_concat(a.nombre || ' ' || a.apellidos, ', ') FROM alumno_tutores at
               JOIN alumnos a ON a.id = at.alumno_id WHERE at.tutor_id = u.id) AS hijos
       FROM usuarios u WHERE u.rol = ? ${filtro} ORDER BY u.activo DESC, u.apellidos, u.nombre`,
    ...params,
  );
  res.render('usuarios/lista', { titulo: 'Usuarios', usuarios, rol, q });
});

router.get('/nuevo', (req, res) => {
  const rol = Object.keys(ROLES).includes(req.query.rol) ? req.query.rol : 'profesor';
  res.render('usuarios/form', { titulo: 'Nuevo usuario', usuario: { rol }, errores: [] });
});

router.post('/', (req, res) => {
  const d = leer(req.body);
  const errores = validar(req.db, d);
  if (errores.length) return res.status(400).render('usuarios/form', { titulo: 'Nuevo usuario', usuario: d, errores });
  const password = crypto.randomBytes(6).toString('base64url');
  const cols = Object.keys(d);
  const r = req.db.run(
    `INSERT INTO usuarios (${cols.join(', ')}, password_hash) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
    ...cols.map((c) => d[c]),
    bcrypt.hashSync(password, 10),
  );
  registrar(req.db, req.user.id, 'crear_usuario', 'usuario', Number(r.lastInsertRowid));
  req.flash('ok', `Usuario creado. Contraseña temporal: ${password} (comunícala de forma segura; podrá cambiarla en "Mi perfil").`);
  res.redirect(`/usuarios/${r.lastInsertRowid}`);
});

router.get('/:id', cargar, (req, res) => {
  const db = req.db;
  const u = req.usuario;
  const tutorias = db.all('SELECT id, nombre, curso_academico FROM clases WHERE tutor_id = ? ORDER BY nombre', u.id);
  const imparte = db.all(
    `SELECT c.id AS clase_id, c.nombre AS clase, s.nombre AS asignatura, ca.horas_semana
       FROM clase_asignaturas ca JOIN clases c ON c.id = ca.clase_id JOIN asignaturas s ON s.id = ca.asignatura_id
      WHERE ca.profesor_id = ? ORDER BY c.nombre, s.nombre`,
    u.id,
  );
  const hijos = db.all(
    `SELECT a.id, a.nombre, a.apellidos, c.nombre AS clase, at.parentesco
       FROM alumno_tutores at JOIN alumnos a ON a.id = at.alumno_id LEFT JOIN clases c ON c.id = a.clase_id
      WHERE at.tutor_id = ? ORDER BY a.nombre`,
    u.id,
  );
  const actividad = db.all(
    'SELECT * FROM registro_actividad WHERE usuario_id = ? ORDER BY id DESC LIMIT 15',
    u.id,
  );
  res.render('usuarios/detalle', { titulo: `${u.nombre} ${u.apellidos}`, usuario: u, tutorias, imparte, hijos, actividad });
});

router.get('/:id/editar', cargar, (req, res) => {
  res.render('usuarios/form', { titulo: 'Editar usuario', usuario: req.usuario, errores: [] });
});

router.post('/:id', cargar, (req, res) => {
  const d = leer(req.body);
  // El perfil no se cambia desde la edición para no romper relaciones existentes
  d.rol = req.usuario.rol;
  const errores = validar(req.db, d, req.usuario.id);
  if (errores.length) {
    return res.status(400).render('usuarios/form', { titulo: 'Editar usuario', usuario: { ...d, id: req.usuario.id }, errores });
  }
  delete d.rol;
  const cols = Object.keys(d);
  req.db.run(`UPDATE usuarios SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => d[c]), req.usuario.id);
  registrar(req.db, req.user.id, 'editar_usuario', 'usuario', req.usuario.id);
  req.flash('ok', 'Usuario actualizado.');
  res.redirect(`/usuarios/${req.usuario.id}`);
});

router.post('/:id/estado', cargar, (req, res) => {
  if (req.usuario.id === req.user.id) {
    req.flash('error', 'No puedes desactivar tu propio usuario.');
    return res.redirect(`/usuarios/${req.usuario.id}`);
  }
  const activo = req.usuario.activo ? 0 : 1;
  req.db.run('UPDATE usuarios SET activo = ? WHERE id = ?', activo, req.usuario.id);
  registrar(req.db, req.user.id, activo ? 'activar_usuario' : 'desactivar_usuario', 'usuario', req.usuario.id);
  req.flash('ok', activo ? 'Usuario activado.' : 'Usuario desactivado: ya no podrá acceder.');
  res.redirect(`/usuarios/${req.usuario.id}`);
});

router.post('/:id/password', cargar, (req, res) => {
  const password = crypto.randomBytes(6).toString('base64url');
  req.db.run('UPDATE usuarios SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), req.usuario.id);
  registrar(req.db, req.user.id, 'restablecer_password', 'usuario', req.usuario.id);
  req.flash('ok', `Nueva contraseña temporal: ${password}`);
  res.redirect(`/usuarios/${req.usuario.id}`);
});

module.exports = router;
