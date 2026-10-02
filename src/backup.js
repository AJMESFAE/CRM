'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Copias de seguridad consistentes de la base de datos con VACUUM INTO.
// Copiar el fichero .db "en caliente" (como hacen las copias automáticas de la plataforma)
// puede capturar una escritura a medias; estas instantáneas siempre son coherentes.

const PREFIJO = 'colegio-';
const DIA = 24 * 60 * 60 * 1000;

function listarCopias(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIJO) && f.endsWith('.db'))
    .map((f) => ({ fichero: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function crearCopia(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(dir, `${PREFIJO}${marca}.db`);
  db.raw.prepare('VACUUM INTO ?').run(destino);
  return destino;
}

function purgarCopias(dir, diasRetencion) {
  const limite = Date.now() - diasRetencion * DIA;
  const copias = listarCopias(dir);
  let borradas = 0;
  // Se conserva siempre al menos la copia más reciente
  for (const c of copias.slice(1)) {
    if (c.mtime < limite) {
      fs.unlinkSync(c.fichero);
      borradas++;
    }
  }
  return borradas;
}

// Hace una copia si la última tiene más de `intervaloHoras`, y purga las antiguas
function copiaSiToca(db, { dir, intervaloHoras = 24, diasRetencion = 14 }) {
  const ultima = listarCopias(dir)[0];
  let creada = null;
  if (!ultima || Date.now() - ultima.mtime >= intervaloHoras * 60 * 60 * 1000) creada = crearCopia(db, dir);
  const borradas = purgarCopias(dir, diasRetencion);
  return { creada, borradas };
}

function programarCopias(db, opciones, log = console) {
  const ejecutar = () => {
    try {
      const { creada, borradas } = copiaSiToca(db, opciones);
      if (creada) log.log(`Copia de seguridad creada: ${creada}${borradas ? ` (${borradas} antiguas eliminadas)` : ''}`);
    } catch (err) {
      log.error('Error al crear la copia de seguridad:', err.message);
    }
  };
  ejecutar();
  const t = setInterval(ejecutar, 60 * 60 * 1000);
  t.unref();
  return t;
}

module.exports = { crearCopia, purgarCopias, copiaSiToca, listarCopias, programarCopias };

// Uso manual (p. ej. por SSH en App Service): node src/backup.js
if (require.main === module) {
  const { openDb } = require('./db');
  const dir = process.env.BACKUP_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'colegio.db')), 'backups');
  const db = openDb();
  console.log(`Copia creada: ${crearCopia(db, dir)}`);
  db.close();
}
