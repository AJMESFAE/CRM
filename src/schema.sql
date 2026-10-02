-- Esquema del CRM escolar
PRAGMA foreign_keys = ON;

-- Usuarios de la aplicación: Dirección, Profesorado y Padres/Tutores legales
CREATE TABLE IF NOT EXISTS usuarios (
  id               INTEGER PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash    TEXT NOT NULL,
  rol              TEXT NOT NULL CHECK (rol IN ('direccion', 'profesor', 'tutor')),
  nombre           TEXT NOT NULL,
  apellidos        TEXT NOT NULL,
  dni              TEXT,
  telefono         TEXT,
  telefono_secundario TEXT,
  direccion        TEXT,
  localidad        TEXT,
  codigo_postal    TEXT,
  -- Profesorado
  especialidad     TEXT,
  cargo            TEXT,
  -- Padres / tutores legales
  profesion        TEXT,
  activo           INTEGER NOT NULL DEFAULT 1,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_acceso    TEXT
);

-- Grupos / clases de un curso académico
CREATE TABLE IF NOT EXISTS clases (
  id               INTEGER PRIMARY KEY,
  nombre           TEXT NOT NULL,
  etapa            TEXT NOT NULL CHECK (etapa IN ('Infantil', 'Primaria', 'ESO', 'Bachillerato', 'FP')),
  nivel            TEXT NOT NULL,
  grupo            TEXT NOT NULL,
  curso_academico  TEXT NOT NULL,
  aula             TEXT,
  tutor_id         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (curso_academico, nombre)
);

CREATE TABLE IF NOT EXISTS asignaturas (
  id               INTEGER PRIMARY KEY,
  nombre           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  codigo           TEXT
);

-- Qué asignaturas se imparten en cada clase y qué profesor las imparte
CREATE TABLE IF NOT EXISTS clase_asignaturas (
  id               INTEGER PRIMARY KEY,
  clase_id         INTEGER NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  asignatura_id    INTEGER NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
  profesor_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  horas_semana     INTEGER,
  UNIQUE (clase_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS alumnos (
  id                     INTEGER PRIMARY KEY,
  numero_expediente      TEXT NOT NULL UNIQUE,
  nombre                 TEXT NOT NULL,
  apellidos              TEXT NOT NULL,
  fecha_nacimiento       TEXT NOT NULL,
  sexo                   TEXT CHECK (sexo IN ('M', 'F', 'X') OR sexo IS NULL),
  dni_nie                TEXT,
  nacionalidad           TEXT,
  direccion              TEXT,
  localidad              TEXT,
  codigo_postal          TEXT,
  clase_id               INTEGER REFERENCES clases(id) ON DELETE SET NULL,
  fecha_matricula        TEXT,
  -- Datos de salud y necesidades
  alergias               TEXT,
  condiciones_medicas    TEXT,
  medicacion             TEXT,
  necesidades_educativas TEXT,
  observaciones          TEXT,
  -- Autorizaciones y consentimientos (RGPD)
  autorizacion_imagenes  INTEGER NOT NULL DEFAULT 0,
  autorizacion_salidas   INTEGER NOT NULL DEFAULT 0,
  consentimiento_datos   INTEGER NOT NULL DEFAULT 0,
  activo                 INTEGER NOT NULL DEFAULT 1,
  creado_en              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Relación alumno <-> padres/tutores legales
CREATE TABLE IF NOT EXISTS alumno_tutores (
  alumno_id            INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  tutor_id             INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  parentesco           TEXT NOT NULL,
  contacto_principal   INTEGER NOT NULL DEFAULT 0,
  custodia             INTEGER NOT NULL DEFAULT 1,
  autorizado_recogida  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (alumno_id, tutor_id)
);

-- Contactos de emergencia y personas autorizadas a recoger al alumno
CREATE TABLE IF NOT EXISTS contactos_emergencia (
  id                   INTEGER PRIMARY KEY,
  alumno_id            INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  nombre               TEXT NOT NULL,
  parentesco           TEXT,
  telefono             TEXT NOT NULL,
  autorizado_recogida  INTEGER NOT NULL DEFAULT 0
);

-- Asistencia diaria
CREATE TABLE IF NOT EXISTS asistencia (
  id                   INTEGER PRIMARY KEY,
  alumno_id            INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  fecha                TEXT NOT NULL,
  estado               TEXT NOT NULL CHECK (estado IN ('presente', 'ausente', 'retraso', 'justificada')),
  observacion          TEXT,
  -- Motivo aportado por la familia (pendiente de revisión si el estado sigue en ausente/retraso)
  motivo_familia       TEXT,
  motivo_familia_en    TEXT,
  registrado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (alumno_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_asistencia_fecha ON asistencia(fecha);

-- Calificaciones
CREATE TABLE IF NOT EXISTS notas (
  id                   INTEGER PRIMARY KEY,
  alumno_id            INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  asignatura_id        INTEGER NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
  trimestre            INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 3),
  tipo                 TEXT NOT NULL CHECK (tipo IN ('examen', 'trabajo', 'deberes', 'actitud', 'oral', 'final')),
  descripcion          TEXT NOT NULL,
  nota                 REAL NOT NULL CHECK (nota >= 0 AND nota <= 10),
  peso                 REAL NOT NULL DEFAULT 1 CHECK (peso > 0),
  fecha                TEXT NOT NULL,
  comentario           TEXT,
  profesor_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notas_alumno ON notas(alumno_id, asignatura_id, trimestre);

-- Seguimiento: observaciones, incidencias, tutorías...
CREATE TABLE IF NOT EXISTS seguimiento (
  id                   INTEGER PRIMARY KEY,
  alumno_id            INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  fecha                TEXT NOT NULL,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('academico', 'conducta', 'salud', 'tutoria', 'positivo', 'otro')),
  titulo               TEXT NOT NULL,
  descripcion          TEXT NOT NULL,
  visible_familia      INTEGER NOT NULL DEFAULT 1,
  autor_id             INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mensajería interna familia <-> centro
CREATE TABLE IF NOT EXISTS mensajes (
  id                   INTEGER PRIMARY KEY,
  remitente_id         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  destinatario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  alumno_id            INTEGER REFERENCES alumnos(id) ON DELETE SET NULL,
  asunto               TEXT NOT NULL,
  cuerpo               TEXT NOT NULL,
  leido                INTEGER NOT NULL DEFAULT 0,
  creado_en            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registro de actividad (trazabilidad de accesos a datos personales)
CREATE TABLE IF NOT EXISTS registro_actividad (
  id                   INTEGER PRIMARY KEY,
  usuario_id           INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion               TEXT NOT NULL,
  entidad              TEXT,
  entidad_id           INTEGER,
  creado_en            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  sid                  TEXT PRIMARY KEY,
  datos                TEXT NOT NULL,
  expira               INTEGER NOT NULL
);
