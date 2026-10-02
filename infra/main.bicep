// Infraestructura Azure del CRM escolar (colegio.mezquitacentral.org)
//
// Normalmente no se usa directamente: lo ejecuta `infra/deploy.sh`.
//
// Mismo esquema que VillaDelCasar y la tienda de la fundación: Web App Linux
// con runtime Node 22 (sin contenedor), arrancada con `startup.sh`. La base de
// datos es SQLite y vive en el almacenamiento persistente /home de App Service,
// fuera del código: desplegar de nuevo nunca borra los datos.

@description('Prefijo corto para los nombres de recursos (minúsculas, sin guiones)')
@minLength(3)
@maxLength(20)
param prefix string = 'colegiomezquita'
param location string = resourceGroup().location

@description('Plan de App Service. B1 basta para un colegio.')
param appServiceSku string = 'B1'

@description('ID de un plan de App Service Linux ya existente para compartirlo (p. ej. el de VillaDelCasar). Vacío = crear uno nuevo. Debe estar en la misma región.')
param existingPlanId string = ''

@description('Usuario principal de Dirección (se crea en el primer arranque)')
param adminEmail string = 'direccion@colegio.mezquitacentral.org'
@secure()
@minLength(12)
param adminPassword string

@description('Secreto para firmar las cookies de sesión (mínimo 32 caracteres)')
@secure()
@minLength(32)
param sessionSecret string

@description('Repositorio de GitHub (propietario/repo) que despliega por OIDC, sin contraseñas. Vacío = no crear la identidad.')
param repositorioGithub string = 'sinanod/CRM'
@description('Entorno de GitHub Actions autorizado a desplegar')
param entornoGithub string = 'production'

@description('Email que recibe un aviso si la web deja de responder. Vacío = sin avisos.')
param emailAlertas string = ''

@description('Días que se guardan las copias diarias de la base de datos')
@minValue(1)
@maxValue(90)
param diasRetencionCopias int = 14

var suffix = uniqueString(resourceGroup().id)
var planName = '${prefix}-plan'
var appName = '${prefix}-app-${suffix}'
// Carpeta propia en /home: no se mezcla con /home/site (código) ni con /home/data (otras apps / paquetes)
var dataDir = '/home/colegio'
// Rol integrado "Website Contributor": permite desplegar en esta Web App y nada más
var rolWebsiteContributor = 'de139f84-1756-47ae-9be6-808fbbe84772'
var crearIdentidadGithub = !empty(repositorioGithub)

resource plan 'Microsoft.Web/serverfarms@2023-01-01' = if (empty(existingPlanId)) {
  name: planName
  location: location
  kind: 'linux'
  // SQLite: una sola instancia. No activar el escalado horizontal.
  sku: { name: appServiceSku, capacity: 1 }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-01-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: empty(existingPlanId) ? plan.id : existingPlanId
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'bash startup.sh'
      alwaysOn: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      healthCheckPath: '/healthz'
      appSettings: [
        // El paquete llega ya preparado (deploy.sh o GitHub Actions): Azure no recompila.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'DB_PATH', value: '${dataDir}/colegio.db' }
        // /home está en Azure Storage (red): el modo WAL de SQLite no es compatible
        { name: 'SQLITE_JOURNAL_MODE', value: 'DELETE' }
        { name: 'BACKUP_DIR', value: '${dataDir}/backups' }
        { name: 'BACKUP_RETENTION_DAYS', value: string(diasRetencionCopias) }
        { name: 'SESSION_SECRET', value: sessionSecret }
        { name: 'ADMIN_EMAIL', value: adminEmail }
        { name: 'ADMIN_PASSWORD', value: adminPassword }
        // Número de proxies delante de la app (Azure App Service = 1)
        { name: 'TRUST_PROXY', value: '1' }
        { name: 'COOKIE_SECURE', value: '1' }
        { name: 'TZ', value: 'Europe/Madrid' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'true' }
      ]
    }
  }
}

// Sin usuario/contraseña de publicación (FTP ni Kudu): solo cuentas de Microsoft Entra ID
resource ftp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-01-01' = {
  parent: app
  name: 'ftp'
  properties: { allow: false }
}

resource scm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-01-01' = {
  parent: app
  name: 'scm'
  properties: { allow: false }
}

// Guarda la salida de la aplicación en /home/LogFiles, para verla con
// `az webapp log tail` o `infra/diagnose.sh`.
resource appLogs 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: app
  name: 'logs'
  properties: {
    applicationLogs: { fileSystem: { level: 'Information' } }
    httpLogs: { fileSystem: { enabled: true, retentionInDays: 7, retentionInMb: 35 } }
    detailedErrorMessages: { enabled: true }
    failedRequestsTracing: { enabled: false }
  }
}

resource grupoAcciones 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(emailAlertas)) {
  name: '${prefix}-avisos'
  location: 'global'
  properties: {
    groupShortName: take(prefix, 12)
    enabled: true
    emailReceivers: [
      { name: 'direccion', emailAddress: emailAlertas, useCommonAlertSchema: true }
    ]
  }
}

// Aviso si la comprobación de estado (/healthz) falla durante 15 minutos
resource alertaSalud 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-alerta-salud'
  location: 'global'
  properties: {
    description: 'El CRM escolar no supera la comprobación de estado /healthz.'
    severity: 1
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'salud'
          metricName: 'HealthCheckStatus'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'LessThan'
          threshold: 100
          timeAggregation: 'Average'
        }
      ]
    }
    actions: empty(emailAlertas) ? [] : [{ actionGroupId: grupoAcciones.id }]
  }
}

// Identidad con la que GitHub Actions despliega (OIDC: sin secretos guardados en GitHub)
resource identidadGithub 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (crearIdentidadGithub) {
  name: '${prefix}-id-github'
  location: location
}

resource credencialGithub 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (crearIdentidadGithub) {
  parent: identidadGithub
  name: 'github-${entornoGithub}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${repositorioGithub}:environment:${entornoGithub}'
    audiences: ['api://AzureADTokenExchange']
  }
}

resource permisoDespliegue 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (crearIdentidadGithub) {
  name: guid(app.id, repositorioGithub, rolWebsiteContributor)
  scope: app
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', rolWebsiteContributor)
    principalId: identidadGithub!.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output appName string = app.name
output appDefaultHostname string = app.properties.defaultHostName
output customDomainVerificationId string = app.properties.customDomainVerificationId
output githubClientId string = crearIdentidadGithub ? identidadGithub!.properties.clientId : ''
output tenantId string = tenant().tenantId
output subscriptionId string = subscription().subscriptionId
