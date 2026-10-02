'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { crearEntorno, login, csrfDe } = require('./helpers');
const { hoy } = require('../src/helpers');

let db;
let app;
let ids;

before(() => {
  ({ db, app } = crearEntorno());
  const uid = (email) => db.get('SELECT id FROM usuarios WHERE email = ?', email).id;
  const clase = (nombre) => db.get('SELECT id FROM clases WHERE nombre = ?', nombre).id;
  const ca = (claseNombre, asignatura) =>
    db.get(
      `SELECT ca.id FROM clase_asignaturas ca JOIN clases c ON c.id = ca.clase_id JOIN asignaturas s ON s.id = ca.asignatura_id
        WHERE c.nombre = ? AND s.nombre = ?`,
      claseNombre,
      asignatura,
    ).id;
  ids = {
    laura: uid('laura.martin@colegio.local'),
    familia: uid('familia@colegio.local'),
    primariaA: clase('3º Primaria A'),
    esoA: clase('1º ESO A'),
    hijos: db.all('SELECT alumno_id FROM alumno_tutores WHERE tutor_id = ?', uid('familia@colegio.local')).map((r) => r.alumno_id),
    alumnoPrimariaB: db.get("SELECT a.id FROM alumnos a JOIN clases c ON c.id = a.clase_id WHERE c.nombre = '3º Primaria B'").id,
    alumnoEsoA: db.get("SELECT a.id FROM alumnos a JOIN clases c ON c.id = a.clase_id WHERE c.nombre = '1º ESO A'").id,
    mates3A: ca('3º Primaria A', 'Matemáticas'),
    mates1ESO: ca('1º ESO A', 'Matemáticas'),
    otroTutor: db.get(
      "SELECT u.id FROM usuarios u WHERE u.rol = 'tutor' AND u.id NOT IN (SELECT tutor_id FROM alumno_tutores at JOIN alumnos a ON a.id = at.alumno_id WHERE a.clase_id IN (SELECT clase_id FROM alumnos WHERE id IN (SELECT alumno_id FROM alumno_tutores WHERE tutor_id = ?))) LIMIT 1",
      uid('familia@colegio.local'),
    ).id,
  };
});

describe('autenticación', () => {
  test('redirige al login sin sesión', async () => {
    const res = await request(app).get('/alumnos');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });

  test('rechaza credenciales incorrectas', async () => {
    const agent = request.agent(app);
    const pagina = await agent.get('/login');
    const res = await agent.post('/login').type('form').send({ email: 'direccion@colegio.local', password: 'mal', _csrf: csrfDe(pagina.text) });
    assert.equal(res.status, 401);
    assert.match(res.text, /incorrectos/);
  });

  test('rechaza formularios sin token CSRF', async () => {
    const agent = await login(app, 'direccion@colegio.local');
    const res = await agent.post('/alumnos').type('form').send({ nombre: 'X' });
    assert.equal(res.status, 403);
  });

  test('los usuarios desactivados no pueden entrar', async () => {
    const dir = await login(app, 'direccion@colegio.local');
    const id = db.get("SELECT id FROM usuarios WHERE email = 'david.castro@colegio.local'").id;
    await dir.enviar(`/usuarios/${id}/estado`);
    await assert.rejects(login(app, 'david.castro@colegio.local'));
    await dir.enviar(`/usuarios/${id}/estado`);
    await login(app, 'david.castro@colegio.local');
  });
});

