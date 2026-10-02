'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('./session-store');
const helpers = require('./helpers');
const { cargarUsuario, requireLogin, csrf } = require('./auth');

function createApp(db, opciones = {}) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));

  app.use(
    session({
      name: 'crm.sid',
      secret: opciones.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      store: new SqliteStore(db),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === '1',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );

  app.use((req, res, next) => {
    req.db = db;
    res.locals.h = helpers;
    res.locals.user = null;
    res.locals.noLeidos = 0;
    res.locals.ruta = req.path;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    req.flash = (tipo, mensaje) => {
      req.session.flash = { tipo, mensaje };
    };
    next();
  });
  app.use(csrf);
  app.use(cargarUsuario);

  app.use(require('./routes/auth'));
  app.use(requireLogin);
  app.use(require('./routes/dashboard'));
  app.use('/alumnos', require('./routes/alumnos'));
  app.use('/clases', require('./routes/clases'));
  app.use('/usuarios', require('./routes/usuarios'));
  app.use('/asistencia', require('./routes/asistencia'));
  app.use('/notas', require('./routes/notas'));
  app.use('/seguimiento', require('./routes/seguimiento'));
  app.use('/mensajes', require('./routes/mensajes'));
  app.use('/informes', require('./routes/informes'));
  app.use('/perfil', require('./routes/perfil'));

  app.use((req, res) => {
    res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'La página solicitada no existe.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).render('error', {
      titulo: status === 403 ? 'Acceso denegado' : status === 404 ? 'No encontrado' : 'Error',
      mensaje: status >= 500 ? 'Se ha producido un error inesperado.' : err.message,
    });
  });

  return app;
}

module.exports = { createApp };
