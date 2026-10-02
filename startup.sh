#!/bin/sh
# Comando de arranque para Azure App Service (Linux, Node 22).
#
# Se ejecuta como "bash startup.sh" con /home/site/wwwroot como directorio de
# trabajo. El paquete llega YA preparado (scripts/build-package.sh, desde el
# workflow de GitHub o infra/deploy.sh), con node_modules incluido. Si falta
# algo se falla enseguida con un mensaje claro en el registro.
set -e
cd "$(dirname "$0")"

echo "== startup.sh: directorio actual: $(pwd) =="

missing=""
[ -f node_modules/express/package.json ] || missing="$missing node_modules"
[ -f src/server.js ] || missing="$missing src/server.js"
[ -d views ] || missing="$missing views"
if [ -n "$missing" ]; then
  echo "== startup.sh: ERROR: el paquete desplegado está incompleto (falta:$missing)."
  echo "== Despliegue el paquete de scripts/build-package.sh (workflow de GitHub o infra/deploy.sh)."
  exit 1
fi

echo "== startup.sh: Node $(node --version), base de datos en ${DB_PATH:-data/colegio.db} =="
echo "== startup.sh: arrancando el CRM en el puerto ${PORT:-8080} =="
export NODE_ENV=production
exec node --disable-warning=ExperimentalWarning src/server.js
