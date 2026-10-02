#!/usr/bin/env bash
# =============================================================================
#  Despliegue completo del CRM escolar de colegio.mezquitacentral.org en Azure
#
#  Crea (o actualiza) todo lo necesario y publica el CRM, con el mismo esquema
#  que VillaDelCasar y la tienda de la fundación (Web App Linux Node 22 +
#  startup.sh):
#    grupo de recursos · App Service · alerta de disponibilidad ·
#    identidad de despliegue para GitHub · código · usuario de Dirección
#
#  Uso (Azure Cloud Shell en modo Bash, o Linux/macOS/WSL con Azure CLI,
#  Node.js 22.13+ y zip):
#      az login                       # no hace falta en Cloud Shell
#      ./infra/deploy.sh
#
#  Se puede volver a ejecutar cuando se quiera: actualiza la infraestructura y
#  publica el código actual. Nunca borra la base de datos.
#
#  Opciones por variable de entorno (todas opcionales):
#      RESOURCE_GROUP   (rg-colegio-mezquita)  LOCATION (spaincentral; si no
#                       admite clientes nuevos se prueban otras regiones)
#      PREFIX           (colegiomezquita)      APP_SKU  (B1)
#      SHARE_PLAN_WITH_APP  nombre de otra Web App (p. ej. villadelcasar) cuyo
#                       plan se reutiliza en vez de crear uno nuevo
#      ADMIN_EMAIL      (direccion@colegio.mezquitacentral.org)
#      ALERT_EMAIL      (= ADMIN_EMAIL; vacío para no recibir avisos)
#      CUSTOM_DOMAIN    dominio propio que se vinculará con bind-domain.sh
#      GITHUB_REPO      (sinanod/CRM) repositorio que despliega por OIDC
#      DEPLOY_CODE      true/false: subir el código desde aquí (por defecto,
#                       false si GitHub Actions ya está configurado para la app)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
STATE_FILE="infra/.deploy.env"   # contraseñas generadas (no se sube a git)

# Valores guardados de una ejecución anterior (reutiliza las contraseñas).
# Una variable pasada en la línea de comandos tiene prioridad sobre la guardada.
if [[ -f "$STATE_FILE" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_]+$ ]] || continue
    if [[ -z "${!key:-}" ]]; then
      value="${value#\'}"; value="${value%\'}"
      printf -v "$key" '%s' "$value"
    fi
  done < "$STATE_FILE"
fi

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-colegio-mezquita}"
LOCATION="${LOCATION:-spaincentral}"
PREFIX="${PREFIX:-colegiomezquita}"
APP_SKU="${APP_SKU:-B1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-direccion@colegio.mezquitacentral.org}"
ALERT_EMAIL="${ALERT_EMAIL-$ADMIN_EMAIL}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"
SHARE_PLAN_WITH_APP="${SHARE_PLAN_WITH_APP:-}"
GITHUB_REPO="${GITHUB_REPO:-sinanod/CRM}"

genpass() { # $1 caracteres: letras y números, más "A9" para cumplir cualquier política
  echo "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-22}")A9"
}
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(genpass 22)}"
SESSION_SECRET="${SESSION_SECRET:-$(genpass 62)}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
step "Comprobando Azure CLI"
command -v az >/dev/null || fail "Instale Azure CLI (https://aka.ms/azcli) o use Azure Cloud Shell."
az account show >/dev/null 2>&1 || fail "Inicie sesión con: az login"
az bicep install >/dev/null 2>&1 || true
echo "Suscripción: $(az account show --query name -o tsv)"

step "Guardando la configuración en $STATE_FILE"
umask 077
save_state() {
  cat > "$STATE_FILE" <<EOS
RESOURCE_GROUP='$RESOURCE_GROUP'
LOCATION='$LOCATION'
PREFIX='$PREFIX'
APP_SKU='$APP_SKU'
ADMIN_EMAIL='$ADMIN_EMAIL'
ALERT_EMAIL='$ALERT_EMAIL'
CUSTOM_DOMAIN='$CUSTOM_DOMAIN'
SHARE_PLAN_WITH_APP='$SHARE_PLAN_WITH_APP'
GITHUB_REPO='$GITHUB_REPO'
ADMIN_PASSWORD='$ADMIN_PASSWORD'
SESSION_SECRET='$SESSION_SECRET'
EOS
}
save_state

step "Registrando los proveedores de recursos de Azure (solo tarda la primera vez)"
for ns in Microsoft.Web Microsoft.Insights Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait >/dev/null
done

