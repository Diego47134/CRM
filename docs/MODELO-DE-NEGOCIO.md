# Modelo de negocio: licencia anual

## Propuesta de valor

Los CRM más conocidos cobran **por usuario y mes**, y las funciones clave (presupuestos, informes, automatizaciones, API) suelen estar en los planes caros. Para una pyme de 5–10 personas eso se traduce fácilmente en **cientos o miles de euros al año**.

NexoCRM se vende con **un precio anual fijo por paquete de usuarios**, con todo lo esencial incluido, y además:

- **Los datos son del cliente**: se instala en su servidor (o en uno que tú gestionas) y puede exportarlo todo en CSV cuando quiera.
- **Sin sorpresas**: si no renueva, el CRM pasa a solo lectura; nunca pierde información.
- **En español**, con presupuestos y facturas con IVA listos para usar.

> Antes de publicar comparativas con precios de competidores, revisa sus tarifas actuales en sus webs oficiales: cambian con frecuencia.

## Precios sugeridos (IVA no incluido)

| Plan | Usuarios | Precio anual sugerido | Equivale a |
|---|---|---|---|
| **Starter** | 3 | 149 € / año | ~4 € usuario/mes |
| **Profesional** | 10 | 390 € / año | ~3,25 € usuario/mes |
| **Business** | 50 | 890 € / año | < 1,50 € usuario/mes |

Extras opcionales:

| Servicio | Precio sugerido |
|---|---|
| Instalación en el servidor del cliente | 90 € (pago único) |
| **Alojamiento gestionado** (servidor, HTTPS, copias diarias) | +15 €/mes por cliente |
| Migración de datos desde Excel u otro CRM | desde 150 € |
| Formación en remoto (2 h) | 120 € |
| Usuarios adicionales | 30 € / usuario / año |
| Desarrollo a medida | por horas |

Un VPS de 5–6 €/mes puede alojar varias instancias pequeñas con Docker, por lo que el alojamiento gestionado deja un margen alto y además hace la licencia imposible de eludir.

## Flujo de venta

1. **Demo**: instala una instancia con «Cargar datos de ejemplo» y enséñala en una videollamada.
2. **Prueba**: el cliente instala (o le das una instancia) y tiene 14 días con todo desbloqueado.
3. **Pago**: por transferencia, Stripe o PayPal (Payment Links es lo más rápido para empezar).
4. **Licencia**: `npm run license:issue -- --customer "…" --plan pro --instance <ID>` y le envías la clave.
5. **Renovación**: 30 días antes de caducar, el CRM avisa al cliente. Envíale la factura y la nueva licencia.

Consejo: automatiza el paso 4 con un pequeño servicio que reciba el webhook de pago de Stripe, llame a `issueLicense()` (exportada por `tools/license.js`) y envíe la clave por email.

## Qué se protege con la licencia

- Número de usuarios activos (asientos).
- Módulos incluidos según plan (o paquete a medida con `--features`).
- Fecha de caducidad, con 7 días de gracia y luego modo solo lectura.
- Opcionalmente, la instalación concreta (`--instance`), para que una licencia no se reutilice en otro servidor.

## Ideas para siguientes versiones

- Envío de emails desde el CRM (SMTP) y plantillas.
- Formularios web embebibles para captar leads.
- Automatizaciones (reglas «si… entonces…»).
- Recordatorios por email de tareas vencidas.
- Firma electrónica de presupuestos y enlace de pago.
- Aplicación móvil (la web ya es adaptable a móvil).
