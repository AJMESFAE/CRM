# Despliegue en Azure

El CRM se despliega igual que **Villa del Casar** y la **tienda de la Fundación**:

- **Web App Linux** con runtime **Node 22** (sin contenedor), que arranca con `bash startup.sh`.
- La base de datos vive en el almacenamiento persistente `/home`, fuera del código.
- Un único script, `infra/deploy.sh`, que se ejecuta desde **Azure Cloud Shell**, crea o actualiza todo y publica el código.
- A partir de ahí, **cada push a `main` despliega solo** con GitHub Actions.

| | |
|---|---|
| Usuario principal (Dirección) | `direccion@colegio.mezquitacentral.org` |
| Grupo de recursos | `rg-colegio-mezquita` (o el de Villa del Casar si se comparte su plan) |
| Región | `spaincentral`. Si la suscripción no la admite, el script prueba otras regiones de la UE. |
| Plan | B1 propio (unos 13 €/mes), o **el plan de Villa del Casar compartido (0 € extra)** |
| Base de datos | SQLite en `/home/colegio/colegio.db` |

## Ficheros

| Fichero | Para qué sirve |
|---|---|
| `infra/deploy.sh` | Despliegue completo. Se puede volver a ejecutar siempre que se quiera y nunca borra datos. |
| `infra/main.bicep` | Infraestructura: Web App, alerta de disponibilidad e identidad de despliegue para GitHub. Lo usa `deploy.sh`. |
| `infra/bind-domain.sh` | Vincula un dominio propio con certificado HTTPS gratuito. |
| `infra/diagnose.sh` | Muestra el estado, la configuración (sin secretos), la respuesta de `/healthz` y los últimos registros. |
| `infra/restore-state.sh` | Regenera `infra/.deploy.env` desde Azure, por si Cloud Shell perdió la carpeta. |
| `infra/destroy.sh` | Borra los recursos del CRM. Con el plan compartido, no toca la otra web. |
| `scripts/build-package.sh` | Genera el ZIP que se sube: instala dependencias, pasa las pruebas y quita las de desarrollo. |
| `startup.sh` | Comando de arranque en App Service. |
| `.github/workflows/ci-cd.yml` | Pruebas en cada PR. Despliegue automático desde `main`. |

## Despliegue (primera vez)

