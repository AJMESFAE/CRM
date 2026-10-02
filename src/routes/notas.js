'use strict';

const express = require('express');
const { requireRol } = require('../auth');
const { asignacionesCalificables, puedeCalificar, registrar } = require('../access');
const { esFecha, hoy, texto, media, trimestreActual, TIPOS_NOTA, HttpError } = require('../helpers');

const router = express.Router();
router.use(requireRol('direccion', 'profesor'));

function leerNota(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 100) / 100 : NaN;
}

function cargarAsignacion(req, id) {
  const ca = req.db.get(
    `SELECT ca.*, c.nombre AS clase, s.nombre AS asignatura FROM clase_asignaturas ca
       JOIN clases c ON c.id = ca.clase_id JOIN asignaturas s ON s.id = ca.asignatura_id WHERE ca.id = ?`,
    id,
  );
  if (!ca) throw new HttpError(404, 'Asignatura no encontrada en esa clase.');
  if (!puedeCalificar(req.db, req.user, ca.clase_id, ca.asignatura_id)) {
    throw new HttpError(403, 'Solo el profesor que imparte la asignatura puede calificar.');
  }
  return ca;
}

const claveEval = (n) => `${n.tipo}|${n.descripcion}|${n.fecha}|${n.peso}`;

router.get('/', (req, res) => {
  const db = req.db;
  const asignaciones = asignacionesCalificables(db, req.user);
  const caId = req.query.asignacion ? Number(req.query.asignacion) : asignaciones.length === 1 ? asignaciones[0].id : null;
  const trimestre = [1, 2, 3].includes(Number(req.query.trimestre)) ? Number(req.query.trimestre) : trimestreActual();
  if (!caId) return res.render('notas/index', { titulo: 'Calificaciones', asignaciones, ca: null, trimestre });

  const ca = cargarAsignacion(req, caId);
  const alumnos = db.all(
    'SELECT id, nombre, apellidos FROM alumnos WHERE clase_id = ? AND activo = 1 ORDER BY apellidos, nombre',
    ca.clase_id,
  );
  const notas = db.all(
    `SELECT n.* FROM notas n JOIN alumnos a ON a.id = n.alumno_id
      WHERE a.clase_id = ? AND n.asignatura_id = ? AND n.trimestre = ? ORDER BY n.fecha, n.id`,
    ca.clase_id,
    ca.asignatura_id,
    trimestre,
  );
  // Columnas: cada evaluación (tipo + descripción + fecha + peso)
  const evaluaciones = [];
  const vistos = new Map();
  for (const n of notas) {
    const k = claveEval(n);
    if (!vistos.has(k)) {
      vistos.set(k, evaluaciones.length);
      evaluaciones.push({ clave: k, tipo: n.tipo, descripcion: n.descripcion, fecha: n.fecha, peso: n.peso });
    }
  }
  const filas = alumnos.map((a) => {
    const propias = notas.filter((n) => n.alumno_id === a.id);
    const celdas = evaluaciones.map((e) => propias.find((n) => claveEval(n) === e.clave) || null);
    const final = propias.find((n) => n.tipo === 'final');
    return { ...a, celdas, media: media(propias.filter((n) => n.tipo !== 'final')), final: final ? final.nota : null };
  });

  // Edición de una evaluación existente (precarga el formulario)
  const editar = req.query.editar !== undefined ? evaluaciones[Number(req.query.editar)] : null;
  const valores = {};
  if (editar) {
    for (const n of notas.filter((x) => claveEval(x) === editar.clave)) valores[n.alumno_id] = n;
  }
  res.render('notas/index', {
    titulo: 'Calificaciones',
    asignaciones,
    ca,
    trimestre,
    alumnos,
    evaluaciones,
    filas,
    editar,
    valores,
    TIPOS_NOTA,
    fechaHoy: hoy(),
  });
});

