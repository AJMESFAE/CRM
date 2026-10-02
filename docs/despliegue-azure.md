# Despliegue en Azure

## Resumen

**Sí, se puede desplegar en Azure**, sin rehacer la aplicación. La opción recomendada es **Azure App Service (Linux, Node.js 24 LTS)**. La base de datos SQLite se guarda en el almacenamiento persistente `/home` de App Service.

- **Coste aproximado:** unos 13–15 € al mes (plan B1 y logs). Los precios cambian; confírmalos en la [calculadora de precios de Azure](https://azure.microsoft.com/pricing/calculator/).
- **Capacidad:** suficiente para un colegio (cientos de alumnos y decenas de usuarios a la vez).
- **Limitación principal:** la app funciona en **una sola instancia**. Para escalar a varias instancias o para alta disponibilidad entre zonas, habría que pasar la base de datos a PostgreSQL (ver [Evolución](#evolución)).

El repositorio incluye todo lo necesario:

| Fichero | Contenido |
|---|---|
| `infra/main.bicep` | Infraestructura como código: plan y web app, logs, alerta e identidad de despliegue |
| `infra/main.bicepparam` | Parámetros de ejemplo. Los secretos se leen de variables de entorno |
| `.github/workflows/ci-cd.yml` | Tests en Node 22 y 24 y validación del Bicep en cada PR. Despliegue automático al hacer *merge* en `main` |

## Análisis de opciones

| Opción | Encaje | Coste/mes aprox. | Comentario |
|---|---|---|---|
| **App Service + SQLite en `/home`** ✅ | Muy bueno | 13–15 € | No cambia el código. TLS, dominio y certificado gestionados. Copias de seguridad automáticas cada hora. Solo una instancia. |
| App Service + Azure Database for PostgreSQL | Bueno | 30–45 € | Permite varias instancias y restaurar a cualquier momento. **Requiere migrar la capa de datos** (de `node:sqlite` a `pg`). |
| Azure Container Apps + Azure Files | Regular | 10–25 € | SQLite sobre Azure Files tiene las mismas restricciones que `/home`. Más complejo, y escalar a cero provoca arranques lentos y riesgo de dos réplicas a la vez. |
| Máquina virtual | Posible | 15–30 € | Control total, pero el colegio tendría que mantener el sistema operativo, los parches, el TLS y las copias. |
| Static Web Apps / Functions | No válido | — | La aplicación renderiza en servidor y mantiene sesiones. No es una SPA ni funciones sin estado. |

### Por qué App Service + SQLite es viable

- **Persistencia:** `/home` en App Service Linux es almacenamiento compartido persistente. Sobrevive a reinicios, despliegues y actualizaciones de la plataforma, y entra en las copias automáticas. La base de datos se guarda en `/home/data/colegio.db`.
- **Paquete de solo lectura:** el código se despliega como paquete con `WEBSITE_RUN_FROM_PACKAGE=1` y queda en solo lectura. La aplicación no escribe en su propia carpeta, cosa comprobada ejecutándola desde una carpeta sin permisos de escritura.
- **Sin compilación en Azure:** no hay módulos nativos (`bcryptjs` es JavaScript puro y SQLite viene incluido en Node). El paquete se construye en GitHub Actions y no se compila nada en Azure.
- **Volumen de datos:** un colegio genera poco. Aproximadamente 1 registro de asistencia por alumno y día, más notas y anotaciones. Incluso con 1.000 alumnos son menos de 200.000 filas al año, muy lejos de cualquier límite de SQLite o de los 10 GB de almacenamiento del plan B1.

### Restricciones y cómo se resuelven

| Restricción | Solución aplicada |
|---|---|
| `/home` está sobre Azure Storage (red) y el modo WAL de SQLite no funciona en sistemas de ficheros de red | `SQLITE_JOURNAL_MODE=DELETE` en Azure. En local se sigue usando WAL. |
| Dos instancias escribiendo en el mismo fichero SQLite lo corromperían | El plan se crea con `capacity: 1`. **No actives el escalado horizontal.** |
| Las copias automáticas de la plataforma copian el fichero en caliente y pueden pillar una escritura a medias | La aplicación hace una copia consistente diaria con `VACUUM INTO` en `/home/data/backups` (14 días de retención), que también entra en las copias de la plataforma. |
| TLS termina en el balanceador y la app recibe HTTP | `TRUST_PROXY=1` y `COOKIE_SECURE=1`: Express reconoce `X-Forwarded-Proto` y la cookie de sesión se marca `Secure`. |
| App Service añade el puerto a `X-Forwarded-For` (`1.2.3.4:51234`), lo que anulaba el bloqueo por intentos fallidos de login | Se quita el puerto antes de calcular la clave del bloqueo. Hay un test que lo cubre. |
| Una contraseña generada al azar quedaría escrita en los logs | En producción el primer usuario de Dirección se crea con `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Sin ellas, la app no arranca. |
| `SESSION_SECRET` es obligatorio | En producción la app no arranca sin él. |
| Reinicios y despliegues | Comprobación de estado en `/healthz` y cierre ordenado con `SIGTERM`. Un despliegue implica unos segundos sin servicio, aceptable para este uso. |
| SQLite en Node está marcado como experimental | Funciona en Node 22 y 24 (los tests de CI se ejecutan en ambos). Node 22 deja de tener soporte en abril de 2027, por eso Azure usa Node 24 LTS. |

## Arquitectura desplegada

```
                    HTTPS (TLS 1.2+, certificado gestionado)
Familias / Profesorado / Dirección ──────────────► Azure App Service (Linux, Node 24 LTS, 1 instancia)
                                                     │  /home/site/wwwroot  ← paquete de solo lectura
                                                     │  /home/data/colegio.db  ← SQLite (modo DELETE)
                                                     │  /home/data/backups/    ← copias diarias consistentes
                                                     ├── Copias automáticas de App Service (cada hora, 30 días)
                                                     ├── Logs → Log Analytics (30 días)
                                                     └── Alerta si /healthz falla → email
GitHub Actions ──(OIDC, sin contraseñas)──► identidad gestionada con el rol «Website Contributor», limitado a la web app
```

Medidas de seguridad de la infraestructura:

- Solo HTTPS, TLS 1.2 como mínimo, FTP desactivado.
- Credenciales básicas de publicación (FTP y Kudu con usuario y contraseña) desactivadas: solo Microsoft Entra ID.
- GitHub despliega con una credencial federada (OIDC). No hay secretos de Azure guardados en GitHub, y la identidad solo puede desplegar en esta web app.

## Pasos de despliegue

### Requisitos

- Suscripción de Azure. Para crear la asignación de rol, la cuenta debe tener el rol *Owner* o *User Access Administrator* sobre el grupo de recursos.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.60 o superior, con Bicep (`az bicep install`).
- Permisos de administrador en el repositorio de GitHub.

### 1. Crear la infraestructura

```bash
az login
az group create --name rg-crm-colegio --location spaincentral   # o westeurope

# Edita infra/main.bicepparam (adminEmail, emailAlertas, repositorioGithub) y define los secretos:
export CRM_SESSION_SECRET="$(openssl rand -base64 48)"
export CRM_ADMIN_PASSWORD='una-contraseña-inicial-larga'

az deployment group create \
  --resource-group rg-crm-colegio \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --query properties.outputs
```

La salida incluye `url`, `AZURE_WEBAPP_NAME`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` y `AZURE_SUBSCRIPTION_ID`.

> Guarda `CRM_SESSION_SECRET` en un gestor de contraseñas: si vuelves a ejecutar el despliegue con otro valor, se cerrarán las sesiones abiertas (no se pierde ningún dato).

### 2. Conectar GitHub Actions

En GitHub, entra en **Settings → Environments → New environment** y crea `production`. Es recomendable añadir *Required reviewers* para aprobar cada despliegue.

Después, en **Settings → Secrets and variables → Actions → Variables**, crea estas variables. Son identificadores, no secretos:

| Variable | Valor |
|---|---|
| `AZURE_WEBAPP_NAME` | salida `AZURE_WEBAPP_NAME` |
| `AZURE_CLIENT_ID` | salida `AZURE_CLIENT_ID` |
| `AZURE_TENANT_ID` | salida `AZURE_TENANT_ID` |
| `AZURE_SUBSCRIPTION_ID` | salida `AZURE_SUBSCRIPTION_ID` |

Mientras `AZURE_WEBAPP_NAME` no exista, el workflow solo ejecuta los tests y no intenta desplegar.

### 3. Desplegar

Haz *merge* en `main`, o ejecuta el workflow a mano desde **Actions → CI / Despliegue en Azure → Run workflow**. Al terminar, comprueba que `https://<app>.azurewebsites.net/healthz` responde `{"estado":"ok"}`.

### 4. Primer acceso

1. Entra con `adminEmail` y la contraseña inicial, y cámbiala en **Mi perfil**.
2. Crea el profesorado, las clases, el alumnado y las familias desde la propia aplicación. **No ejecutes `npm run seed` en producción**, porque borra los datos.
3. Opcional: borra la contraseña inicial de la configuración. Solo se usa si la base de datos está vacía.
   ```bash
   az webapp config appsettings delete -g rg-crm-colegio -n <app> --setting-names ADMIN_PASSWORD
   ```
   Si vuelves a desplegar el Bicep, el valor se repone. No es grave, porque con datos existentes no tiene efecto.

### 5. Dominio propio (recomendado)

```bash
az webapp config hostname add -g rg-crm-colegio --webapp-name <app> --hostname crm.micolegio.es
az webapp config ssl create -g rg-crm-colegio -n <app> --hostname crm.micolegio.es   # certificado gratuito gestionado
az webapp config ssl bind -g rg-crm-colegio -n <app> --certificate-thumbprint <huella> --ssl-type SNI
```

Antes de esto, crea en el DNS el registro `CNAME crm → <app>.azurewebsites.net` y el registro TXT `asuid.crm` que indica el portal.

## Copias de seguridad y restauración

Hay tres capas de copias:

1. **Copias de la aplicación:** se hacen cada día en `/home/data/backups` con `VACUUM INTO`, que garantiza una copia coherente, y se guardan 14 días (`BACKUP_RETENTION_DAYS`). Para hacer una copia a mano, entra por SSH (Portal → la web app → *SSH*) y ejecuta:
   ```bash
   cd /home/site/wwwroot && DB_PATH=/home/data/colegio.db BACKUP_DIR=/home/data/backups SQLITE_JOURNAL_MODE=DELETE node src/backup.js
   ```
2. **Copias automáticas de App Service:** se hacen cada hora sobre todo `/home` y se guardan 30 días. Vienen incluidas en el plan Basic y superiores, sin configurar nada. Están en el mismo centro de datos, así que **no sirven como plan de recuperación ante desastres**.
3. **Copia fuera del centro de datos (recomendada):** en el portal, ve a **Backups → Configure custom backups**, elige una cuenta de almacenamiento (mejor con redundancia geográfica, *GRS*) y programa una copia diaria. Alternativa: descargar periódicamente una copia de `/home/data/backups`.

**Restaurar una copia de la aplicación.** Hazlo con la aplicación detenida, para que no haya escrituras durante el cambio:

1. Detén la aplicación: `az webapp stop -g rg-crm-colegio -n <app>`.
2. Abre la consola Kudu en `https://<app>.scm.<región>.azurewebsites.net` (inicia sesión con tu cuenta de Entra ID) → *Bash*. La consola Kudu se ejecuta en un contenedor aparte y tiene acceso a `/home` aunque la app esté detenida. Allí:
   ```bash
   cp /home/data/colegio.db /home/data/colegio.db.antes-de-restaurar
   cp /home/data/backups/colegio-AAAA-MM-DDT....db /home/data/colegio.db
   rm -f /home/data/colegio.db-journal
   ```
3. Arranca la aplicación: `az webapp start -g rg-crm-colegio -n <app>`.

**Restaurar una copia automática de App Service:** en el portal, ve a **Backups**, elige la copia y pulsa **Restore**. También se puede hacer con `az webapp config snapshot restore`.

## Protección de datos (RGPD / LOPDGDD)

Para un colegio, Azure es apto si se configura y documenta bien:

- **Región:** usa una región de la UE (`spaincentral` en Madrid o `westeurope`). Microsoft se acoge a la *EU Data Boundary* y firma el *Data Protection Addendum* (DPA) como encargado del tratamiento.
- **Cifrado:** los datos se cifran en reposo (Azure Storage) y en tránsito (TLS 1.2 o superior).
- **Datos sensibles:** la aplicación trata **datos de menores y de salud** (alergias, medicación), que son categoría especial según el art. 9 del RGPD. Se recomienda hacer una **Evaluación de Impacto (EIPD)** y consultar al Delegado de Protección de Datos del centro antes de cargar datos reales.
- **Logs:** los registros HTTP en Log Analytics guardan IPs y URLs durante 30 días. Inclúyelos en el Registro de Actividades de Tratamiento, o desactiva la categoría `AppServiceHTTPLogs` si no se necesitan.
- **Accesos:** limita quién tiene acceso a la suscripción y al grupo de recursos (control de acceso de Azure). Quien tenga el rol *Contributor* en la web app puede leer la base de datos.

## Operación

- **Logs en directo:** `az webapp log tail -g rg-crm-colegio -n <app>`. También se pueden consultar con *Log Analytics → Logs* (`AppServiceConsoleLogs`).
- **Alertas:** se envía un email a `emailAlertas` si `/healthz` falla durante 15 minutos.
- **Errores típicos al arrancar** (aparecen en el log):
  - `SESSION_SECRET` no definido.
  - `ADMIN_EMAIL` o `ADMIN_PASSWORD` no definidos con la base de datos vacía.
- **Actualizar la infraestructura:** vuelve a ejecutar el `az deployment group create` del paso 1. No toca la base de datos.

## Evolución

Si en el futuro el centro necesita **varias instancias**, **alta disponibilidad entre zonas** o **restaurar a un momento concreto**, el siguiente paso es migrar a **Azure Database for PostgreSQL – Flexible Server**. Toda la capa de datos está en `src/db.js` con SQL estándar, así que el cambio se limita a:

- sustituir el controlador;
- adaptar unas pocas funciones específicas de SQLite (`datetime('now')`, `group_concat`, `ON CONFLICT`).

Con eso ya se podría activar el escalado horizontal.
