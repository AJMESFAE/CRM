'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { programarCopias } = require('./backup');

const produccion = process.env.NODE_ENV === 'production';
if (produccion && !process.env.SESSION_SECRET) {
  console.error('Error: en producción es obligatorio definir SESSION_SECRET.');
  process.exit(1);
}

const db = openDb();

// Primer arranque: crear un usuario de Dirección si no existe ninguno
if (!db.get('SELECT 1 FROM usuarios LIMIT 1')) {
  // En producción no se genera una contraseña aleatoria: quedaría escrita en los logs
  if (produccion && !process.env.ADMIN_PASSWORD) {
    console.error('Error: base de datos vacía. Define ADMIN_EMAIL y ADMIN_PASSWORD para crear el usuario de Dirección.');
    process.exit(1);
  }
  const email = process.env.ADMIN_EMAIL || 'direccion@colegio.mezquitacentral.org';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.run(
    "INSERT INTO usuarios (email, password_hash, rol, nombre, apellidos, cargo) VALUES (?, ?, 'direccion', 'Administrador', 'Dirección', 'Director/a')",
    email,
    bcrypt.hashSync(password, 10),
  );
  console.log('Base de datos vacía: se ha creado el usuario de Dirección');
  console.log(`  email:      ${email}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`  contraseña: ${password}  (cámbiala tras el primer acceso)`);
}

if (process.env.BACKUP_DIR) {
  programarCopias(db, {
    dir: process.env.BACKUP_DIR,
    intervaloHoras: Number(process.env.BACKUP_INTERVAL_HOURS) || 24,
    diasRetencion: Number(process.env.BACKUP_RETENTION_DAYS) || 14,
  });
}

if (!process.env.SESSION_SECRET) {
  console.warn('Aviso: SESSION_SECRET no definido; las sesiones se invalidarán al reiniciar.');
}

const port = Number(process.env.PORT) || 3000;
const server = createApp(db).listen(port, () => {
  console.log(`CRM escolar escuchando en el puerto ${port}`);
});

// Cierre ordenado (reinicios y despliegues en Azure envían SIGTERM)
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
