'use strict';

const session = require('express-session');

// Almacén de sesiones persistente en SQLite
class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.limpiar = setInterval(() => this.db.run('DELETE FROM sesiones WHERE expira < ?', Date.now()), 15 * 60 * 1000);
    this.limpiar.unref();
  }

  expiracion(sess) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
    return exp;
  }

  get(sid, cb) {
    try {
      const row = this.db.get('SELECT datos, expira FROM sesiones WHERE sid = ?', sid);
      if (!row || row.expira < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.datos));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.db.run(
        `INSERT INTO sesiones (sid, datos, expira) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET datos = excluded.datos, expira = excluded.expira`,
        sid,
        JSON.stringify(sess),
        this.expiracion(sess),
      );
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.run('DELETE FROM sesiones WHERE sid = ?', sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.db.run('UPDATE sesiones SET expira = ? WHERE sid = ?', this.expiracion(sess), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteStore;