1. Abre **Azure Cloud Shell** en modo *Bash* (https://shell.azure.com) con la cuenta de la suscripción.
2. Clona el repositorio y ejecuta el script:

   ```bash
   git clone https://github.com/AJMESFAE/CRM.git && cd CRM
   ./infra/deploy.sh
   ```

   Para **compartir el plan de Villa del Casar** en lugar de crear uno nuevo, igual que se puede hacer con la tienda:

   ```bash
   SHARE_PLAN_WITH_APP=villadelcasar ./infra/deploy.sh
   ```

   El CRM ocupa poca memoria (unos 60 MB), pero un plan B1 tiene 1,75 GB de RAM para todas las webs que lo comparten. Si la tienda también lo usa y va justo, sube el plan a B2.

3. El script hace lo siguiente:
   - genera la contraseña inicial de Dirección y el secreto de sesión, y los guarda en `infra/.deploy.env`. Ese fichero no se sube a Git y tiene permisos `600`;
   - crea la infraestructura;
   - genera y sube el paquete;
   - espera a que `/healthz` responda;
   - muestra un **resumen** con la URL, el usuario `direccion@colegio.mezquitacentral.org`, su contraseña, las variables de GitHub y los registros DNS.
4. Entra en la web con ese usuario y **cambia la contraseña** en *Mi perfil*. Después da de alta al profesorado, las clases, el alumnado y las familias.

Opciones de `deploy.sh` (por variable de entorno, todas opcionales): `RESOURCE_GROUP`, `LOCATION`, `PREFIX`, `APP_SKU`, `SHARE_PLAN_WITH_APP`, `ADMIN_EMAIL`, `ALERT_EMAIL` (recibe un email si la web cae; por defecto, el de Dirección), `GITHUB_REPO` y `DEPLOY_CODE`. Están documentadas en la cabecera del script.

## Despliegue continuo desde GitHub

El workflow `.github/workflows/ci-cd.yml` sigue el mismo esquema que el de la tienda:

1. Prepara el paquete en GitHub con `scripts/build-package.sh`.
2. Lo guarda como artefacto.
3. Lo sube a la Web App con `azure/webapps-deploy` y `clean: true`.
4. Comprueba que `/healthz` responde.

Dos despliegues nunca se ejecutan a la vez.

El acceso a Azure es por **OIDC, como en Villa del Casar**, sin contraseñas guardadas en GitHub. El Bicep crea una identidad con permiso solo para desplegar en esta Web App. Faltan estas cuatro variables del repositorio (son identificadores, no secretos):

| Variable | Valor |
|---|---|
| `AZURE_WEBAPP_NAME` | nombre de la Web App (`colegiomezquita-app-…`) |
| `AZURE_CLIENT_ID` | identidad de despliegue |
| `AZURE_TENANT_ID` | inquilino de Azure |
| `AZURE_SUBSCRIPTION_ID` | suscripción |

- Si en Cloud Shell está iniciada la sesión de la CLI de GitHub (`gh auth login`), `deploy.sh` las configura solo.
- Si no, copia los valores del resumen final en **GitHub → Settings → Secrets and variables → Actions → Variables**.
- Mientras no existan, el workflow solo ejecuta las pruebas.

> No hace falta usar el *Deployment Center* del portal: crearía un segundo workflow que competiría con este.

## Dominio propio

1. Elige el subdominio (por ejemplo `crm.<dominio-del-colegio>`). En el DNS crea los dos registros que indica el resumen de `deploy.sh`:
   - `CNAME <subdominio> → <app>.azurewebsites.net`
   - `TXT asuid.<subdominio> → <id de verificación>`
2. Cuando el DNS se haya propagado, ejecuta `./infra/bind-domain.sh crm.<dominio-del-colegio>`. El script añade el dominio, crea el certificado gestionado gratuito y activa HTTPS.

## Operación del día a día

- **Actualizar el CRM:** basta con hacer push a `main`. Para volver a desplegar a mano, ejecuta `DEPLOY_CODE=true ./infra/deploy.sh`.
- **Ver qué pasa:** `./infra/diagnose.sh`, o los registros en directo con `az webapp log tail -g <grupo> -n <app>`.
- **Errores típicos al arrancar** (aparecen en el registro):
  - *«el paquete desplegado está incompleto»*: se ha desplegado algo que no es el ZIP de `build-package.sh`.
  - *«SESSION_SECRET…»* o *«ADMIN_PASSWORD…»*: falta configuración. Ejecuta `deploy.sh` de nuevo.
- **Recuperar `infra/.deploy.env`:** `./infra/restore-state.sh`.

## Copias de seguridad

1. **Copias diarias del propio CRM** en `/home/colegio/backups`. Se hacen con `VACUUM INTO`, que siempre da una copia coherente, y se guardan 14 días.
2. **Copias automáticas de App Service:** cada hora, de todo `/home`, guardadas 30 días. Vienen incluidas en el plan B1 sin configurar nada. Están en el mismo centro de datos, así que no sirven ante un desastre regional.
3. **Copia fuera de Azure (recomendada):** descarga de vez en cuando la última copia desde la consola Kudu (`https://<app>.scm.azurewebsites.net` → *Bash* → `/home/colegio/backups`), o configura *Backups → Custom backups* hacia una cuenta de almacenamiento con redundancia geográfica.

**Restaurar una copia del CRM:**

1. Detén la web: `az webapp stop -g <grupo> -n <app>`.
2. Abre la consola Kudu (*Bash*). Sigue disponible con la web detenida. Ejecuta:
   ```bash
   cp /home/colegio/colegio.db /home/colegio/colegio.db.antes-de-restaurar
   cp /home/colegio/backups/colegio-AAAA-MM-DDT....db /home/colegio/colegio.db
   rm -f /home/colegio/colegio.db-journal
   ```
3. Arranca la web: `az webapp start -g <grupo> -n <app>`.

## Por qué este esquema es viable

- **Persistencia:** `/home` es persistente. Sobrevive a reinicios y despliegues, y el ZIP con `clean: true` solo reemplaza `/home/site/wwwroot`. La base de datos está en `/home/colegio`, aparte de otras webs y paquetes, así que desplegar nunca borra datos.
- **Volumen:** un colegio genera poco. Incluso con 1.000 alumnos son menos de 200.000 registros al año.
- **Sin compilación en Azure:** no hay módulos nativos (`bcryptjs` es JavaScript puro y SQLite viene en Node). El paquete se prepara en GitHub o en Cloud Shell y Azure no compila nada.
- **SQLite sobre almacenamiento de red:** `/home` está en Azure Storage, y ahí SQLite debe usar el modo `DELETE` en lugar de WAL (`SQLITE_JOURNAL_MODE=DELETE`, ya configurado).
- **Una sola instancia:** el plan se crea con una instancia. **No actives el escalado horizontal**, porque dos instancias escribiendo en el mismo fichero lo corromperían. Si algún día hace falta, habría que migrar a PostgreSQL, como la tienda.
- **Proxy de Azure:**
  - `TRUST_PROXY=1` y `COOKIE_SECURE=1` hacen que la cookie de sesión sea `Secure`.
  - Azure añade el puerto a `X-Forwarded-For`, y la app lo quita para que el bloqueo por intentos fallidos de login funcione.
- **Seguridad:** solo HTTPS con TLS 1.2 o superior, FTP y credenciales básicas de publicación desactivados, y despliegue con Microsoft Entra ID/OIDC.
- **Node 22:** es el mismo runtime que Villa del Casar y la tienda, y el CRM también se prueba en Node 24. Node 22 deja de tener soporte en abril de 2027. Para cambiar de versión basta con editar `linuxFxVersion` en `infra/main.bicep` y la versión en el workflow.

## Protección de datos (RGPD / LOPDGDD)

- **Región y contrato:** los recursos quedan en una región de la UE. Microsoft actúa como encargado del tratamiento (*Data Protection Addendum*, *EU Data Boundary*).
- **Datos sensibles:** el CRM trata **datos de menores y de salud** (alergias, medicación), que son categoría especial según el art. 9 del RGPD. Antes de cargar datos reales:
  - hay que hacer la **Evaluación de Impacto (EIPD)**;
  - hay que consultar al Delegado de Protección de Datos.
- **Registros:** los de acceso HTTP (IP y URL) se guardan **7 días** en `/home/LogFiles`. Hay que incluirlos en el Registro de Actividades de Tratamiento.
- **Accesos a Azure:** limita quién tiene acceso a la suscripción. Quien tenga permisos sobre la Web App puede leer la base de datos.
