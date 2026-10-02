#!/usr/bin/env bash
# =============================================================================
#  Vincula un dominio propio al CRM con certificado HTTPS gratuito
#  (gestionado por Azure).
#
#  Requisito: haber creado en el DNS los registros que indica deploy.sh:
#      CNAME  <subdominio>        -> <app>.azurewebsites.net
#      TXT    asuid.<subdominio>  -> <id de verificación>
#
#  Uso:  ./infra/bind-domain.sh crm.ejemplo.org
#        (sin argumento usa CUSTOM_DOMAIN de infra/.deploy.env)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
STATE_FILE="infra/.deploy.env"
[[ -f "$STATE_FILE" ]] || { echo "Ejecute primero ./infra/deploy.sh (o ./infra/restore-state.sh)"; exit 1; }
# shellcheck disable=SC1090
source "$STATE_FILE"

CUSTOM_DOMAIN="${1:-${CUSTOM_DOMAIN:-}}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN#https://}"; CUSTOM_DOMAIN="${CUSTOM_DOMAIN%%/*}"
[[ -n "$CUSTOM_DOMAIN" ]] || { echo "Indique el dominio, p. ej. ./infra/bind-domain.sh crm.ejemplo.org"; exit 1; }

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

APP_NAME="$(az webapp list -g "$RESOURCE_GROUP" --query "[?starts_with(name, '${PREFIX}-app-')].name | [0]" -o tsv)"
[[ -n "$APP_NAME" ]] || { echo "No se encuentra el App Service en $RESOURCE_GROUP"; exit 1; }

step "Comprobando el DNS de $CUSTOM_DOMAIN"
if command -v nslookup >/dev/null; then
  nslookup -type=CNAME "$CUSTOM_DOMAIN" || echo "Aviso: todavía no se ve el CNAME; si falla, espere a que se propague el DNS."
fi

step "Añadiendo el dominio al App Service"
az webapp config hostname add -g "$RESOURCE_GROUP" --webapp-name "$APP_NAME" \
  --hostname "$CUSTOM_DOMAIN" -o none

step "Creando el certificado gestionado (gratuito) — puede tardar unos minutos"
THUMBPRINT="$(az webapp config ssl create -g "$RESOURCE_GROUP" -n "$APP_NAME" \
  --hostname "$CUSTOM_DOMAIN" --query thumbprint -o tsv)"

step "Activando HTTPS"
az webapp config ssl bind -g "$RESOURCE_GROUP" -n "$APP_NAME" \
  --certificate-thumbprint "$THUMBPRINT" --ssl-type SNI -o none

# Para que futuras ejecuciones de deploy.sh muestren este dominio
if grep -q '^CUSTOM_DOMAIN=' "$STATE_FILE"; then
  sed -i.bak "s|^CUSTOM_DOMAIN=.*|CUSTOM_DOMAIN='$CUSTOM_DOMAIN'|" "$STATE_FILE" && rm -f "$STATE_FILE.bak"
else
  echo "CUSTOM_DOMAIN='$CUSTOM_DOMAIN'" >> "$STATE_FILE"
fi

echo
echo "Listo: https://$CUSTOM_DOMAIN"
