'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const request = require('supertest');
const { crearEntorno } = require('./helpers');
const { ipCliente } = require('../src/routes/auth');
const { crearCopia, copiaSiToca, listarCopias, purgarCopias } = require('../src/backup');
const { openDb } = require('../src/db');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));

describe('preparación para Azure App Service', () => {
  test('/healthz responde sin autenticación y sin crear sesión', async () => {
    const { app } = crearEntorno();
    const res = await request(app).get('/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { estado: 'ok' });
    assert.equal(res.headers['set-cookie'], undefined);
  });

  test('la IP del cliente ignora el puerto que añade el proxy de Azure', () => {
    assert.equal(ipCliente({ ip: '203.0.113.5:51234' }), '203.0.113.5');
    assert.equal(ipCliente({ ip: '203.0.113.5' }), '203.0.113.5');
    assert.equal(ipCliente({ ip: '[2001:db8::1]:443' }), '2001:db8::1');
    assert.equal(ipCliente({ ip: '::ffff:127.0.0.1' }), '::ffff:127.0.0.1');
  });

  test('el bloqueo por intentos fallidos funciona aunque cambie el puerto de origen', async () => {
    process.env.TRUST_PROXY = '1';
    const { app } = crearEntorno();
    delete process.env.TRUST_PROXY;
    const agent = request.agent(app);
    const csrf = (await agent.get('/login')).text.match(/name="_csrf" value="([^"]+)"/)[1];
    let ultimo;
    for (let i = 0; i < 6; i++) {
      ultimo = await agent
        .post('/login')
        .set('X-Forwarded-For', `198.51.100.7:${40000 + i}`)
        .type('form')
        .send({ email: 'bloqueo@colegio.local', password: 'x', _csrf: csrf });
    }
    assert.equal(ultimo.status, 429);
  });

  test('modo de journal configurable (DELETE para el almacenamiento de Azure)', () => {
    const dir = tmp();
    process.env.SQLITE_JOURNAL_MODE = 'DELETE';
    const db = openDb(path.join(dir, 'a.db'));
    delete process.env.SQLITE_JOURNAL_MODE;
    assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'delete');
    db.close();
    process.env.SQLITE_JOURNAL_MODE = 'MEMORY; DROP TABLE x';
    assert.throws(() => openDb(path.join(dir, 'b.db')), /no válido/);
    delete process.env.SQLITE_JOURNAL_MODE;
  });
});

describe('copias de seguridad', () => {
  test('crea copias consistentes, respeta el intervalo y purga las antiguas', () => {
    const dir = tmp();
    const db = openDb(path.join(dir, 'colegio.db'));
    db.run("INSERT INTO asignaturas (nombre) VALUES ('Música')");

    const primera = copiaSiToca(db, { dir: path.join(dir, 'copias'), intervaloHoras: 24, diasRetencion: 14 });
    assert.ok(primera.creada);
    const copia = openDb(primera.creada);
    assert.equal(copia.get('SELECT nombre FROM asignaturas').nombre, 'Música');
    copia.close();

    // Dentro del intervalo no se crea otra
    assert.equal(copiaSiToca(db, { dir: path.join(dir, 'copias'), intervaloHoras: 24 }).creada, null);

    // Las copias antiguas se eliminan, pero nunca la más reciente
    const vieja = crearCopia(db, path.join(dir, 'copias'));
    const hace20dias = new Date(Date.now() - 20 * 86400000);
    fs.utimesSync(vieja, hace20dias, hace20dias);
    fs.utimesSync(primera.creada, hace20dias, hace20dias);
    const reciente = crearCopia(db, path.join(dir, 'copias'));
    assert.equal(purgarCopias(path.join(dir, 'copias'), 14), 2);
    assert.deepEqual(listarCopias(path.join(dir, 'copias')).map((c) => c.fichero), [reciente]);
    db.close();
  });
});

function arrancar(env) {
  return new Promise((resolve) => {
    const hijo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { PATH: process.env.PATH, ...env },
    });
    let salida = '';
    hijo.stdout.on('data', (d) => {
      salida += d;
      if (salida.includes('escuchando')) resolve({ hijo, salida: () => salida });
    });
    hijo.stderr.on('data', (d) => (salida += d));
    hijo.on('exit', (code) => resolve({ code, salida: () => salida }));
  });
}

describe('arranque en producción', () => {
  test('exige SESSION_SECRET', async () => {
    const r = await arrancar({ NODE_ENV: 'production', DB_PATH: path.join(tmp(), 'x.db') });
    assert.equal(r.code, 1);
    assert.match(r.salida(), /SESSION_SECRET/);
  });

  test('exige ADMIN_PASSWORD con la base de datos vacía (no escribe contraseñas en los logs)', async () => {
    const r = await arrancar({ NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(40), DB_PATH: path.join(tmp(), 'x.db') });
    assert.equal(r.code, 1);
    assert.match(r.salida(), /ADMIN_PASSWORD/);
  });

  test('arranca con la configuración de Azure, crea la copia inicial y se detiene con SIGTERM', async () => {
    const dir = tmp();
    const port = String(40000 + Math.floor(Math.random() * 10000));
    const r = await arrancar({
      NODE_ENV: 'production',
      SESSION_SECRET: 's'.repeat(40),
      ADMIN_EMAIL: 'admin@colegio.es',
      ADMIN_PASSWORD: 'Contraseña-segura-1',
      DB_PATH: path.join(dir, 'data', 'colegio.db'),
      SQLITE_JOURNAL_MODE: 'DELETE',
      BACKUP_DIR: path.join(dir, 'data', 'backups'),
      TRUST_PROXY: '1',
      COOKIE_SECURE: '1',
      PORT: port,
    });
    assert.ok(r.hijo, r.salida());
    assert.doesNotMatch(r.salida(), /Contraseña-segura-1/);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(listarCopias(path.join(dir, 'data', 'backups')).length, 1);
    const fin = new Promise((resolve) => r.hijo.on('exit', resolve));
    r.hijo.kill('SIGTERM');
    assert.equal(await fin, 0);
  });
});
