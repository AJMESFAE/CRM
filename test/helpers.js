'use strict';

const request = require('supertest');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { seed, PASSWORD_DEMO } = require('../src/seed');

function crearEntorno() {
  const db = openDb(':memory:');
  seed(db);
  const app = createApp(db, { sessionSecret: 'test' });
  return { db, app };
}

function csrfDe(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m && m[1];
}

// Devuelve un agente autenticado con un método post() que añade el token CSRF
async function login(app, email, password = PASSWORD_DEMO) {
  const agent = request.agent(app);
  const pagina = await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ email, password, _csrf: csrfDe(pagina.text) });
  if (res.status !== 302) throw new Error(`Login fallido para ${email}: ${res.status}`);
  const panel = await agent.get('/');
  const token = csrfDe(panel.text);
  agent.enviar = (url, datos = {}) => agent.post(url).type('form').send({ _csrf: token, ...datos });
  return agent;
}

module.exports = { crearEntorno, login, csrfDe, PASSWORD_DEMO };
