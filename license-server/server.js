import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PLAN_CATALOG, INTERVALS, loadPrices } from './catalog.js';
import { createPayPal } from './paypal.js';
import { loadPrivateKey, signLicense } from './sign.js';

const DAY = 86400000;
const GRACE_MARGIN_DAYS = 3; // margen tras la fecha de cobro por si PayPal tarda en renovar
const PROVISIONAL_DAYS = 3; // licencia provisional mientras PayPal confirma el primer cobro
const REFRESH_MS = 60 * 60 * 1000; // vuelve a consultar PayPal como máximo cada hora por instalación

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function openStore(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS paypal_plans (
      key TEXT PRIMARY KEY, paypal_plan_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS checkouts (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, plan TEXT NOT NULL, interval TEXT NOT NULL,
      paypal_plan_id TEXT NOT NULL, customer TEXT, email TEXT, crm_url TEXT, subscription_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, plan TEXT NOT NULL, interval TEXT NOT NULL,
      customer TEXT, email TEXT, status TEXT, license_id TEXT NOT NULL, license_key TEXT, expires TEXT,
      last_check INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subs_instance ON subscriptions(instance_id, created_at);
  `);
  return db;
}

/**
 * Servidor de licencias.
 * Variables de entorno: LICENSE_PRIVATE_KEY, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE (sandbox|live),
 * PUBLIC_URL, CURRENCY (USD), PRICES_JSON (opcional), ADMIN_TOKEN (opcional), DB_FILE, BRAND_NAME.
 */
export function createLicenseServer({ env = process.env, paypal, now = () => Date.now() } = {}) {
  const privateKey = loadPrivateKey(env.LICENSE_PRIVATE_KEY);
  const pp = paypal || createPayPal({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, mode: env.PAYPAL_MODE });
  const db = openStore(env.DB_FILE || path.join(process.cwd(), 'data', 'licenses.db'));
  const currency = (env.CURRENCY || 'USD').toUpperCase();
  const prices = loadPrices(env);
  const publicUrl = () => String(env.PUBLIC_URL || '').replace(/\/+$/, '');
  const brandName = env.BRAND_NAME || 'NexoCRM';

  const kvGet = (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? null;
  const kvSet = (k, v) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

  // ---- Planes de PayPal (se crean automáticamente la primera vez y si cambia el precio) ----
  async function ensurePayPalPlan(plan, interval) {
    const price = prices[plan][interval];
    const key = `${plan}:${interval}:${price}:${currency}`;
    const found = db.prepare('SELECT paypal_plan_id FROM paypal_plans WHERE key = ?').get(key);
    if (found) return found.paypal_plan_id;
    let productId = kvGet('paypal_product_id');
    if (!productId) {
      productId = (await pp.createProduct(`${brandName} - licencia`)).id;
      kvSet('paypal_product_id', productId);
    }
    const label = `${brandName} ${PLAN_CATALOG[plan].label} (${interval === 'month' ? 'mensual' : 'anual'})`;
    const created = await pp.createPlan({ productId, name: label, intervalUnit: INTERVALS[interval], price, currency });
    db.prepare('INSERT OR REPLACE INTO paypal_plans (key, paypal_plan_id) VALUES (?, ?)').run(key, created.id);
    return created.id;
  }

  // ---- Emisión de licencias ----
  function expiryFor(sub, interval) {
    const t = now();
    if (sub.status === 'ACTIVE') {
      const next = Date.parse(sub.billing_info?.next_billing_time || '');
      if (Number.isFinite(next)) return next + GRACE_MARGIN_DAYS * DAY;
      const start = Date.parse(sub.start_time || '') || t;
      return start + (interval === 'year' ? 366 : 31) * DAY + GRACE_MARGIN_DAYS * DAY;
    }
    if (sub.status === 'APPROVED') return t + PROVISIONAL_DAYS * DAY;
    return null; // cancelada, suspendida o caducada: no se amplía
  }

  function applySubscription(row, sub) {
    const expires = expiryFor(sub, row.interval);
    let { license_key: key, expires: currentExpires } = row;
    if (expires && (!currentExpires || expires > Date.parse(currentExpires))) {
      currentExpires = new Date(expires).toISOString();
      key = signLicense(privateKey, {
        id: row.license_id,
        customer: row.customer || 'Cliente',
        email: row.email || undefined,
        plan: row.plan,
        seats: PLAN_CATALOG[row.plan].seats,
        issued: new Date(now()).toISOString(),
        expires: currentExpires,
        instance_id: row.instance_id,
        billing: row.interval,
        subscription: row.id,
      });
    }
    db.prepare(`UPDATE subscriptions SET status = ?, license_key = ?, expires = ?, last_check = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(sub.status, key, currentExpires, now(), row.id);
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(row.id);
  }

  async function refresh(row, force = false) {
    if (!force && row.last_check && now() - row.last_check < REFRESH_MS) return row;
    try {
      return applySubscription(row, await pp.getSubscription(row.id));
    } catch (err) {
      console.error(`[licencias] No se pudo consultar la suscripción ${row.id}: ${err.message}`);
      return row;
    }
  }

  const publicLicense = (row) => ({
    status: row.status, plan: row.plan, interval: row.interval, key: row.license_key, expires: row.expires,
    subscription_id: row.id, customer: row.customer,
  });

  // ---- Limitador sencillo para crear pagos ----
  const hits = new Map();
  const limit = (key, max = 20, windowMs = 60 * 60 * 1000) => {
    const t = now();
    const e = hits.get(key);
    if (!e || t - e.start > windowMs) { hits.set(key, { start: t, n: 1 }); return; }
    if (++e.n > max) throw new HttpError(429, 'Demasiadas solicitudes. Inténtalo más tarde.');
    if (hits.size > 10000) hits.clear();
  };

  const validInstance = (v) => /^[A-Za-z0-9-]{8,64}$/.test(String(v || ''));
  const cleanUrl = (v) => {
    try {
      const u = new URL(String(v));
      if (!['http:', 'https:'].includes(u.protocol)) return null;
      return u.origin;
    } catch { return null; }
  };

  // ---- Rutas ----
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', true);
  app.use(express.json({ limit: '50kb' }));

  app.get('/', (_req, res) => res.type('text').send(`Servidor de licencias de ${brandName}`));
  app.get('/api/health', (_req, res) => res.json({ ok: true, mode: pp.mode }));

  app.get('/api/plans', (_req, res) => {
    res.json({
      currency,
      plans: Object.entries(PLAN_CATALOG).map(([id, p]) => ({ id, ...p, month: prices[id].month, year: prices[id].year })),
    });
  });

  app.post('/api/checkout', async (req, res) => {
    limit(`checkout:${req.ip}`);
    const { plan, interval, instance_id: instanceId, customer, email } = req.body || {};
    if (!PLAN_CATALOG[plan]) throw new HttpError(400, 'Plan no válido');
    if (!INTERVALS[interval]) throw new HttpError(400, 'Periodicidad no válida (month o year)');
    if (!validInstance(instanceId)) throw new HttpError(400, 'ID de instalación no válido');
    const crmUrl = cleanUrl(req.body?.crm_url);
    if (!crmUrl) throw new HttpError(400, 'URL del CRM no válida');
    if (!publicUrl()) throw new HttpError(500, 'El servidor de licencias no tiene PUBLIC_URL configurada');

    const planId = await ensurePayPalPlan(plan, interval);
    const ref = crypto.randomUUID();
    const sub = await pp.createSubscription({
      planId,
      customId: instanceId,
      email: typeof email === 'string' && email.includes('@') ? email : undefined,
      name: customer,
      brandName,
      returnUrl: `${publicUrl()}/paypal/return?ref=${ref}`,
      cancelUrl: `${publicUrl()}/paypal/cancel?ref=${ref}`,
    });
    const approve = sub.links?.find((l) => l.rel === 'approve')?.href;
    if (!approve) throw new HttpError(502, 'PayPal no devolvió el enlace de pago');
    db.prepare(`INSERT INTO checkouts (id, instance_id, plan, interval, paypal_plan_id, customer, email, crm_url, subscription_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ref, instanceId, plan, interval, planId, String(customer || '').slice(0, 200), String(email || '').slice(0, 200), crmUrl, sub.id);
    res.json({ approve_url: approve, subscription_id: sub.id });
  });

  const page = (title, text, link) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f6f3;color:#0b0b0b}
    main{background:#fff;padding:32px;border-radius:12px;max-width:440px;box-shadow:0 4px 16px rgba(0,0,0,.08)}a{color:#2a78d6}</style></head>
    <body><main><h1 style="font-size:20px">${title}</h1><p>${text}</p>${link ? `<p><a href="${link}">Volver al CRM</a></p>` : ''}</main></body></html>`;

  app.get('/paypal/return', async (req, res) => {
    const checkout = db.prepare('SELECT * FROM checkouts WHERE id = ?').get(String(req.query.ref || ''));
    if (!checkout) return res.status(404).send(page('Pago no encontrado', 'No encontramos esta compra. Si has pagado, contacta con soporte.'));
    const subId = String(req.query.subscription_id || checkout.subscription_id);
    const back = `${checkout.crm_url}/#/settings/license`;
    let sub;
    try {
      sub = await pp.getSubscription(subId);
    } catch (err) {
      console.error(`[licencias] Error al confirmar ${subId}: ${err.message}`);
      return res.status(502).send(page('No se pudo confirmar el pago', 'PayPal no respondió. Vuelve al CRM y pulsa «Comprobar pago» en unos minutos.', back));
    }
    if (sub.custom_id !== checkout.instance_id || sub.plan_id !== checkout.paypal_plan_id) {
      return res.status(400).send(page('Pago no válido', 'La suscripción no corresponde a esta compra.', back));
    }
    let row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(sub.id);
    if (!row) {
      db.prepare(`INSERT INTO subscriptions (id, instance_id, plan, interval, customer, email, status, license_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sub.id, checkout.instance_id, checkout.plan, checkout.interval, checkout.customer, checkout.email, sub.status,
          `LIC-${new Date(now()).getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`);
      row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(sub.id);
    }
    row = applySubscription(row, sub);
    if (!row.license_key) {
      return res.send(page('Pago pendiente', 'PayPal todavía no ha confirmado el pago. Vuelve al CRM y pulsa «Comprobar pago» en unos minutos.', back));
    }
    console.log(`[licencias] Licencia emitida: ${row.license_id} · ${row.plan}/${row.interval} · ${row.customer} · hasta ${row.expires}`);
    res.redirect(303, `${back}?purchase=ok`);
  });

  app.get('/paypal/cancel', (req, res) => {
    const checkout = db.prepare('SELECT crm_url FROM checkouts WHERE id = ?').get(String(req.query.ref || ''));
    if (!checkout) return res.status(404).send(page('Compra cancelada', 'Has cancelado el pago.'));
    res.redirect(303, `${checkout.crm_url}/#/settings/license?purchase=cancel`);
  });

  // El CRM consulta aquí su licencia vigente (al arrancar, cada pocas horas y tras pagar).
  app.get('/api/licenses/:instanceId', async (req, res) => {
    const instanceId = req.params.instanceId;
    if (!validInstance(instanceId)) throw new HttpError(400, 'ID de instalación no válido');
    limit(`lic:${instanceId}`, 120);
    const rows = db.prepare('SELECT * FROM subscriptions WHERE instance_id = ? ORDER BY created_at DESC, rowid DESC').all(instanceId);
    if (!rows.length) throw new HttpError(404, 'Sin suscripciones para esta instalación');
    const force = req.query.force === '1';
    const refreshed = [];
    for (const r of rows) refreshed.push(await refresh(r, force));
    // Prioridad: la suscripción vigente (activa o recién aprobada) más reciente; si no hay ninguna,
    // la licencia que más dure (p. ej. una suscripción cancelada que aún no ha caducado).
    const withKey = refreshed.filter((r) => r.license_key);
    const best = withKey.find((r) => ['ACTIVE', 'APPROVED'].includes(r.status))
      || withKey.sort((a, b) => Date.parse(b.expires) - Date.parse(a.expires))[0]
      || refreshed[0];
    res.json(publicLicense(best));
  });

  app.get('/admin/subscriptions', (req, res) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '');
    if (!env.ADMIN_TOKEN || token.length !== env.ADMIN_TOKEN.length
      || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(env.ADMIN_TOKEN))) {
      throw new HttpError(401, 'No autorizado');
    }
    res.json(db.prepare(`SELECT id, instance_id, plan, interval, customer, email, status, license_id, expires, created_at
      FROM subscriptions ORDER BY created_at DESC`).all());
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('[licencias]', err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Error del servidor de licencias' : err.message });
  });

  return { app, db };
}

export function start() {
  const { app } = createLicenseServer();
  const rawPort = process.env.PORT || '3001';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
  app.listen(port, () => console.log(`[licencias] Servidor de licencias escuchando en ${port}`));
}