describe('todas las páginas cargan para cada perfil', () => {
  test('Dirección', async () => {
    const agent = await login(app, 'direccion@colegio.local');
    const alumno = ids.hijos[0];
    const urls = [
      '/', '/alumnos', '/alumnos?q=a', '/alumnos?estado=baja', '/alumnos/nuevo', '/alumnos/exportar.csv',
      ...['datos', 'familia', 'asistencia', 'notas', 'seguimiento'].map((t) => `/alumnos/${alumno}?tab=${t}`),
      `/alumnos/${alumno}/boletin`, `/alumnos/${alumno}/editar`,
      '/clases', '/clases/nueva', `/clases/${ids.primariaA}`, `/clases/${ids.primariaA}/editar`,
      '/usuarios', '/usuarios?rol=tutor', '/usuarios?rol=direccion', '/usuarios/nuevo', `/usuarios/${ids.laura}`, `/usuarios/${ids.familia}`,
      `/usuarios/${ids.laura}/editar`,
      '/asistencia', `/asistencia?clase=${ids.primariaA}`, `/asistencia/resumen?clase=${ids.primariaA}`, '/asistencia/justificaciones',
      '/notas', `/notas?asignacion=${ids.mates3A}&trimestre=1`, `/notas?asignacion=${ids.mates3A}&trimestre=1&editar=0`,
      '/seguimiento', '/seguimiento?tipo=conducta', '/mensajes', '/mensajes?carpeta=enviados', '/mensajes/nuevo',
      '/informes', '/informes/actividad', '/perfil',
    ];
    for (const url of urls) {
      const res = await agent.get(url);
      assert.equal(res.status, 200, `${url} → ${res.status}`);
    }
  });

  test('Profesor', async () => {
    const agent = await login(app, 'laura.martin@colegio.local');
    const urls = ['/', '/clases', `/clases/${ids.primariaA}`, '/alumnos', `/alumnos/${ids.hijos[0]}?tab=notas`,
      '/asistencia', '/asistencia/resumen', '/asistencia/justificaciones', '/notas', `/notas?asignacion=${ids.mates3A}`,
      '/seguimiento', '/mensajes', '/mensajes/nuevo', '/perfil'];
    for (const url of urls) {
      const res = await agent.get(url);
      assert.equal(res.status, 200, `${url} → ${res.status}`);
    }
    const msg = db.get('SELECT id FROM mensajes WHERE destinatario_id = ?', ids.laura).id;
    assert.equal((await agent.get(`/mensajes/${msg}`)).status, 200);
  });

  test('Familia', async () => {
    const agent = await login(app, 'familia@colegio.local');
    const panel = await agent.get('/');
    assert.equal(panel.status, 200);
    for (const id of ids.hijos) {
      for (const t of ['datos', 'familia', 'asistencia', 'notas', 'seguimiento']) {
        assert.equal((await agent.get(`/alumnos/${id}?tab=${t}`)).status, 200);
      }
      assert.equal((await agent.get(`/alumnos/${id}/boletin`)).status, 200);
    }
    for (const url of ['/alumnos', '/mensajes', '/mensajes/nuevo', '/perfil']) {
      assert.equal((await agent.get(url)).status, 200, url);
    }
  });
});

describe('control de acceso', () => {
  test('una familia solo ve a sus hijos', async () => {
    const agent = await login(app, 'familia@colegio.local');
    assert.equal((await agent.get(`/alumnos/${ids.alumnoPrimariaB}`)).status, 403);
    assert.equal((await agent.get(`/alumnos/${ids.alumnoPrimariaB}/boletin`)).status, 403);
    for (const url of ['/clases', '/usuarios', '/asistencia', '/notas', '/informes', '/seguimiento', '/alumnos/exportar.csv']) {
      assert.equal((await agent.get(url)).status, 403, url);
    }
  });

  test('un profesor solo ve los alumnos de sus clases', async () => {
    const agent = await login(app, 'laura.martin@colegio.local');
    assert.equal((await agent.get(`/alumnos/${ids.alumnoEsoA}`)).status, 403);
    assert.equal((await agent.get(`/clases/${ids.esoA}`)).status, 403);
    assert.equal((await agent.get(`/asistencia?clase=${ids.esoA}`)).status, 403);
    assert.equal((await agent.get('/usuarios')).status, 403);
    assert.equal((await agent.get('/informes')).status, 403);
    assert.equal((await agent.get('/alumnos/nuevo')).status, 403);
    const lista = await agent.get('/alumnos');
    assert.doesNotMatch(lista.text, /1º ESO A/);
  });

  test('solo el profesor de la asignatura puede calificar', async () => {
    const laura = await login(app, 'laura.martin@colegio.local');
    const datos = { asignacion: ids.mates1ESO, trimestre: 1, tipo: 'examen', descripcion: 'Intruso', fecha: hoy(), peso: 1 };
    assert.equal((await laura.enviar('/notas', datos)).status, 403);
    // Sara imparte Inglés en 3º A, pero no Matemáticas
    const sara = await login(app, 'sara.ortega@colegio.local');
    assert.equal((await sara.enviar('/notas', { ...datos, asignacion: ids.mates3A })).status, 403);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM notas WHERE descripcion = 'Intruso'").n, 0);
  });

  test('la familia no ve anotaciones internas', async () => {
    const hijo = ids.hijos[0];
    db.run(
      "INSERT INTO seguimiento (alumno_id, fecha, tipo, titulo, descripcion, visible_familia, autor_id) VALUES (?, ?, 'otro', 'Nota interna secreta', 'x', 0, ?)",
      hijo,
      hoy(),
      ids.laura,
    );
    const familia = await login(app, 'familia@colegio.local');
    assert.doesNotMatch((await familia.get(`/alumnos/${hijo}?tab=seguimiento`)).text, /Nota interna secreta/);
    const laura = await login(app, 'laura.martin@colegio.local');
    assert.match((await laura.get(`/alumnos/${hijo}?tab=seguimiento`)).text, /Nota interna secreta/);
  });

  test('las familias solo pueden escribir al profesorado de sus hijos y a Dirección', async () => {
    const familia = await login(app, 'familia@colegio.local');
    const res = await familia.enviar('/mensajes', { destinatario_id: ids.otroTutor, asunto: 'Hola', cuerpo: 'Hola' });
    assert.equal(res.status, 400);
    const ok = await familia.enviar('/mensajes', { destinatario_id: ids.laura, asunto: 'Pregunta', cuerpo: 'Hola' });
    assert.equal(ok.status, 302);
  });

  test('no se puede leer un mensaje ajeno', async () => {
    const msg = db.get('SELECT id FROM mensajes WHERE destinatario_id = ?', ids.laura).id;
    const elena = await login(app, 'elena.navarro@colegio.local');
    assert.equal((await elena.get(`/mensajes/${msg}`)).status, 404);
  });
});

