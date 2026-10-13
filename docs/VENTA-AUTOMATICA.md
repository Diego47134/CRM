# Venta automática de licencias con PayPal

Con esto, cuando un cliente termina su prueba gratuita (o en cualquier momento), puede contratar desde
**Configuración → Licencia** un plan **mensual o anual**, pagar con PayPal y la licencia se **genera y activa
sola**. Las renovaciones también son automáticas: PayPal cobra cada mes/año y el CRM recoge la nueva licencia.

```
 CRM del cliente  ──(1) elige plan──▶  Servidor de licencias  ──(2) crea suscripción──▶  PayPal
        ▲                                     │   (guarda tu clave privada)                 │
        │                                     ◀──────────(3) el cliente paga y vuelve───────┘
        └──────(4) el CRM descarga y activa la licencia firmada (y cada 6 h las renovaciones)
```

Solo el **servidor de licencias** conoce tu clave privada. Los CRM de los clientes nunca la tienen.

---

## 1. Crea la app de PayPal

1. Entra en **https://developer.paypal.com** con tu cuenta **PayPal Business**.
2. Ve a **Apps & Credentials**. Arriba verás un interruptor **Sandbox / Live**:
   - **Sandbox** = pruebas con dinero ficticio (empieza por aquí).
   - **Live** = cobros reales.
3. Con **Sandbox** seleccionado pulsa **Create App**, ponle un nombre (p. ej. «NexoCRM licencias») y créala.
4. Copia el **Client ID** y el **Secret**.
5. Para pagar en pruebas, en **Testing Tools → Sandbox Accounts** tienes una cuenta *Personal* de comprador
   (email y contraseña ficticios) con la que «pagar».

## 2. Exporta tu clave privada en una línea

En tu ordenador, dentro de la carpeta `CRM`:

```
git pull
npm run license:export-key
```

Copia la línea larga que aparece. **No la compartas**: quien la tenga puede crear licencias.

## 3. Despliega el servidor de licencias en Hostinger

1. hPanel → **Desplegar app web** → crea un subdominio, por ejemplo **`licencias.aperturaweb.com`**.
2. GitHub → repositorio **CRM** → la misma rama que el CRM.
3. **Directorio raíz → Cambiar → `license-server`** (importante: es una app distinta del CRM).
4. Preajuste **Express**, Node **22.x**.
5. Variables de entorno:

| Clave | Valor |
|---|---|
| `LICENSE_PRIVATE_KEY` | la línea del paso 2 |
| `PAYPAL_CLIENT_ID` | Client ID de PayPal |
| `PAYPAL_CLIENT_SECRET` | Secret de PayPal |
| `PAYPAL_MODE` | `sandbox` (pruebas) o `live` (cobros reales) |
| `PUBLIC_URL` | `https://licencias.aperturaweb.com` (sin barra final) |
| `CURRENCY` | `USD` |
| `DB_FILE` | `/home/u786774941/licencias-datos/licenses.db` |
| `ADMIN_TOKEN` | una contraseña larga inventada (para consultar las ventas) |
| `TRUST_PROXY` | `true` |
| `BRAND_NAME` | `NexoCRM` (aparece en la página de pago de PayPal) |

6. Implementar. Comprueba **https://licencias.aperturaweb.com/api/health** → `{"ok":true,"mode":"sandbox"}`.

## 4. Conecta cada CRM con la tienda

En cada app del CRM (crelia y las de tus clientes) añade la variable de entorno:

| Clave | Valor |
|---|---|
| `LICENSE_SERVER_URL` | `https://licencias.aperturaweb.com` |

y pulsa **Redistribuir**. En **Configuración → Licencia** aparecerán los planes con el botón
**«Suscribirme con PayPal»**.

## 5. Prueba una compra (sandbox)

1. En el CRM: Configuración → Licencia → elige un plan → **Suscribirme con PayPal**.
2. Inicia sesión en PayPal con la **cuenta de comprador sandbox** y acepta.
3. Vuelves al CRM y en unos segundos verás **«¡Pago confirmado!»** con el plan activo.

## 6. Empieza a cobrar de verdad

1. En developer.paypal.com cambia el interruptor a **Live**, crea otra app y copia su Client ID y Secret.
2. En el servidor de licencias cambia `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` y pon `PAYPAL_MODE` = `live`.
3. Redistribuir. Los planes de PayPal se crean solos la primera vez que alguien compra.

---

## Precios

Por defecto (USD): Starter 15/mes o 149/año · Profesional 39/mes o 390/año · Business 89/mes o 890/año.
Para cambiarlos añade al servidor de licencias la variable `PRICES_JSON`, por ejemplo:

```
{"starter":{"month":19,"year":190},"pro":{"month":49,"year":490},"business":{"month":99,"year":990}}
```

Los nuevos precios se aplican a las **nuevas** suscripciones; las existentes mantienen su precio en PayPal.

## Cómo se comporta

| Situación | Resultado |
|---|---|
| Pago aprobado | Licencia inmediata (provisional 3 días hasta que PayPal confirma el cobro, luego hasta la siguiente fecha de cobro + 3 días) |
| Cada renovación | El CRM la recoge solo (al arrancar y cada 6 h, o con «Comprobar pago») |
| El cliente cancela en PayPal | No se renueva; la licencia sigue válida hasta su fecha, luego 7 días de gracia y modo solo lectura |
| Cambio de plan | El cliente contrata el nuevo plan; recuerda cancelar el anterior en PayPal |
| Pago de otra instalación o manipulado | Se rechaza: cada suscripción va ligada al ID de instalación |

## Ver tus ventas

```
curl -H "Authorization: Bearer TU_ADMIN_TOKEN" https://licencias.aperturaweb.com/admin/subscriptions
```

También las verás en tu panel de PayPal → Pagos automáticos / Suscripciones.
