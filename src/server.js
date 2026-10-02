'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const { createApp } = require('./app');

const db = openDb();

// Primer arranque: crear un usuario de Dirección si no existe ninguno
if (!db.get('SELECT 1 FROM usuarios LIMIT 1')) {
  const email = process.env.ADMIN_EMAIL || 'direccion@colegio.local';
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

if (!process.env.SESSION_SECRET) {
  console.warn('Aviso: SESSION_SECRET no definido; las sesiones se invalidarán al reiniciar.');
}

const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => {
  console.log(`CRM escolar escuchando en http://localhost:${port}`);
});