describe('asistencia', () => {
  test('pasar lista, aviso a la familia, justificación y revisión', async () => {
    const fecha = hoy();
    const hijo = ids.hijos.find((id) => db.get('SELECT clase_id FROM alumnos WHERE id = ?', id).clase_id === ids.primariaA);
    db.run('DELETE FROM asistencia WHERE fecha = ?', fecha);
    const alumnos = db.all('SELECT id FROM alumnos WHERE clase_id = ? AND activo = 1', ids.primariaA);
    const datos = { clase_id: ids.primariaA, fecha, notificar: 'on' };
    for (const a of alumnos) datos[`estado_${a.id}`] = a.id === hijo ? 'ausente' : 'presente';

    const laura = await login(app, 'laura.martin@colegio.local');
    const res = await laura.enviar('/asistencia', datos);
    assert.equal(res.status, 302);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM asistencia WHERE fecha = ?', fecha).n, alumnos.length);
    const reg = db.get('SELECT * FROM asistencia WHERE alumno_id = ? AND fecha = ?', hijo, fecha);
    assert.equal(reg.estado, 'ausente');
    assert.ok(db.get("SELECT 1 FROM mensajes WHERE destinatario_id = ? AND asunto LIKE 'Falta de asistencia%'", ids.familia));

    const familia = await login(app, 'familia@colegio.local');
    await familia.enviar(`/alumnos/${hijo}/asistencia/${reg.id}/justificar`, { motivo: 'Cita con el pediatra' });
    assert.equal(db.get('SELECT motivo_familia FROM asistencia WHERE id = ?', reg.id).motivo_familia, 'Cita con el pediatra');

    // La familia no puede marcar ella misma la falta como justificada
    assert.equal((await familia.enviar(`/asistencia/${reg.id}/revisar`, { accion: 'aceptar' })).status, 403);

    await laura.enviar(`/asistencia/${reg.id}/revisar`, { accion: 'aceptar' });
    assert.equal(db.get('SELECT estado FROM asistencia WHERE id = ?', reg.id).estado, 'justificada');
  });

  test('no permite registrar días futuros', async () => {
    const laura = await login(app, 'laura.martin@colegio.local');
    const res = await laura.enviar('/asistencia', { clase_id: ids.primariaA, fecha: '2999-01-01' });
    assert.equal(res.status, 302);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM asistencia WHERE fecha = '2999-01-01'").n, 0);
  });
});

describe('calificaciones', () => {
  test('crear, editar y validar una evaluación', async () => {
    const laura = await login(app, 'laura.martin@colegio.local');
    const alumnos = db.all('SELECT id FROM alumnos WHERE clase_id = ? AND activo = 1 ORDER BY id', ids.primariaA);
    const base = { asignacion: ids.mates3A, trimestre: 2, tipo: 'examen', descripcion: 'Examen fracciones', fecha: hoy(), peso: 2 };

    // Nota fuera de rango: no se guarda nada
    await laura.enviar('/notas', { ...base, [`nota_${alumnos[0].id}`]: '11' });
    assert.equal(db.get("SELECT COUNT(*) AS n FROM notas WHERE descripcion = 'Examen fracciones'").n, 0);

    await laura.enviar('/notas', { ...base, [`nota_${alumnos[0].id}`]: '7,5', [`nota_${alumnos[1].id}`]: '4' });
    const notas = db.all("SELECT alumno_id, nota FROM notas WHERE descripcion = 'Examen fracciones' ORDER BY alumno_id");
    assert.deepEqual(notas.map((n) => n.nota), [7.5, 4]);

    // Edición: cambia una nota y elimina la otra (campo vacío)
    await laura.enviar('/notas', {
      ...base,
      original: 'examen|Examen fracciones|' + hoy() + '|2',
      [`nota_${alumnos[0].id}`]: '8',
      [`nota_${alumnos[1].id}`]: '',
    });
    const tras = db.all("SELECT alumno_id, nota FROM notas WHERE descripcion = 'Examen fracciones'");
    assert.equal(tras.length, 1);
    assert.equal(tras[0].nota, 8);

    const boletin = await laura.get(`/alumnos/${alumnos[0].id}?tab=notas`);
    assert.match(boletin.text, /Examen fracciones/);
  });
});

