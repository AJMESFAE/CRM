# CRM Escolar

Aplicación web para gestionar un colegio: datos personales del alumnado, de las familias (padres / tutores legales) y del profesorado, con seguimiento de **asistencia**, **calificaciones** y **observaciones** de cada alumno.

Construida con Node.js + Express + SQLite (módulo `node:sqlite` integrado en Node) y vistas EJS renderizadas en servidor. No requiere ninguna base de datos externa.

## Puesta en marcha

Requisitos: **Node.js 22.13 o superior**.

```bash
npm install
npm run seed     # (opcional) carga datos de demostración — BORRA los datos existentes
npm start        # http://localhost:3000
```

Si arrancas sin datos de demostración, al iniciar por primera vez se crea un usuario de Dirección y su contraseña se muestra en la consola (o usa `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

### Cuentas de demostración (`npm run seed`)

Contraseña de todas: `colegio123`

| Perfil | Email | Notas |
|---|---|---|
| Dirección | `direccion@colegio.local` | Acceso completo |
| Profesora | `laura.martin@colegio.local` | Tutora de 3º Primaria A |
| Profesora | `elena.navarro@colegio.local` | Matemáticas en ESO, tutora de 1º ESO A |
| Profesora | `sara.ortega@colegio.local` | Inglés en todos los grupos |
| Familia | `familia@colegio.local` | Madre con dos hijos (3º Primaria A y 1º ESO A) |

### Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP (por defecto 3000) |
| `DB_PATH` | Ruta del fichero SQLite (por defecto `data/colegio.db`) |
| `SESSION_SECRET` | Secreto para firmar las cookies de sesión. **Obligatorio en producción** |
| `COOKIE_SECURE=1` | Marca la cookie como `Secure` (usar detrás de HTTPS) |
| `TRUST_PROXY=1` | Si se ejecuta detrás de un proxy inverso |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Usuario de Dirección creado en el primer arranque |

## Perfiles y permisos

| Funcionalidad | Dirección | Profesor/a | Padre/Madre/Tutor legal |
|---|---|---|---|
| Ver fichas de alumnos | Todos | Alumnos de sus clases (como tutor o impartiendo alguna asignatura) | Solo sus hijos |
| Alta / edición / baja de alumnos | ✔ | — | — |
| Gestionar profesorado, familias y clases | ✔ | — | — |
| Vincular padres/tutores a alumnos | ✔ | — | — |
| Contactos de emergencia | ✔ | Ver | Añadir / eliminar los de sus hijos |
| Pasar lista | ✔ | En sus clases | — |
| Justificar faltas | Aceptar / rechazar | Aceptar / rechazar | Enviar el motivo |
| Poner notas | ✔ | Solo en las asignaturas que imparte | Ver |
| Anotaciones de seguimiento | ✔ | Crear (y borrar las propias) | Ver las marcadas como visibles |
| Mensajería | Con todos | Con Dirección, profesorado y familias de sus alumnos | Con Dirección y el profesorado de sus hijos |
| Informes y registro de actividad | ✔ | — | — |
| Exportar alumnos a CSV | ✔ | — | — |
| Actualizar sus datos de contacto y contraseña | ✔ | ✔ | ✔ |

## Datos que se recogen

**Alumno/a**
- Identificación: nº de expediente, nombre, apellidos, fecha de nacimiento, sexo, DNI/NIE, nacionalidad.
- Domicilio: dirección, localidad, código postal.
- Académicos: clase, fecha de matrícula.
- Salud y necesidades: alergias, condiciones médicas, medicación, necesidades educativas especiales, observaciones. Las alergias/medicación aparecen como aviso destacado en la ficha y en los listados.
- Autorizaciones (RGPD): tratamiento de datos, uso de imágenes, salidas y excursiones.
- Contactos de emergencia y personas autorizadas a recoger.

**Padres / tutores legales**
- Nombre, apellidos, DNI, email (usuario de acceso), teléfonos, domicilio, profesión.
- Por cada hijo: parentesco, contacto principal, custodia, autorización de recogida.

**Profesorado y Dirección**
- Nombre, apellidos, DNI, email, teléfonos, domicilio, especialidad, cargo.
- Tutoría de grupo y asignaturas que imparte en cada clase (con horas semanales).

## Seguimiento del alumnado

- **Asistencia diaria**: presente / falta / retraso / falta justificada, con observaciones. Botón «Todos presentes», aviso automático por mensaje a la familia ante faltas y retrasos, y resumen mensual por clase en formato parrilla.
- **Justificaciones**: la familia envía el motivo desde su portal y el profesorado o Dirección lo acepta o rechaza.
- **Calificaciones**: evaluaciones por asignatura y trimestre (examen, trabajo, deberes, actitud, exposición oral, nota final) con peso para la media ponderada. Edición de evaluaciones completas, media por trimestre y curso, calificación cualitativa (Insuficiente… Sobresaliente) y **boletín imprimible**.
- **Seguimiento**: anotaciones académicas, de conducta, salud, tutorías con la familia, reconocimientos positivos… con opción de hacerlas internas (no visibles para la familia).
- **Paneles** por perfil: Dirección ve indicadores del centro (faltas del día, clases sin lista pasada, alumnos con más faltas); el profesorado, sus clases y tareas pendientes; las familias, un resumen de cada hijo.
- **Informes** (Dirección): asistencia y nota media por clase, rendimiento por asignatura, y alumnos que requieren atención (asistencia < 85 % o dos o más asignaturas suspensas).

## Seguridad y protección de datos

- Contraseñas con bcrypt; bloqueo temporal tras 5 intentos fallidos; regeneración de la sesión al iniciar sesión.
- Protección CSRF en todos los formularios, cookies `HttpOnly` + `SameSite`, cabeceras CSP / `X-Frame-Options` / `nosniff`.
- Control de acceso comprobado en servidor en cada ruta (no solo ocultando botones).
- Registro de actividad: accesos a fichas, altas, modificaciones, exportaciones, etc.
- Exportación CSV protegida frente a inyección de fórmulas.
- Las contraseñas temporales de usuarios nuevos se muestran una sola vez a Dirección para que las comunique por un canal seguro.

> Antes de usarlo con datos reales, el centro debe completar sus obligaciones RGPD/LOPDGDD (registro de actividades de tratamiento, información a las familias, delegado de protección de datos, copias de seguridad cifradas del fichero `data/colegio.db`, HTTPS, etc.).

## Estructura

```
src/
  server.js          arranque y creación del primer usuario de Dirección
  app.js             configuración de Express (sesiones, seguridad, rutas)
  db.js, schema.sql  conexión y esquema SQLite
  access.js          reglas de permisos por perfil
  auth.js            autenticación, roles y CSRF
  seed.js            datos de demostración
  routes/            alumnos, clases, usuarios, asistencia, notas, seguimiento, mensajes, informes, perfil
views/               plantillas EJS
public/              CSS y JS del cliente
test/                tests de integración (node:test + supertest)
```

## Tests

```bash
npm test
```

Cubren el inicio de sesión, la carga de todas las páginas con cada perfil, el control de acceso (familias, profesores fuera de su clase o asignatura, mensajes ajenos), el flujo completo de asistencia y justificación, las calificaciones y la gestión por Dirección.
