#!/usr/bin/env bash
# Diagnóstico del CRM en Azure: estado, configuración de arranque, respuesta
# HTTP, copias de seguridad y últimas líneas del registro de la aplicación.
# Uso: ./infra/diagnose.sh      (pegue la salida completa si pide ayuda)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# shellcheck disable=SC1091
[[ -f infra/.deploy.env ]] && source infra/.deploy.env
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-colegio-mezquita}"
PREFIX="${PREFIX:-colegiomezquita}"
APP_NAME="${APP_NAME:-$(az webapp list -g "$RESOURCE_GROUP" --query "[?starts_with(name, '${PREFIX}-app-')].name | [0]" -o tsv)}"
[[ -n "$APP_NAME" ]] || { echo "No encuentro la Web App en $RESOURCE_GROUP"; exit 1; }

echo "== Web App: $APP_NAME ($RESOURCE_GROUP)"
az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" \
  --query "{estado:state, host:defaultHostName, plan:appServicePlanId}" -o table
echo
echo "== Configuración de arranque"
az webapp config show -g "$RESOURCE_GROUP" -n "$APP_NAME" \
  --query "{runtime:linuxFxVersion, arranque:appCommandLine, alwaysOn:alwaysOn, healthCheck:healthCheckPath}" -o table
echo
echo "== Variables de entorno (sin valores secretos)"
az webapp config appsettings list -g "$RESOURCE_GROUP" -n "$APP_NAME" \
  --query "[].{nombre:name, valor:value}" -o tsv |
  awk -F'\t' '{ v=$2; if ($1 ~ /PASSWORD|SECRET|KEY|CONNECTION/) v="(oculto)"; print "  " $1 " = " v }'
echo
HOST="$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query defaultHostName -o tsv)"
echo "== Respuesta HTTP de https://$HOST/healthz"
curl -s -w "\n  código %{http_code}, %{time_total}s\n" --max-time 60 "https://$HOST/healthz" || echo "  sin respuesta"
echo
echo "== Activando el registro de la aplicación (si no lo estaba)"
az webapp log config -g "$RESOURCE_GROUP" -n "$APP_NAME" \
  --docker-container-logging filesystem --level information -o none
echo
echo "== Descargando registros"
TMP="$(mktemp -d)"
if az webapp log download -g "$RESOURCE_GROUP" -n "$APP_NAME" --log-file "$TMP/logs.zip" -o none 2>/dev/null; then
  (cd "$TMP" && unzip -qo logs.zip)
  # Salida del CRM (startup.sh y Node: *_default_docker.log) y de la
  # plataforma (*_docker.log), los más recientes de cada tipo.
  { find "$TMP" -name '*default_docker.log' -printf '%T@ %p\n' | sort -rn | head -1
    find "$TMP" -name '*docker.log' ! -name '*default_docker.log' -printf '%T@ %p\n' | sort -rn | head -1
  } | cut -d' ' -f2- |
    while read -r f; do
      echo "---- $(basename "$f") (últimas 80 líneas)"
      tail -n 80 "$f"
    done
  echo
  echo "== Últimas copias de seguridad registradas"
  find "$TMP" -name '*default_docker.log' -exec grep -h "Copia de seguridad" {} + 2>/dev/null | tail -n 3 || true
else
  echo "  No se pudieron descargar. Alternativa: az webapp log tail -g $RESOURCE_GROUP -n $APP_NAME"
fi
rm -rf "$TMP"
