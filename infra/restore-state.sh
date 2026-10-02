#!/usr/bin/env bash
# Regenera infra/.deploy.env a partir de la configuración de la Web App en
# Azure (por ejemplo, si Cloud Shell se reinició y se perdió la carpeta).
# Las contraseñas no se pierden: están en las variables de entorno de la app.
#
# Uso:  ./infra/restore-state.sh [grupo-de-recursos]   (por defecto rg-colegio-mezquita)
set -euo pipefail
cd "$(dirname "$0")/.."
RESOURCE_GROUP="${1:-${RESOURCE_GROUP:-rg-colegio-mezquita}}"
PREFIX="${PREFIX:-colegiomezquita}"
STATE_FILE="infra/.deploy.env"

APP_NAME="$(az webapp list -g "$RESOURCE_GROUP" --query "[?starts_with(name, '${PREFIX}-app-')].name | [0]" -o tsv)"
[[ -n "$APP_NAME" ]] || { echo "No encuentro la Web App en $RESOURCE_GROUP"; exit 1; }
LOCATION="$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query location -o tsv | tr -d ' ' | tr '[:upper:]' '[:lower:]')"
PLAN_ID="$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query serverFarmId -o tsv)"
SKU="$(az appservice plan show --ids "$PLAN_ID" --query sku.name -o tsv)"
PLAN_NAME="${PLAN_ID##*/}"
# Si el plan no es el propio del CRM, es que se comparte con otra web
SHARE_PLAN_WITH_APP=""
if [[ "$PLAN_NAME" != "${PREFIX}-plan" ]]; then
  SHARE_PLAN_WITH_APP="$(az webapp list --query "[?serverFarmId=='$PLAN_ID' && name!='$APP_NAME'].name | [0]" -o tsv)"
fi
DOMAIN="$(az webapp config hostname list -g "$RESOURCE_GROUP" --webapp-name "$APP_NAME" --query "[?!ends_with(name, '.azurewebsites.net')].name | [0]" -o tsv)"
SETTINGS="$(az webapp config appsettings list -g "$RESOURCE_GROUP" -n "$APP_NAME" -o json)"
get() { printf '%s' "$SETTINGS" | python3 -c "import json,sys; d={s['name']:s['value'] for s in json.load(sys.stdin)}; print(d.get('$1',''))"; }

umask 077
cat > "$STATE_FILE" <<EOS
RESOURCE_GROUP='$RESOURCE_GROUP'
LOCATION='$LOCATION'
PREFIX='$PREFIX'
APP_SKU='$SKU'
ADMIN_EMAIL='$(get ADMIN_EMAIL)'
ALERT_EMAIL='$(get ADMIN_EMAIL)'
CUSTOM_DOMAIN='$DOMAIN'
SHARE_PLAN_WITH_APP='$SHARE_PLAN_WITH_APP'
GITHUB_REPO='AJMESFAE/CRM'
ADMIN_PASSWORD='$(get ADMIN_PASSWORD)'
SESSION_SECRET='$(get SESSION_SECRET)'
EOS
echo "Recuperado $STATE_FILE desde $APP_NAME (dominio: ${DOMAIN:-sin dominio propio})."
echo "Dirección: $(get ADMIN_EMAIL)  ·  contraseña inicial: grep ADMIN_PASSWORD $STATE_FILE"