EXISTING_PLAN_ID=""
if [[ -n "$SHARE_PLAN_WITH_APP" ]]; then
  step "Buscando el plan de App Service de '$SHARE_PLAN_WITH_APP' para compartirlo"
  EXISTING_PLAN_ID="$(az webapp list --query "[?name=='$SHARE_PLAN_WITH_APP'].serverFarmId | [0]" -o tsv)"
  [[ -n "$EXISTING_PLAN_ID" ]] || fail "No encuentro la Web App '$SHARE_PLAN_WITH_APP' en esta suscripción."
  LOCATION="$(az appservice plan show --ids "$EXISTING_PLAN_ID" --query location -o tsv | tr -d ' ' | tr '[:upper:]' '[:lower:]')"
  # Azure exige que la Web App esté en el mismo grupo de recursos que su plan.
  RESOURCE_GROUP="$(az appservice plan show --ids "$EXISTING_PLAN_ID" --query resourceGroup -o tsv)"
  save_state
  echo "Plan: $EXISTING_PLAN_ID ($LOCATION). El CRM se crea en el grupo $RESOURCE_GROUP."
  echo "Aviso: un plan B1 tiene 1,75 GB de RAM para todas las webs que lo comparten; si va justo, suba a B2."
fi

# El grupo solo guarda metadatos: si ya existe (aunque sea en otra región) se
# reutiliza; los recursos se crean en la región elegida más abajo.
if [[ -z "$SHARE_PLAN_WITH_APP" && "$(az group exists -n "$RESOURCE_GROUP")" != "true" ]]; then
  step "Creando el grupo de recursos $RESOURCE_GROUP ($LOCATION)"
  az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none
fi

step "Creando la infraestructura (2-5 minutos la primera vez)"
# Algunas regiones no admiten clientes nuevos en ciertas suscripciones
# ("not accepting new customers"). Si pasa, se prueba la siguiente región.
# Con plan compartido la región es la del plan y no se puede cambiar.
REGIONS=("$LOCATION")
if [[ -z "$SHARE_PLAN_WITH_APP" ]]; then
  for r in ${FALLBACK_LOCATIONS:-spaincentral francecentral northeurope swedencentral germanywestcentral italynorth westeurope}; do
    [[ "$r" == "$LOCATION" ]] || REGIONS+=("$r")
  done
fi

DEPLOYED=""
ERR_FILE="$(mktemp)"
for REGION in "${REGIONS[@]}"; do
  echo "Región: $REGION"
  DEPLOYMENT="crm-$(date +%Y%m%d%H%M%S)"
  if az deployment group create -g "$RESOURCE_GROUP" -n "$DEPLOYMENT" \
    -f infra/main.bicep \
    -p location="$REGION" prefix="$PREFIX" appServiceSku="$APP_SKU" existingPlanId="$EXISTING_PLAN_ID" \
       adminEmail="$ADMIN_EMAIL" adminPassword="$ADMIN_PASSWORD" sessionSecret="$SESSION_SECRET" \
       repositorioGithub="$GITHUB_REPO" emailAlertas="$ALERT_EMAIL" \
    -o none 2>"$ERR_FILE"; then
    DEPLOYED="$REGION"
    break
  fi
  if grep -qiE "not accepting new customers|RequestDisallowedByAzure|LocationIsOfferRestricted|locationineligible|SkuNotAvailable|NoRegisteredProviderFound|not available in (the )?(location|region)" "$ERR_FILE"; then
    echo "  La región $REGION no está disponible para esta suscripción; pruebo otra."
    continue
  fi
  cat "$ERR_FILE" >&2
  fail "El despliegue ha fallado (ver el error de arriba)."
done
if [[ -z "$DEPLOYED" ]]; then
  cat "$ERR_FILE" >&2
  fail "Ninguna región admite los recursos. Pruebe con FALLBACK_LOCATIONS=\"<regiones>\" o revise las restricciones de la suscripción."
fi
rm -f "$ERR_FILE"
LOCATION="$DEPLOYED"
save_state
echo "Infraestructura creada en $LOCATION"

out() { az deployment group show -g "$RESOURCE_GROUP" -n "$DEPLOYMENT" --query "properties.outputs.$1.value" -o tsv; }
APP_NAME="$(out appName)"
APP_HOST="$(out appDefaultHostname)"
VERIFICATION_ID="$(out customDomainVerificationId)"
GH_CLIENT_ID="$(out githubClientId)"
GH_TENANT_ID="$(out tenantId)"
GH_SUBSCRIPTION_ID="$(out subscriptionId)"

