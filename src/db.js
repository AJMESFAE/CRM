'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// node:sqlite no acepta undefined ni booleanos como parámetros
function normalizar(params) {
  return params.map((p) => {
    if (p === undefined || p === '') return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

function openDb(dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'colegio.db')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') {
    // WAL necesita memoria compartida y no funciona en sistemas de ficheros de red
    // (p. ej. /home en Azure App Service, montado sobre Azure Storage): ahí usar DELETE.
    const modo = String(process.env.SQLITE_JOURNAL_MODE || 'WAL').toUpperCase();
    if (!['WAL', 'DELETE', 'TRUNCATE'].includes(modo)) throw new Error(`SQLITE_JOURNAL_MODE no válido: ${modo}`);
    raw.exec(`PRAGMA journal_mode = ${modo};`);
  }
  raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const db = {
    raw,
    get: (sql, ...params) => raw.prepare(sql).get(...normalizar(params)),
    all: (sql, ...params) => raw.prepare(sql).all(...normalizar(params)),
    run: (sql, ...params) => raw.prepare(sql).run(...normalizar(params)),
    exec: (sql) => raw.exec(sql),
    tx(fn) {
      raw.exec('BEGIN');
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => raw.close(),
  };
  return db;
}

module.exports = { openDb };
