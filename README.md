# NexoCRM

CRM completo, autoalojado y en español, pensado para **venderse con licencia anual** a pymes a una fracción del precio de los CRM por usuario/mes.

- **Sin dependencias nativas**: Node.js 22 + SQLite integrado (`node:sqlite`) + Express. Un solo proceso, un solo fichero de base de datos.
- **Sin build**: el frontend es una SPA en JavaScript moderno (módulos ES) servida tal cual.
- **Licencias firmadas (Ed25519)** con planes, límite de usuarios, caducidad, periodo de gracia y vinculación opcional a la instalación.

---

## Funcionalidades

| Módulo | Qué incluye |
|---|---|
| **Panel** | KPIs (embudo, previsión ponderada, ganado del mes, tasa de cierre), ventas de 12 meses, embudo por etapa, próximas actividades, ranking de comerciales, origen de contactos, actividad reciente. Vista «equipo» o «solo lo mío». |
| **Contactos** | Ficha completa, estados (lead/prospecto/cliente/inactivo), origen, puntuación, etiquetas, responsable, detección de duplicados por email, cronología de notas/actividades, oportunidades, presupuestos y tickets relacionados. |
| **Empresas** | Datos fiscales, sector, web, contactos asociados, valor de embudo abierto y ganado histórico. |
| **Oportunidades** | Tablero **kanban con arrastrar y soltar**, vista lista, varios embudos configurables, probabilidad por etapa, previsión ponderada, motivo de pérdida, barra de etapas en la ficha, aviso de oportunidades sin actividad planificada. |
| **Actividades** | Tareas, llamadas, reuniones, emails y plazos; vista lista y **calendario mensual**; vencidas/hoy/próximas; registro rápido de llamadas. |
| **Productos** | Catálogo con SKU, categorías, precio, coste, margen e impuesto. |
| **Presupuestos y facturas** | Editor con líneas, descuentos, varios tipos de IVA, numeración automática por año, estados, **convertir presupuesto en factura**, duplicar, **vista imprimible / PDF** con logotipo. Aceptar un presupuesto marca la oportunidad como ganada. |
| **Soporte (tickets)** | Estados, prioridades, canales, categorías, asignación, tiempo medio de resolución. |
| **Informes** | Rendimiento por comercial, embudo, motivos de pérdida, ventas por origen, previsión de cierre, actividades completadas, facturación cobrada/pendiente/vencida, presupuestos aceptados, soporte. Filtros por periodo y comercial. |
| **Configuración** | Datos de empresa y logotipo (marca blanca), color de marca, moneda y formato regional, numeración, listas desplegables, usuarios y roles, embudos y etapas, **campos personalizados**, importación/exportación CSV, **API REST con claves**, **webhooks firmados (HMAC)**, **registro de auditoría**, copia de seguridad descargable. |
| **Transversal** | Búsqueda global (tecla `/`), creación rápida, notificaciones, acciones masivas (asignar, cambiar estado, etiquetar, eliminar), exportación CSV en todos los listados, tema claro/oscuro, diseño adaptable a móvil, roles (administrador, responsable, comercial) con visibilidad «solo mis registros». |

---

## Puesta en marcha

Requisitos: **Node.js 22.13 o superior**.

```bash
npm install
npm start            # http://localhost:3000
```

La primera vez se muestra un asistente para crear la empresa y el usuario administrador (opcionalmente con **datos de ejemplo** para hacer demos). La instalación empieza con **14 días de prueba** con todas las funciones.

Variables de entorno (ver `.env.example`; se lee `.env` automáticamente si existe):

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `DB_FILE` | `data/crm.db` | Base de datos SQLite |
| `TRUST_PROXY` | – | `true` detrás de Nginx/Caddy/Traefik |
| `JWT_SECRET` | autogenerado | Secreto de sesión (se guarda en la BD si no se indica) |
| `LICENSE_PUBLIC_KEY_FILE` | `server/license-public.pem` | Clave pública para validar licencias |
| `LICENSE_SERVER_URL` | – | Servidor de licencias para la venta automática con PayPal |
| `ADMIN_RESET_EMAIL` / `ADMIN_RESET_PASSWORD` | – | Recupera el acceso de administrador al arrancar (bórralas después) |

### Con Docker

```bash
docker compose up -d --build
```

Los datos quedan en el volumen `crm-data`. Para HTTPS, pon delante un proxy inverso; por ejemplo con Caddy:

```
crm.tucliente.com {
    reverse_proxy localhost:3000
}
```

### Copias de seguridad

- Desde la app: *Configuración → Copia de seguridad* descarga la BD completa.
- En el servidor: copia periódicamente el directorio `data/` (p. ej. `sqlite3 data/crm.db ".backup /backups/crm-$(date +%F).db"` en un cron diario).
- Restaurar: detén el CRM, sustituye `data/crm.db` y vuelve a arrancar.

---

## Licencias (guía para el proveedor)

El CRM valida las licencias con una **clave pública** incluida en `server/license-public.pem`. Tú firmas las licencias con tu **clave privada**, que nunca sale de tu equipo.

1. **Genera tu par de claves (una sola vez):**
   ```bash
   npm run license:keygen
   ```
   - `tools/keys/private.pem` → tu clave privada. **Haz copia de seguridad y no la subas a git** (ya está en `.gitignore`). Si la pierdes no podrás renovar licencias.
   - `server/license-public.pem` → **súbela al repositorio**: se distribuye con cada instalación.

