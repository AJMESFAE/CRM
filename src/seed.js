'use strict';

// Genera datos de demostración. ATENCIÓN: borra todos los datos existentes.
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const { cursoAcademicoActual, hoy } = require('./helpers');

const PASSWORD_DEMO = 'colegio123';

// Generador pseudoaleatorio determinista para que la demo sea reproducible
function rng(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function diasLectivos(n) {
  const dias = [];
  const d = new Date(`${hoy()}T12:00:00`);
  while (dias.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) dias.unshift(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return dias;
}

function seed(db, { log = () => {} } = {}) {
  const r = rng(42);
  const elegir = (arr) => arr[Math.floor(r() * arr.length)];
  const hash = bcrypt.hashSync(PASSWORD_DEMO, 10);
  const curso = cursoAcademicoActual();

  db.tx(() => {
    for (const t of ['mensajes', 'seguimiento', 'notas', 'asistencia', 'contactos_emergencia', 'alumno_tutores', 'alumnos',
      'clase_asignaturas', 'asignaturas', 'clases', 'registro_actividad', 'sesiones', 'usuarios']) {
      db.run(`DELETE FROM ${t}`);
    }

    const usuario = (rol, email, nombre, apellidos, extra = {}) =>
      Number(
        db.run(
          `INSERT INTO usuarios (email, password_hash, rol, nombre, apellidos, dni, telefono, direccion, localidad, codigo_postal,
                                 especialidad, cargo, profesion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          email, hash, rol, nombre, apellidos, extra.dni, extra.telefono, extra.direccion, extra.localidad, extra.cp,
          extra.especialidad, extra.cargo, extra.profesion,
        ).lastInsertRowid,
      );

    // Dirección
    usuario('direccion', 'direccion@colegio.local', 'Carmen', 'Ruiz Delgado', { cargo: 'Directora', telefono: '910000001' });
    usuario('direccion', 'jefatura@colegio.local', 'Andrés', 'Molina Prieto', { cargo: 'Jefe de estudios', telefono: '910000002' });

    // Profesorado
    const profes = [
      ['laura.martin', 'Laura', 'Martín Sanz', 'Educación Primaria'],
      ['javier.lopez', 'Javier', 'López Herrera', 'Educación Primaria'],
      ['elena.navarro', 'Elena', 'Navarro Gil', 'Matemáticas'],
      ['pablo.romero', 'Pablo', 'Romero Vidal', 'Lengua Castellana y Literatura'],
      ['sara.ortega', 'Sara', 'Ortega Blanco', 'Inglés'],
      ['david.castro', 'David', 'Castro Ramos', 'Educación Física'],
      ['lucia.moreno', 'Lucía', 'Moreno Iglesias', 'Ciencias Naturales'],
    ].map(([u, n, a, esp], i) =>
      usuario('profesor', `${u}@colegio.local`, n, a, { especialidad: esp, telefono: `6000000${10 + i}` }),
    );
    const [laura, javier, elena, pablo, sara, david, lucia] = profes;

    // Asignaturas
    const asig = {};
    for (const n of ['Lengua Castellana', 'Matemáticas', 'Inglés', 'Ciencias de la Naturaleza', 'Ciencias Sociales',
      'Educación Física', 'Biología y Geología', 'Geografía e Historia']) {
      asig[n] = Number(db.run('INSERT INTO asignaturas (nombre) VALUES (?)', n).lastInsertRowid);
    }

    const clase = (etapa, nivel, grupo, aula, tutor) =>
      Number(
        db.run(
          'INSERT INTO clases (nombre, etapa, nivel, grupo, curso_academico, aula, tutor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          `${nivel} ${etapa} ${grupo}`, etapa, nivel, grupo, curso, aula, tutor,
        ).lastInsertRowid,
      );
    const clases = [
      { id: clase('Primaria', '3º', 'A', '12', laura), nacimiento: 2018, plan: [
        ['Lengua Castellana', laura], ['Matemáticas', laura], ['Ciencias de la Naturaleza', laura], ['Ciencias Sociales', laura],
        ['Inglés', sara], ['Educación Física', david]] },
      { id: clase('Primaria', '3º', 'B', '13', javier), nacimiento: 2018, plan: [
        ['Lengua Castellana', javier], ['Matemáticas', javier], ['Ciencias de la Naturaleza', javier], ['Ciencias Sociales', javier],
        ['Inglés', sara], ['Educación Física', david]] },
      { id: clase('ESO', '1º', 'A', '21', elena), nacimiento: 2014, plan: [
        ['Lengua Castellana', pablo], ['Matemáticas', elena], ['Inglés', sara], ['Biología y Geología', lucia],
        ['Geografía e Historia', pablo], ['Educación Física', david]] },
      { id: clase('ESO', '2º', 'A', '22', pablo), nacimiento: 2013, plan: [
        ['Lengua Castellana', pablo], ['Matemáticas', elena], ['Inglés', sara], ['Biología y Geología', lucia],
        ['Geografía e Historia', pablo], ['Educación Física', david]] },
    ];
    for (const c of clases) {
      for (const [n, p] of c.plan) {
        db.run('INSERT INTO clase_asignaturas (clase_id, asignatura_id, profesor_id, horas_semana) VALUES (?, ?, ?, ?)', c.id, asig[n], p, n === 'Educación Física' ? 2 : 4);
      }
    }

    // Alumnado y familias
    const nombresA = ['Lucía', 'Hugo', 'Martina', 'Mateo', 'Sofía', 'Leo', 'Valeria', 'Daniel', 'Paula', 'Álvaro', 'Julia', 'Marcos',
      'Emma', 'Adrián', 'Carla', 'Diego', 'Noa', 'Pablo', 'Alba', 'Mario', 'Vega', 'Iker', 'Olivia', 'Bruno', 'Aitana', 'Gonzalo',
      'Claudia', 'Nicolás', 'Irene', 'Samuel', 'Elsa', 'Rubén'];
    const apellidos = ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín',
      'Jiménez', 'Hernández', 'Díaz', 'Moreno', 'Álvarez', 'Muñoz', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres', 'Domínguez',
      'Vázquez', 'Ramos', 'Gil', 'Ramírez', 'Serrano', 'Blanco', 'Molina', 'Suárez', 'Ortega', 'Delgado'];
    const nombresMadre = ['María', 'Ana', 'Isabel', 'Cristina', 'Raquel', 'Beatriz', 'Silvia', 'Patricia', 'Marta', 'Nuria', 'Eva', 'Rocío'];
    const nombresPadre = ['José', 'Antonio', 'Manuel', 'Francisco', 'Juan', 'Luis', 'Carlos', 'Miguel', 'Alberto', 'Sergio', 'Raúl', 'Óscar'];
    const profesiones = ['Enfermera/o', 'Ingeniero/a', 'Administrativo/a', 'Comercial', 'Docente', 'Autónomo/a', 'Médico/a', 'Abogado/a'];
    const calles = ['C/ Mayor', 'Av. de la Constitución', 'C/ Real', 'Pza. España', 'C/ del Sol', 'C/ Alcalá', 'Av. Europa'];
    const alergias = [null, null, null, null, null, 'Frutos secos', 'Lactosa', 'Polen (estacional)', 'Penicilina'];

    const alumnos = [];
    let idx = 0;
    let familias = 0;
    for (const c of clases) {
      for (let i = 0; i < 8; i++, idx++) {
        const ap1 = apellidos[idx % apellidos.length];
        const ap2 = apellidos[(idx * 7 + 3) % apellidos.length];
        const nombre = nombresA[idx % nombresA.length];
        const sexo = idx % 2 === 0 ? 'F' : 'M';
        const mes = String(1 + Math.floor(r() * 12)).padStart(2, '0');
        const dia = String(1 + Math.floor(r() * 28)).padStart(2, '0');
        const direccion = `${elegir(calles)}, ${1 + Math.floor(r() * 120)}`;
        const alergia = elegir(alergias);
        const id = Number(
          db.run(
            `INSERT INTO alumnos (numero_expediente, nombre, apellidos, fecha_nacimiento, sexo, nacionalidad, direccion, localidad,
                                  codigo_postal, clase_id, fecha_matricula, alergias, necesidades_educativas, medicacion,
                                  autorizacion_imagenes, autorizacion_salidas, consentimiento_datos)
             VALUES (?, ?, ?, ?, ?, 'Española', ?, 'Madrid', ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
            `EXP-${String(1000 + idx)}`, nombre, `${ap1} ${ap2}`, `${c.nacimiento}-${mes}-${dia}`, sexo, direccion,
            `280${String(10 + (idx % 40)).padStart(2, '0')}`, c.id, `${curso.slice(0, 4)}-09-08`, alergia,
            idx % 9 === 4 ? 'TDAH: ubicar en primeras filas y fraccionar tareas largas.' : idx % 13 === 6 ? 'Dislexia: más tiempo en exámenes escritos.' : null,
            alergia === 'Frutos secos' ? 'Autoinyector de adrenalina en secretaría' : null,
            r() > 0.15 ? 1 : 0,
          ).lastInsertRowid,
        );
        alumnos.push({ id, clase: c, nombre, apellidos: `${ap1} ${ap2}`, nivel: 0.35 + r() * 0.6 });

        // Madre/padre (las dos primeras familias tienen dos hijos en clases diferentes)
        const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.');
        const madre = nombresMadre[idx % nombresMadre.length];
        const padre = nombresPadre[(idx + 5) % nombresPadre.length];
        const emailM = `${slug(madre)}.${slug(ap2)}${idx}@familia.local`;
        const emailP = `${slug(padre)}.${slug(ap1)}${idx}@familia.local`;
        const idM = usuario('tutor', emailM, madre, `${ap2} ${elegir(apellidos)}`, {
          dni: `${String(10000000 + idx * 7919).slice(0, 8)}${'TRWAGMYFPDXBNJZSQVHLCKE'[idx % 23]}`,
          telefono: `6${String(10000000 + idx * 104729).slice(0, 8)}`, direccion, localidad: 'Madrid', profesion: elegir(profesiones),
        });
        db.run('INSERT INTO alumno_tutores (alumno_id, tutor_id, parentesco, contacto_principal) VALUES (?, ?, ?, 1)', id, idM, 'Madre');
        familias++;
        if (idx % 3 !== 2) {
          const idP = usuario('tutor', emailP, padre, `${ap1} ${elegir(apellidos)}`, {
            telefono: `6${String(20000000 + idx * 130363).slice(0, 8)}`, direccion, localidad: 'Madrid', profesion: elegir(profesiones),
          });
          db.run('INSERT INTO alumno_tutores (alumno_id, tutor_id, parentesco, contacto_principal) VALUES (?, ?, ?, 0)', id, idP, 'Padre');
          familias++;
        }
        if (r() > 0.5) {
          db.run('INSERT INTO contactos_emergencia (alumno_id, nombre, parentesco, telefono, autorizado_recogida) VALUES (?, ?, ?, ?, 1)',
            id, `${elegir(nombresMadre)} ${elegir(apellidos)}`, 'Abuela', `6${String(30000000 + idx * 15485863).slice(0, 8)}`);
        }
      }
    }

    // Familia demo fácil de recordar: dos hijos en 3º Primaria A y 1º ESO A
    const familiaDemo = usuario('tutor', 'familia@colegio.local', 'Marta', 'Gómez Pardo', {
      dni: '12345678Z', telefono: '612345678', direccion: 'C/ Mayor, 10', localidad: 'Madrid', cp: '28013', profesion: 'Arquitecta',
    });
    db.run("INSERT INTO alumno_tutores (alumno_id, tutor_id, parentesco, contacto_principal) VALUES (?, ?, 'Madre', 0)", alumnos[0].id, familiaDemo);
    db.run("INSERT INTO alumno_tutores (alumno_id, tutor_id, parentesco, contacto_principal) VALUES (?, ?, 'Madre', 0)", alumnos[16].id, familiaDemo);

    // Asistencia de las últimas 4 semanas lectivas
    const dias = diasLectivos(20);
    for (const a of alumnos) {
      for (const f of dias) {
        const x = r();
        let estado = 'presente';
        if (x > 0.97 - (1 - a.nivel) * 0.12) estado = 'ausente';
        else if (x > 0.93 - (1 - a.nivel) * 0.08) estado = 'retraso';
        else if (x > 0.91) estado = 'justificada';
        const tutor = db.get('SELECT tutor_id FROM clases WHERE id = ?', a.clase.id).tutor_id;
        db.run('INSERT INTO asistencia (alumno_id, fecha, estado, observacion, registrado_por) VALUES (?, ?, ?, ?, ?)',
          a.id, f, estado, estado === 'justificada' ? 'Cita médica' : null, tutor);
      }
    }
    // Una justificación de la familia pendiente de revisar
    db.run("UPDATE asistencia SET estado = 'ausente', observacion = NULL WHERE alumno_id = ? AND fecha = ?", alumnos[0].id, dias[dias.length - 3]);
    const falta = db.get('SELECT id FROM asistencia WHERE alumno_id = ? AND fecha = ?', alumnos[0].id, dias[dias.length - 3]);
    db.run("UPDATE asistencia SET motivo_familia = 'Tenía fiebre, adjuntaremos justificante médico.', motivo_familia_en = datetime('now') WHERE id = ?", falta.id);

    // Calificaciones del 1er trimestre
    const evaluaciones = [
      ['examen', 'Examen tema 1', dias[4], 2],
      ['trabajo', 'Trabajo en grupo', dias[9], 1],
      ['deberes', 'Cuaderno y deberes', dias[14], 1],
    ];
    for (const a of alumnos) {
      for (const [nombreAsig, profesor] of a.clase.plan) {
        for (const [tipo, desc, fecha, peso] of evaluaciones) {
          const nota = Math.max(0, Math.min(10, Math.round((a.nivel * 10 + (r() - 0.5) * 3) * 4) / 4));
          db.run(
            'INSERT INTO notas (alumno_id, asignatura_id, trimestre, tipo, descripcion, nota, peso, fecha, profesor_id) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)',
            a.id, asig[nombreAsig], tipo, desc, nota, peso, fecha, profesor,
          );
        }
      }
    }

    // Seguimiento
    const plantillas = [
      ['positivo', 'Gran participación en clase', 'Muestra mucho interés y ayuda a sus compañeros.', 1],
      ['academico', 'Dificultades en cálculo', 'Le cuesta la resolución de problemas. Se recomienda refuerzo en casa con fichas.', 1],
      ['conducta', 'Interrupciones en clase', 'Ha interrumpido varias veces la explicación. Se ha hablado con el alumno.', 1],
      ['tutoria', 'Reunión con la familia', 'Reunión trimestral: se acuerda revisar la agenda diariamente.', 1],
      ['salud', 'Malestar en el recreo', 'Se avisó a la familia, que vino a recogerle a las 12:00.', 1],
      ['otro', 'Coordinación con orientación', 'Pendiente de valoración por el departamento de orientación.', 0],
    ];
    alumnos.forEach((a, i) => {
      if (i % 3 !== 0) return;
      const [tipo, titulo, desc, visible] = plantillas[i % plantillas.length];
      const autor = db.get('SELECT tutor_id FROM clases WHERE id = ?', a.clase.id).tutor_id;
      db.run('INSERT INTO seguimiento (alumno_id, fecha, tipo, titulo, descripcion, visible_familia, autor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        a.id, dias[i % dias.length], tipo, titulo, desc, visible, autor);
    });

    // Mensajes
    db.run('INSERT INTO mensajes (remitente_id, destinatario_id, alumno_id, asunto, cuerpo) VALUES (?, ?, ?, ?, ?)',
      familiaDemo, laura, alumnos[0].id, 'Consulta sobre la excursión',
      'Buenos días, Laura:\n\n¿Podría indicarnos qué necesita llevar mi hija a la excursión del próximo viernes?\n\nGracias.\nMarta');
    db.run('INSERT INTO mensajes (remitente_id, destinatario_id, alumno_id, asunto, cuerpo) VALUES (?, ?, ?, ?, ?)',
      laura, familiaDemo, alumnos[0].id, 'Reunión de evaluación',
      'Hola, Marta:\n\nLe propongo una tutoría el próximo martes a las 16:30 para comentar la evolución del trimestre.\n\nUn saludo,\nLaura');

    log(`Datos de demostración creados: ${alumnos.length} alumnos, ${profes.length} profesores, ${familias + 1} familiares, ${clases.length} clases.`);
  });
}

module.exports = { seed, PASSWORD_DEMO };

if (require.main === module) {
  const db = openDb();
  seed(db, { log: console.log });
  console.log(`\nContraseña de todas las cuentas de demo: ${PASSWORD_DEMO}`);
  console.log('  Dirección:  direccion@colegio.local');
  console.log('  Profesora:  laura.martin@colegio.local (tutora de 3º Primaria A)');
  console.log('  Profesora:  elena.navarro@colegio.local (Matemáticas ESO, tutora de 1º ESO A)');
  console.log('  Familia:    familia@colegio.local (dos hijos)');
  db.close();
}