describe('gestión por Dirección', () => {
  test('alta de alumno y de su familia, que puede acceder al portal', async () => {
    const dir = await login(app, 'direccion@colegio.local');
    const res = await dir.enviar('/alumnos', {
      numero_expediente: 'EXP-9999',
      nombre: 'Nuevo',
      apellidos: 'Alumno Prueba',
      fecha_nacimiento: '2018-05-05',
      clase_id: ids.primariaA,
      alergias: 'Gluten',
      consentimiento_datos: 'on',
    });
    assert.equal(res.status, 302);
    const alumno = db.get("SELECT * FROM alumnos WHERE numero_expediente = 'EXP-9999'");
    assert.equal(alumno.alergias, 'Gluten');
    assert.equal(alumno.consentimiento_datos, 1);

    // Expediente duplicado
    const dup = await dir.enviar('/alumnos', { numero_expediente: 'EXP-9999', nombre: 'A', apellidos: 'B', fecha_nacimiento: '2018-01-01' });
    assert.equal(dup.status, 400);

    await dir.enviar(`/alumnos/${alumno.id}/tutores`, {
      nombre: 'Rosa',
      apellidos: 'Prueba',
      email: 'rosa.prueba@familia.local',
      parentesco: 'Madre',
      contacto_principal: 'on',
      custodia: 'on',
    });
    const ficha = await dir.get(`/alumnos/${alumno.id}?tab=familia`);
    const password = ficha.text.match(/Contraseña temporal de acceso: (\S+)/)[1];
    const rosa = await login(app, 'rosa.prueba@familia.local', password);
    assert.equal((await rosa.get(`/alumnos/${alumno.id}`)).status, 200);
    const lista = await rosa.get('/alumnos'); // único hijo → la lista redirige a su ficha
    assert.equal(lista.headers.location, `/alumnos/${alumno.id}`);
    assert.match((await rosa.get('/')).text, /Nuevo Alumno Prueba/);
  });

  test('crear una clase y asignar asignatura y profesor', async () => {
    const dir = await login(app, 'direccion@colegio.local');
    const res = await dir.enviar('/clases', { etapa: 'ESO', nivel: '3º', grupo: 'b', curso_academico: '2026-2027', tutor_id: ids.laura });
    assert.equal(res.status, 302);
    const clase = db.get("SELECT * FROM clases WHERE nombre = '3º ESO B'");
    assert.ok(clase);
    await dir.enviar(`/clases/${clase.id}/asignaturas`, { nueva_asignatura: 'Física y Química', profesor_id: ids.laura });
    assert.ok(db.get('SELECT 1 FROM clase_asignaturas WHERE clase_id = ? AND profesor_id = ?', clase.id, ids.laura));
  });

  test('el CSV de alumnos neutraliza fórmulas', async () => {
    db.run("UPDATE alumnos SET direccion = '=HYPERLINK(\"x\")' WHERE id = ?", ids.hijos[0]);
    const dir = await login(app, 'direccion@colegio.local');
    const csv = await dir.get('/alumnos/exportar.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.text, /"'=HYPERLINK/);
  });
});

describe('perfil', () => {
  test('la familia actualiza su teléfono y su contraseña', async () => {
    const familia = await login(app, 'familia@colegio.local');
    await familia.enviar('/perfil', { telefono: '699111222' });
    assert.equal(db.get('SELECT telefono FROM usuarios WHERE id = ?', ids.familia).telefono, '699111222');
    await familia.enviar('/perfil/password', { actual: 'colegio123', nueva: 'nuevaClave1', repetir: 'nuevaClave1' });
    await login(app, 'familia@colegio.local', 'nuevaClave1');
    await familia.enviar('/perfil/password', { actual: 'nuevaClave1', nueva: 'colegio123', repetir: 'colegio123' });
  });
});