router.post('/', (req, res) => {
  const db = req.db;
  const b = req.body;
  const ca = cargarAsignacion(req, Number(b.asignacion));
  const trimestre = Number(b.trimestre);
  const tipo = b.tipo;
  const descripcion = texto(b.descripcion, 120);
  const fecha = b.fecha;
  const peso = Number(String(b.peso || '1').replace(',', '.'));
  const volver = `/notas?asignacion=${ca.id}&trimestre=${trimestre}`;

  const errores = [];
  if (![1, 2, 3].includes(trimestre)) errores.push('Trimestre no válido.');
  if (!TIPOS_NOTA[tipo]) errores.push('Tipo de evaluación no válido.');
  if (!descripcion) errores.push('Indica una descripción (p. ej. "Examen tema 3").');
  if (!esFecha(fecha)) errores.push('Fecha no válida.');
  if (!(peso > 0 && peso <= 10)) errores.push('El peso debe estar entre 0 y 10.');

  const alumnos = db.all('SELECT id FROM alumnos WHERE clase_id = ? AND activo = 1', ca.clase_id);
  const valores = alumnos.map((a) => ({ id: a.id, nota: leerNota(b[`nota_${a.id}`]), comentario: texto(b[`comentario_${a.id}`], 300) }));
  if (valores.some((v) => Number.isNaN(v.nota))) errores.push('Las notas deben ser números entre 0 y 10.');
  if (errores.length) {
    req.flash('error', errores.join(' '));
    return res.redirect(volver);
  }

  // Si se está editando, se usa la clave original para localizar las notas existentes
  const orig = b.original ? String(b.original).split('|') : [tipo, descripcion, fecha, String(peso)];
  let guardadas = 0;
  db.tx(() => {
    for (const v of valores) {
      const existente = db.get(
        `SELECT id FROM notas WHERE alumno_id = ? AND asignatura_id = ? AND trimestre = ? AND tipo = ? AND descripcion = ?
            AND fecha = ? AND peso = ?`,
        v.id,
        ca.asignatura_id,
        trimestre,
        orig[0],
        orig[1],
        orig[2],
        Number(orig[3]),
      );
      if (v.nota === null) {
        if (existente) db.run('DELETE FROM notas WHERE id = ?', existente.id);
        continue;
      }
      guardadas++;
      if (existente) {
        db.run(
          `UPDATE notas SET tipo = ?, descripcion = ?, fecha = ?, peso = ?, nota = ?, comentario = ?, profesor_id = ? WHERE id = ?`,
          tipo,
          descripcion,
          fecha,
          peso,
          v.nota,
          v.comentario,
          req.user.id,
          existente.id,
        );
      } else {
        db.run(
          `INSERT INTO notas (alumno_id, asignatura_id, trimestre, tipo, descripcion, nota, peso, fecha, comentario, profesor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          v.id,
          ca.asignatura_id,
          trimestre,
          tipo,
          descripcion,
          v.nota,
          peso,
          fecha,
          v.comentario,
          req.user.id,
        );
      }
    }
  });
  registrar(db, req.user.id, 'calificar', 'clase', ca.clase_id);
  req.flash('ok', `Evaluación "${descripcion}" guardada (${guardadas} nota${guardadas === 1 ? '' : 's'}).`);
  res.redirect(volver);
});

router.post('/:id/eliminar', (req, res, next) => {
  const db = req.db;
  const n = db.get('SELECT n.*, a.clase_id FROM notas n JOIN alumnos a ON a.id = n.alumno_id WHERE n.id = ?', Number(req.params.id));
  if (!n) return next(new HttpError(404, 'Nota no encontrada.'));
  if (!puedeCalificar(db, req.user, n.clase_id, n.asignatura_id)) return next(new HttpError(403, 'No puedes eliminar esta nota.'));
  db.run('DELETE FROM notas WHERE id = ?', n.id);
  registrar(db, req.user.id, 'eliminar_nota', 'alumno', n.alumno_id);
  req.flash('ok', 'Nota eliminada.');
  res.redirect(`/alumnos/${n.alumno_id}?tab=notas`);
});

module.exports = router;
