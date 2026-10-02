// Infraestructura del CRM escolar en Azure App Service (Linux, Node.js 24 LTS).
//
// Despliegue:
//   az group create --name rg-crm-colegio --location spaincentral
//   az deployment group create --resource-group rg-crm-colegio \
//     --template-file infra/main.bicep --parameters infra/main.bicepparam
//
// Ver docs/despliegue-azure.md para el procedimiento completo.

targetScope = 'resourceGroup'

@description('Prefijo de los recursos (minúsculas, números y guiones).')
@minLength(3)
@maxLength(24)
param nombre string = 'crm-colegio'

@description('Región. Para datos de menores se recomienda una región de la UE (spaincentral, westeurope...).')
param location string = resourceGroup().location

@description('Plan de App Service. B1 basta para un colegio; P0v3 o superior añade más CPU/memoria. Siempre 1 instancia (SQLite).')
@allowed(['B1', 'B2', 'B3', 'S1', 'S2', 'P0v3', 'P1v3'])
param sku string = 'B1'

@description('Secreto para firmar las cookies de sesión (mínimo 32 caracteres aleatorios).')
@secure()
@minLength(32)
param sessionSecret string

@description('Email del primer usuario de Dirección (solo se usa si la base de datos está vacía).')
param adminEmail string

@description('Contraseña inicial del primer usuario de Dirección. Cámbiala en "Mi perfil" tras el primer acceso.')
@secure()
@minLength(12)
param adminPassword string

@description('Repositorio de GitHub (propietario/repo) autorizado a desplegar mediante OIDC. Vacío para no crear la identidad.')
param repositorioGithub string = ''

@description('Entorno de GitHub Actions que puede desplegar.')
param entornoGithub string = 'production'

@description('Días de retención de los logs en Log Analytics.')
@minValue(30)
@maxValue(730)
param diasRetencionLogs int = 30

@description('Días de retención de las copias de seguridad creadas por la aplicación en /home/data/backups.')
@minValue(1)
@maxValue(90)
param diasRetencionCopias int = 14

@description('Email que recibe las alertas de disponibilidad. Vacío para no enviar avisos.')
param emailAlertas string = ''

param etiquetas object = {
  aplicacion: 'crm-colegio'
}

var sufijo = uniqueString(resourceGroup().id, nombre)
var nombreApp = 'app-${nombre}-${sufijo}'
// Rol integrado "Website Contributor": permite desplegar en la web app sin acceso al resto de la suscripción
var rolWebsiteContributor = 'de139f84-1756-47ae-9be6-808fbbe84772'
var crearIdentidadGithub = !empty(repositorioGithub)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${nombre}-${sufijo}'
  location: location
  tags: etiquetas
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: diasRetencionLogs
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${nombre}-${sufijo}'
  location: location
  tags: etiquetas
  kind: 'linux'
  sku: {
    name: sku
    // SQLite no admite varias instancias escribiendo a la vez: no escalar horizontalmente
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: nombreApp
  location: location
  tags: etiquetas
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npm start'
      alwaysOn: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      healthCheckPath: '/healthz'
      numberOfWorkers: 1
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        // /home es almacenamiento persistente (sobrevive a reinicios y despliegues) e incluido en las copias de App Service
        { name: 'DB_PATH', value: '/home/data/colegio.db' }
        // /home está en Azure Storage (red): WAL no es compatible
        { name: 'SQLITE_JOURNAL_MODE', value: 'DELETE' }
        { name: 'BACKUP_DIR', value: '/home/data/backups' }
        { name: 'BACKUP_RETENTION_DAYS', value: string(diasRetencionCopias) }
        { name: 'SESSION_SECRET', value: sessionSecret }
        { name: 'ADMIN_EMAIL', value: adminEmail }
        { name: 'ADMIN_PASSWORD', value: adminPassword }
        { name: 'TRUST_PROXY', value: '1' }
        { name: 'COOKIE_SECURE', value: '1' }
        { name: 'TZ', value: 'Europe/Madrid' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'true' }
        // El paquete se construye en GitHub Actions (incluye node_modules) y se monta en solo lectura
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'WEBSITE_HEALTHCHECK_MAXPINGFAILURES', value: '5' }
      ]
    }
  }
}

// Sin credenciales básicas (FTP / Kudu con usuario y contraseña): solo Microsoft Entra ID
resource ftp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: app
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: app
  name: 'scm'
  properties: {
    allow: false
  }
}

resource diagnostico 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'logs-a-log-analytics'
  scope: app
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceAppLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

resource grupoAcciones 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(emailAlertas)) {
  name: 'ag-${nombre}'
  location: 'global'
  tags: etiquetas
  properties: {
    groupShortName: 'crmcolegio'
    enabled: true
    emailReceivers: [
      {
        name: 'responsable'
        emailAddress: emailAlertas
        useCommonAlertSchema: true
      }
    ]
  }
}

// Alerta si la comprobación de estado falla (la app no responde o la base de datos no está disponible)
resource alertaSalud 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alerta-salud-${nombre}'
  location: 'global'
  tags: etiquetas
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
    actions: empty(emailAlertas) ? [] : [
      {
        actionGroupId: grupoAcciones.id
      }
    ]
  }
}

// Identidad para que GitHub Actions despliegue sin secretos (OIDC / credencial federada)
resource identidadGithub 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (crearIdentidadGithub) {
  name: 'id-github-${nombre}-${sufijo}'
  location: location
  tags: etiquetas
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

output url string = 'https://${app.properties.defaultHostName}'
output AZURE_WEBAPP_NAME string = app.name
output AZURE_CLIENT_ID string = crearIdentidadGithub ? identidadGithub!.properties.clientId : ''
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_SUBSCRIPTION_ID string = subscription().subscriptionId
