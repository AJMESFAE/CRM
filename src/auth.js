'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('./helpers');

// Carga el usuario de la sesión en req.user
function cargarUsuario(req, res, next) {
  const id = req.session.userId;
  if (id) {
    const user = req.db.get(
      'SELECT id, email, rol, nombre, apellidos, activo FROM usuarios WHERE id = ?',
      id,
    );
    if (user && user.activo) {
      req.user = user;
      res.locals.user = user;
      res.locals.noLeidos = req.db.get(
        'SELECT COUNT(*) AS n FROM mensajes WHERE destinatario_id = ? AND leido = 0',
        user.id,
      ).n;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.rol)) return next(new HttpError(403, 'No tienes permiso para acceder a esta sección.'));
    next();
  };
}

// Protección CSRF basada en token de sesión
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
    const a = Buffer.from(String(token || ''));
    const b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return next(new HttpError(403, 'La sesión ha caducado o el formulario no es válido. Vuelve a intentarlo.'));
    }
  }
  next();
}

module.exports = { cargarUsuario, requireLogin, requireRol, csrf };
