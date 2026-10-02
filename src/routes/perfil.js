'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { texto } = require('../helpers');
const { registrar } = require('../access');

const router = express.Router();

router.get('/', (req, res) => {
  const perfil = req.db.get('SELECT * FROM usuarios WHERE id = ?', req.user.id);
  res.render('perfil', { titulo: 'Mi perfil', perfil, error: null });
});

// Cada usuario puede mantener actualizados sus datos de contacto
router.post('/', (req, res) => {
  const b = req.body;
  req.db.run(
    `UPDATE usuarios SET telefono = ?, telefono_secundario = ?, direccion = ?, localidad = ?, codigo_postal = ?,
            profesion = CASE WHEN rol = 'tutor' THEN ? ELSE profesion END
      WHERE id = ?`,
    texto(b.telefono, 30),
    texto(b.telefono_secundario, 30),
    texto(b.direccion, 200),
    texto(b.localidad, 100),
    texto(b.codigo_postal, 10),
    texto(b.profesion, 100),
    req.user.id,
  );
  registrar(req.db, req.user.id, 'actualizar_perfil', 'usuario', req.user.id);
  req.flash('ok', 'Datos de contacto actualizados.');
  res.redirect('/perfil');
});

router.post('/password', (req, res) => {
  const { actual, nueva, repetir } = req.body;
  const u = req.db.get('SELECT password_hash FROM usuarios WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(String(actual || ''), u.password_hash)) {
    req.flash('error', 'La contraseña actual no es correcta.');
    return res.redirect('/perfil');
  }
  if (typeof nueva !== 'string' || nueva.length < 8) {
    req.flash('error', 'La nueva contraseña debe tener al menos 8 caracteres.');
    return res.redirect('/perfil');
  }
  if (nueva !== repetir) {
    req.flash('error', 'Las contraseñas no coinciden.');
    return res.redirect('/perfil');
  }
  req.db.run('UPDATE usuarios SET password_hash = ? WHERE id = ?', bcrypt.hashSync(nueva, 10), req.user.id);
  registrar(req.db, req.user.id, 'cambiar_password', 'usuario', req.user.id);
  req.flash('ok', 'Contraseña cambiada correctamente.');
  res.redirect('/perfil');
});

module.exports = router;
