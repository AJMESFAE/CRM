'use strict';

// Reglas de acceso por perfil.
//  - Dirección: acceso completo.
//  - Profesor: alumnos de las clases de las que es tutor o en las que imparte alguna asignatura.
//  - Padre/tutor legal: únicamente sus hijos/tutelados.

function alumnoIdsVisibles(db, user) {
  if (user.rol === 'direccion') {
    return db.all('SELECT id FROM alumnos').map((r) => r.id);
  }
  if (user.rol === 'profesor') {
    return db
      .all(
        `SELECT a.id FROM alumnos a
          WHERE a.clase_id IN (${claseIdsProfesorSql})`,
        user.id,
        user.id,
      )
      .map((r) => r.id);
  }
  return db.all('SELECT alumno_id AS id FROM alumno_tutores WHERE tutor_id = ?', user.id).map((r) => r.id);
}

const claseIdsProfesorSql = `
  SELECT id FROM clases WHERE tutor_id = ?
  UNION
  SELECT clase_id FROM clase_asignaturas WHERE profesor_id = ?`;

function claseIdsProfesor(db, profesorId) {
  return db.all(claseIdsProfesorSql, profesorId, profesorId).map((r) => r.id);
}

function puedeVerAlumno(db, user, alumnoId) {
  if (user.rol === 'direccion') return true;
  if (user.rol === 'profesor') {
    return !!db.get(
      `SELECT 1 FROM alumnos WHERE id = ? AND clase_id IN (${claseIdsProfesorSql})`,
      alumnoId,
      user.id,
      user.id,
    );
  }
  return !!db.get('SELECT 1 FROM alumno_tutores WHERE alumno_id = ? AND tutor_id = ?', alumnoId, user.id);
}

function puedeVerClase(db, user, claseId) {
  if (user.rol === 'direccion') return true;
  if (user.rol === 'profesor') return claseIdsProfesor(db, user.id).includes(Number(claseId));
  return false;
}

// Pasar lista: tutor del grupo o cualquier profesor que imparta clase en el grupo
const puedePasarLista = puedeVerClase;

// Poner notas: el profesor que imparte esa asignatura en ese grupo
function puedeCalificar(db, user, claseId, asignaturaId) {
  if (user.rol === 'direccion') return true;
  if (user.rol !== 'profesor') return false;
  return !!db.get(
    'SELECT 1 FROM clase_asignaturas WHERE clase_id = ? AND asignatura_id = ? AND profesor_id = ?',
    claseId,
    asignaturaId,
    user.id,
  );
}

// Combinaciones clase/asignatura que un usuario puede calificar
function asignacionesCalificables(db, user) {
  const base = `SELECT ca.id, ca.clase_id, ca.asignatura_id, c.nombre AS clase, s.nombre AS asignatura,
                       u.nombre || ' ' || u.apellidos AS profesor
                  FROM clase_asignaturas ca
                  JOIN clases c ON c.id = ca.clase_id
                  JOIN asignaturas s ON s.id = ca.asignatura_id
                  LEFT JOIN usuarios u ON u.id = ca.profesor_id`;
  if (user.rol === 'direccion') return db.all(`${base} ORDER BY c.nombre, s.nombre`);
  if (user.rol === 'profesor') return db.all(`${base} WHERE ca.profesor_id = ? ORDER BY c.nombre, s.nombre`, user.id);
  return [];
}

// Usuarios a los que se puede escribir un mensaje
function destinatariosPermitidos(db, user) {
  const cols = `u.id, u.nombre, u.apellidos, u.rol`;
  if (user.rol === 'direccion') {
    return db.all(`SELECT ${cols} FROM usuarios u WHERE u.activo = 1 AND u.id != ? ORDER BY u.rol, u.apellidos`, user.id);
  }
  if (user.rol === 'profesor') {
    return db.all(
      `SELECT ${cols} FROM usuarios u
        WHERE u.activo = 1 AND u.id != ? AND (
          u.rol IN ('direccion', 'profesor')
          OR u.id IN (SELECT at.tutor_id FROM alumno_tutores at
                        JOIN alumnos a ON a.id = at.alumno_id
                       WHERE a.clase_id IN (${claseIdsProfesorSql})))
        ORDER BY u.rol, u.apellidos`,
      user.id,
      user.id,
      user.id,
    );
  }
  // Familias: dirección y profesorado de las clases de sus hijos
  return db.all(
    `SELECT ${cols} FROM usuarios u
      WHERE u.activo = 1 AND (
        u.rol = 'direccion'
        OR u.id IN (
          SELECT c.tutor_id FROM clases c JOIN alumnos a ON a.clase_id = c.id
            JOIN alumno_tutores at ON at.alumno_id = a.id WHERE at.tutor_id = ?
          UNION
          SELECT ca.profesor_id FROM clase_asignaturas ca JOIN alumnos a ON a.clase_id = ca.clase_id
            JOIN alumno_tutores at ON at.alumno_id = a.id WHERE at.tutor_id = ?))
      ORDER BY u.rol, u.apellidos`,
    user.id,
    user.id,
  );
}

function registrar(db, usuarioId, accion, entidad = null, entidadId = null) {
  db.run(
    'INSERT INTO registro_actividad (usuario_id, accion, entidad, entidad_id) VALUES (?, ?, ?, ?)',
    usuarioId,
    accion,
    entidad,
    entidadId,
  );
}

module.exports = {
  alumnoIdsVisibles,
  claseIdsProfesor,
  puedeVerAlumno,
  puedeVerClase,
  puedePasarLista,
  puedeCalificar,
  asignacionesCalificables,
  destinatariosPermitidos,
  registrar,
};