# Variables que usa .github/workflows/ci-cd.yml (identificadores, no secretos).
# Si la CLI de GitHub está disponible y con sesión iniciada, se configuran solas.
GITHUB_READY=false
if [[ -n "$GITHUB_REPO" ]]; then
  step "Configurando el despliegue continuo desde GitHub ($GITHUB_REPO)"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    gh api -X PUT "repos/$GITHUB_REPO/environments/production" >/dev/null
    gh variable set AZURE_WEBAPP_NAME --repo "$GITHUB_REPO" --body "$APP_NAME"
    gh variable set AZURE_CLIENT_ID --repo "$GITHUB_REPO" --body "$GH_CLIENT_ID"
    gh variable set AZURE_TENANT_ID --repo "$GITHUB_REPO" --body "$GH_TENANT_ID"
    gh variable set AZURE_SUBSCRIPTION_ID --repo "$GITHUB_REPO" --body "$GH_SUBSCRIPTION_ID"
    GITHUB_READY=true
    echo "Variables de GitHub configuradas: cada push a main desplegará solo."
  else
    echo "La CLI de GitHub (gh) no tiene sesión iniciada: configure las variables a mano (ver el resumen final)."
  fi
fi

# Si GitHub Actions ya despliega esta Web App, no se sube el código desde aquí:
# dos despliegues simultáneos hacen que Kudu rechace uno (error 400/409).
# Forzar con DEPLOY_CODE=true.
if [[ -z "${DEPLOY_CODE:-}" ]]; then
  if [[ "$GITHUB_READY" == "true" ]] && \
     gh run list --repo "$GITHUB_REPO" --workflow ci-cd.yml --branch main --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null | grep -qx success; then
    DEPLOY_CODE=false
  else
    DEPLOY_CODE=true
  fi
fi

if [[ "$DEPLOY_CODE" == "true" ]]; then
  command -v node >/dev/null || fail "Hace falta Node.js 22.13 o superior (Cloud Shell ya lo trae)."
  command -v zip >/dev/null || fail "Hace falta el comando zip."
  step "Generando el paquete (1-2 minutos, incluye las pruebas)"
  PACKAGE="$(mktemp -d)/crm.zip"
  scripts/build-package.sh "$PACKAGE"

  step "Subiendo el código al App Service $APP_NAME"
  az webapp deploy -g "$RESOURCE_GROUP" -n "$APP_NAME" --src-path "$PACKAGE" \
    --type zip --clean true --restart true --timeout 900000 -o none
  rm -f "$PACKAGE"
else
  step "El código lo publica GitHub Actions (.github/workflows/ci-cd.yml)"
  echo "Haga push a main, o lance el workflow a mano en GitHub → Actions."
fi

step "Esperando a que el CRM arranque (el primer arranque crea la base de datos y el usuario de Dirección)"
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$APP_HOST/healthz" || true)"
  if [[ "$code" == "200" ]]; then echo "El CRM responde."; break; fi
  printf '.'; sleep 15
  if [[ "$i" == 40 ]]; then
    echo; echo "El CRM todavía no responde. Revise los registros con:"
    echo "  ./infra/diagnose.sh      o      az webapp log tail -g $RESOURCE_GROUP -n $APP_NAME"
  fi
done

if [[ -n "$CUSTOM_DOMAIN" ]]; then
  DOMAIN_HINT="$CUSTOM_DOMAIN"; SUB="${CUSTOM_DOMAIN%%.*}"
else
  DOMAIN_HINT="<dominio>"; SUB="<subdominio>"
fi

cat <<FIN

=============================================================================
 CRM ESCOLAR DESPLEGADO
=============================================================================
 Web:             https://$APP_HOST
   Usuario:       $ADMIN_EMAIL
   Contraseña:    $ADMIN_PASSWORD   (guardada en $STATE_FILE)
   Cámbiela en "Mi perfil" tras el primer acceso.

 GITHUB ACTIONS ($GITHUB_REPO)
FIN
if [[ "$GITHUB_READY" == "true" ]]; then
  echo "   Configurado: cada push a main prueba y despliega el CRM."
else
  cat <<FIN
   GitHub → Settings → Secrets and variables → Actions → Variables:
     AZURE_WEBAPP_NAME      = $APP_NAME
     AZURE_CLIENT_ID        = $GH_CLIENT_ID
     AZURE_TENANT_ID        = $GH_TENANT_ID
     AZURE_SUBSCRIPTION_ID  = $GH_SUBSCRIPTION_ID
FIN
fi
cat <<FIN

 DOMINIO PROPIO (opcional, p. ej. crm.<su-dominio>)
   1. En el DNS del dominio cree:
        CNAME  $SUB        ->  $APP_HOST
        TXT    asuid.$SUB  ->  $VERIFICATION_ID
   2. Cuando el DNS esté propagado, ejecute:  ./infra/bind-domain.sh $DOMAIN_HINT
=============================================================================
FIN
