using './main.bicep'

// Copia este fichero o pasa los valores por línea de comandos.
// Los secretos se leen de variables de entorno para no guardarlos en el repositorio:
//   export CRM_SESSION_SECRET=$(openssl rand -base64 48)
//   export CRM_ADMIN_PASSWORD='<contraseña inicial segura>'

param nombre = 'crm-colegio'
param sku = 'B1'
param adminEmail = 'direccion@micolegio.es'
param repositorioGithub = 'sinanod/CRM'
param entornoGithub = 'production'
param emailAlertas = 'direccion@micolegio.es'

param sessionSecret = readEnvironmentVariable('CRM_SESSION_SECRET')
param adminPassword = readEnvironmentVariable('CRM_ADMIN_PASSWORD')
