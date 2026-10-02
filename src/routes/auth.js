'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { registrar } = require('../access');

const router = express.Router();

// Contraseña ficticia para igualar tiempos cuando el email no existe
const HASH_FALSO = bcrypt.hashSync('no-existe', 10);
const intentos = new Map();

// Azure App Service añade el puerto de origen a X-Forwarded-For ("1.2.3.4:51234");
// sin quitarlo, cada petición tendría una clave distinta y el bloqueo no funcionaría.
function ipCliente(req) {
  const ip = String(req.ip || '');
  const v4 = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4) return v4[1];
  const v6 = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  return v6 ? v6[1] : ip;
}

// Purga periódica de intentos antiguos
setInterval(() => {
  const limite = Date.now() - 15 * 60 * 1000;
  for (const [k, r] of intentos) if (r.t < limite) intentos.delete(k);
}, 10 * 60 * 1000).unref();

function bloqueado(clave) {
  const r = intentos.get(clave);
  return r && r.n >= 5 && Date.now() - r.t < 15 * 60 * 1000;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { titulo: 'Acceso', email: '', error: null, next: req.query.next || '' });
});

router.post('/login', (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const destino = typeof req.body.next === 'string' && /^\/(?!\/)/.test(req.body.next) ? req.body.next : '/';
  const clave = `${ipCliente(req)}|${email}`;

  if (bloqueado(clave)) {
    return res.status(429).render('login', {
      titulo: 'Acceso',
      email,
      next: req.body.next || '',
      error: 'Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentarlo.',
    });
  }

  const user = req.db.get('SELECT id, password_hash, activo FROM usuarios WHERE email = ?', email);
  const ok = bcrypt.compareSync(password, user ? user.password_hash : HASH_FALSO);
  if (!user || !ok || !user.activo) {
    const r = intentos.get(clave) || { n: 0, t: Date.now() };
    intentos.set(clave, { n: r.n + 1, t: Date.now() });
    return res.status(401).render('login', {
      titulo: 'Acceso',
      email,
      next: req.body.next || '',
      error: 'Email o contraseña incorrectos.',
    });
  }
  intentos.delete(clave);

  // Regenerar la sesión para evitar fijación de sesión
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.db.run("UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?", user.id);
    registrar(req.db, user.id, 'login');
    req.session.save(() => res.redirect(destino));
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('crm.sid');
    res.redirect('/login');
  });
});

module.exports = router;
module.exports.ipCliente = ipCliente;