2. **Emite una licencia cuando un cliente paga:**
   ```bash
   npm run license:issue -- --customer "Cliente SL" --email admin@cliente.com --plan pro --seats 10 --days 365
   # Opcional: --instance <ID de instalación>  para vincularla a su servidor
   # Opcional: --features core,quotes,reports   para un paquete a medida
   ```
   Envía al cliente la clave que se imprime. El cliente la pega en *Configuración → Licencia*.

3. **Renovación**: emite una licencia nueva cada año; el cliente la pega encima de la anterior.

4. **Comprobar una licencia**: `npm run license:inspect -- <clave>`.

Comportamiento de la licencia en el CRM:

| Estado | Qué ocurre |
|---|---|
| Prueba (14 días) | Todas las funciones, hasta 5 usuarios |
| Activa | Funciones y usuarios del plan |
| Caducada ≤ 7 días | Periodo de gracia: todo sigue funcionando, con aviso |
| Caducada > 7 días / prueba finalizada | **Modo solo lectura**: se puede consultar y exportar, no modificar. Nunca se pierden datos. |

Planes incluidos (editables en `server/license.js`):

| Plan | Usuarios | Funciones |
|---|---|---|
| Starter | 3 | Contactos, empresas, oportunidades, actividades, panel, productos, importación/exportación |
| Profesional | 10 | + presupuestos y facturas, soporte, informes, campos personalizados |
| Business | 50 | + API REST, webhooks, auditoría |

> Al ser software autoalojado en JavaScript, un cliente con acceso al servidor podría modificar el código. La firma evita la falsificación y el uso casual sin pagar; la protección real es el valor del soporte y las actualizaciones. Si necesitas control total, ofrécelo también **alojado por ti** (una instancia por cliente con Docker).

### Venta automática (PayPal, mensual o anual)

El CRM puede vender y renovar licencias solo: el cliente elige plan mensual o anual en *Configuración → Licencia*, paga con PayPal y la licencia se genera y activa automáticamente. Necesita el servidor de licencias de la carpeta `license-server/`. Guía paso a paso: [`docs/VENTA-AUTOMATICA.md`](docs/VENTA-AUTOMATICA.md).

Consulta [`docs/MODELO-DE-NEGOCIO.md`](docs/MODELO-DE-NEGOCIO.md) para precios sugeridos y cómo venderlo.

---

## API REST

Crea una clave en *Configuración → API y webhooks* y envíala en la cabecera `X-API-Key`.

```bash
# Listar (búsqueda, filtros, orden y paginación)
curl -H "X-API-Key: nxk_..." "https://crm.ejemplo.com/api/contacts?q=ana&status=customer&page=1&limit=50"

# Crear un lead desde el formulario de tu web
curl -X POST https://crm.ejemplo.com/api/contacts \
  -H "X-API-Key: nxk_..." -H "Content-Type: application/json" \
  -d '{"first_name":"Ana","email":"ana@ejemplo.com","source":"Web"}'
```

| Recurso | Rutas |
|---|---|
| `/api/contacts`, `/api/companies`, `/api/deals`, `/api/activities`, `/api/products`, `/api/tickets` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /bulk`, `GET /export.csv` |
| `/api/deals/:id/move` | `POST {stage_id, position, lost_reason}` |
| `/api/quotes` | CRUD con `items[]`, `?kind=invoice`, `POST /:id/convert`, `POST /:id/duplicate` |
| `/api/notes`, `/api/timeline?contact_id=` | Notas y cronología |
| `/api/pipelines`, `/api/users`, `/api/search?q=`, `/api/dashboard`, `/api/reports?from=&to=` | Otros |

**Webhooks**: el CRM envía `POST` JSON con `{event, data, sent_at}` para eventos como `contacts.created`, `deals.updated`, `deals.stage_changed`, `invoices.created`… Verifica la cabecera `X-CRM-Signature: sha256=HMAC(cuerpo, secreto)`.

---

## Desarrollo

```bash
npm run dev     # recarga automática
npm test        # tests de la API (node:test)
```

Estructura:

```
server/
  app.js          Composición de la app Express y seguridad
  db.js           Esquema, migraciones y ajustes
  auth.js         Contraseñas (scrypt), tokens (HMAC-SHA256), roles, API keys
  license.js      Verificación de licencias, planes y modo solo lectura
  crud.js         Router REST genérico (listado, filtros, CSV, acciones masivas)
  resources.js    Definición de contactos, empresas, oportunidades, actividades, productos y tickets
  routes/         Presupuestos, embudos, informes, importación, administración…
  demo.js         Datos de ejemplo
public/
  index.html, css/app.css
  js/main.js      Shell, router y navegación
  js/ui.js        Utilidades, formularios, modales, formato
  js/list.js      Listado genérico
  js/views/*.js   Pantallas
tools/license.js  Herramienta del proveedor: generar claves y emitir licencias
test/             Tests de la API
```

Seguridad incluida: contraseñas con scrypt, tokens firmados con invalidación al cambiar contraseña o desactivar usuario, limitación de intentos de login, cabeceras CSP/anti-framing, consultas SQL parametrizadas, escape de HTML en toda la interfaz, protección contra inyección de fórmulas en CSV, validación de todos los campos en el servidor y registro de auditoría.

## Marca blanca

El nombre de la empresa, el logotipo y el color de marca se configuran desde la app. Para cambiar el nombre del producto («NexoCRM») en la pantalla de acceso y el título, busca `NexoCRM` en `public/`.
