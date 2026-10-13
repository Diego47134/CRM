// Prueba de extremo a extremo de la venta de licencias:
// CRM  ⇄  servidor de licencias  ⇄  PayPal (simulado)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-store-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubFile = path.join(tmp, 'pub.pem');
fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
process.env.LICENSE_PUBLIC_KEY_FILE = pubFile;
const privateB64 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');

const { createApp } = await import('../server/app.js');
const { createStore } = await import('../server/store.js');
const { setSetting } = await import('../server/db.js');
const { createLicenseServer } = await import('../license-server/server.js');
const { createPayPal } = await import('../license-server/paypal.js');

const listen = (app) => new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const url = (s) => `http://127.0.0.1:${s.address().port}`;

// ---------------- PayPal simulado ----------------
const fake = { products: 0, plans: new Map(), subs: new Map() };
const pp = express();
pp.use(express.json());
pp.use(express.urlencoded({ extended: false }));
pp.post('/v1/oauth2/token', (req, res) => {
  if (req.get('authorization') !== `Basic ${Buffer.from('cid:secret').toString('base64')}`) return res.status(401).json({ error: 'invalid_client' });
  res.json({ access_token: 'tok', expires_in: 3600 });
});
pp.use('/v1', (req, res, next) => (req.get('authorization') === 'Bearer tok' ? next() : res.status(401).json({ message: 'no auth' })));
pp.post('/v1/catalogs/products', (_req, res) => res.status(201).json({ id: `PROD-${++fake.products}` }));
pp.post('/v1/billing/plans', (req, res) => {
  const id = `P-${fake.plans.size + 1}`;
  fake.plans.set(id, req.body);
  res.status(201).json({ id, status: 'ACTIVE' });
});
pp.post('/v1/billing/subscriptions', (req, res) => {
  const id = `I-SUB${fake.subs.size + 1}`;
  fake.subs.set(id, { id, status: 'APPROVAL_PENDING', plan_id: req.body.plan_id, custom_id: req.body.custom_id, request: req.body });
  res.status(201).json({ id, status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: `https://paypal.example/approve/${id}` }] });
});
pp.get('/v1/billing/subscriptions/:id', (req, res) => {
  const s = fake.subs.get(req.params.id);
  if (!s) return res.status(404).json({ message: 'not found' });
  res.json(s);
});

let ppServer; let lsServer; let crmServer; let crm; let ls; let token; const lsEnv = {};

async function call(method, u, body, tok = token) {
  const res = await fetch(u, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, location: res.headers.get('location') };
}
const api = (m, p, b) => call(m, `${url(crmServer)}/api${p}`, b);

before(async () => {
  ppServer = await listen(pp);
  Object.assign(lsEnv, { LICENSE_PRIVATE_KEY: privateB64, DB_FILE: ':memory:', CURRENCY: 'USD' });
  ls = createLicenseServer({ env: lsEnv, paypal: createPayPal({ clientId: 'cid', clientSecret: 'secret', baseUrl: url(ppServer) }) });
  lsServer = await listen(ls.app);
  lsEnv.PUBLIC_URL = url(lsServer);
  crm = createApp({ dbFile: path.join(tmp, 'crm.db'), store: createStore({ LICENSE_SERVER_URL: `${url(lsServer)}/` }) });
  crmServer = await listen(crm.app);
  const r = await api('POST', '/setup', { name: 'Admin', email: 'admin@cliente.com', password: 'password123', company_name: 'Cliente SL' });
  token = r.data.token;
});
after(() => { for (const s of [ppServer, lsServer, crmServer]) s.close(); crm.db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const instanceId = () => crm.ctx.db.prepare("SELECT value FROM settings WHERE key = 'instance_id'").get().value;
const DAY = 86400000;

test('el CRM muestra los planes mensuales y anuales en USD', async () => {
  const lic = await api('GET', '/license');
  assert.equal(lic.data.storeEnabled, true);
  const r = await api('GET', '/license/store/plans');
  assert.equal(r.status, 200);
  assert.equal(r.data.currency, 'USD');
  const pro = r.data.plans.find((p) => p.id === 'pro');
  assert.equal(pro.month, 39);
  assert.equal(pro.year, 390);
  assert.equal(pro.seats, 10);
});

test('compra mensual: pago en PayPal, licencia emitida y activada sola', async () => {
  let r = await api('POST', '/license/store/checkout', { plan: 'pro', interval: 'month', crm_url: 'https://crm.cliente.com/algo' });
  assert.equal(r.status, 200);
  assert.match(r.data.approve_url, /paypal\.example\/approve\/I-SUB1/);
  const sub = fake.subs.get('I-SUB1');
  assert.equal(sub.custom_id, instanceId(), 'la suscripción va ligada a esta instalación');
  const plan = fake.plans.get(sub.plan_id);
  assert.equal(plan.billing_cycles[0].frequency.interval_unit, 'MONTH');
  assert.equal(plan.billing_cycles[0].pricing_scheme.fixed_price.value, '39');
  assert.equal(plan.billing_cycles[0].pricing_scheme.fixed_price.currency_code, 'USD');

  // El cliente aprueba el pago en PayPal y PayPal lo redirige al servidor de licencias
  Object.assign(sub, { status: 'ACTIVE', start_time: new Date().toISOString(), billing_info: { next_billing_time: new Date(Date.now() + 30 * DAY).toISOString() } });
  const returnUrl = new URL(sub.request.application_context.return_url);
  r = await call('GET', `${returnUrl}&subscription_id=I-SUB1`);
  assert.equal(r.status, 303);
  assert.equal(r.location, 'https://crm.cliente.com/#/settings/license?purchase=ok');

  // El CRM recoge y activa la licencia
  r = await api('POST', '/license/store/sync');
  assert.equal(r.status, 200);
  assert.equal(r.data.updated, true);
  assert.equal(r.data.license.status, 'active');
  assert.equal(r.data.license.plan, 'pro');
  assert.equal(r.data.license.billing, 'month');
  assert.equal(r.data.license.seats, 10);
  assert.equal(r.data.license.customer, 'Cliente SL');
  assert.ok(r.data.license.daysLeft >= 32 && r.data.license.daysLeft <= 34);
  r = await api('GET', '/quotes');
  assert.equal(r.status, 200, 'el plan Pro incluye presupuestos');
});

test('renovación automática: al cobrar PayPal el mes siguiente, la licencia se amplía', async () => {
  const before = (await api('GET', '/license')).data.expires;
  fake.subs.get('I-SUB1').billing_info.next_billing_time = new Date(Date.now() + 60 * DAY).toISOString();
  const r = await api('POST', '/license/store/sync');
  assert.equal(r.data.updated, true);
  assert.ok(Date.parse(r.data.license.expires) > Date.parse(before) + 25 * DAY);
});

test('cancelación: la licencia no se renueva pero sigue válida hasta su fecha', async () => {
  const before = (await api('GET', '/license')).data;
  Object.assign(fake.subs.get('I-SUB1'), { status: 'CANCELLED', billing_info: {} });
  const r = await api('POST', '/license/store/sync');
  assert.equal(r.data.updated, false);
  assert.equal(r.data.subscription.status, 'CANCELLED');
  assert.equal(r.data.license.status, 'active');
  assert.equal(r.data.license.expires, before.expires);
});

test('al terminar la prueba (solo lectura) se puede comprar el plan anual', async () => {
  await api('DELETE', '/license');
  setSetting(crm.ctx.db, 'installed_at', new Date(Date.now() - 30 * DAY).toISOString());
  crm.ctx.license.invalidate();
  let r = await api('GET', '/license');
  assert.equal(r.data.status, 'trial_expired');
  assert.equal((await api('POST', '/contacts', { first_name: 'X' })).status, 402, 'CRM en solo lectura');

  r = await api('POST', '/license/store/checkout', { plan: 'business', interval: 'year', crm_url: 'https://crm.cliente.com' });
  assert.equal(r.status, 200, 'la compra está permitida aunque esté en solo lectura');
  const sub = fake.subs.get('I-SUB2');
  assert.equal(fake.plans.get(sub.plan_id).billing_cycles[0].frequency.interval_unit, 'YEAR');
  assert.equal(fake.plans.get(sub.plan_id).billing_cycles[0].pricing_scheme.fixed_price.value, '890');

  // Recién aprobada (APPROVED): licencia provisional de pocos días hasta confirmar el cobro
  sub.status = 'APPROVED';
  r = await call('GET', `${sub.request.application_context.return_url}&subscription_id=I-SUB2`);
  assert.equal(r.status, 303);
  r = await api('POST', '/license/store/sync');
  assert.equal(r.data.updated, true);
  assert.equal(r.data.license.plan, 'business');
  assert.ok(r.data.license.daysLeft <= 3);
  assert.equal((await api('POST', '/contacts', { first_name: 'Ya puedo' })).status, 201);

  // PayPal confirma el cobro anual
  Object.assign(sub, { status: 'ACTIVE', billing_info: { next_billing_time: new Date(Date.now() + 365 * DAY).toISOString() } });
  r = await api('POST', '/license/store/sync');
  assert.equal(r.data.updated, true);
  assert.equal(r.data.license.billing, 'year');
  assert.ok(r.data.license.daysLeft >= 366);
});

test('seguridad: no se emiten licencias para pagos manipulados o datos no válidos', async () => {
  let r = await api('POST', '/license/store/checkout', { plan: 'gratis', interval: 'month', crm_url: 'https://x.com' });
  assert.equal(r.status, 400);
  r = await api('POST', '/license/store/checkout', { plan: 'pro', interval: 'semanal', crm_url: 'https://x.com' });
  assert.equal(r.status, 400);
  r = await api('POST', '/license/store/checkout', { plan: 'pro', interval: 'month', crm_url: 'javascript:alert(1)' });
  assert.equal(r.status, 400);

  // Suscripción de otra instalación devuelta en el retorno de esta compra
  r = await api('POST', '/license/store/checkout', { plan: 'starter', interval: 'month', crm_url: 'https://crm.cliente.com' });
  const mine = fake.subs.get('I-SUB3');
  fake.subs.set('I-OTRA', { id: 'I-OTRA', status: 'ACTIVE', plan_id: mine.plan_id, custom_id: 'otra-instalacion-123', billing_info: { next_billing_time: new Date(Date.now() + 30 * DAY).toISOString() } });
  r = await call('GET', `${mine.request.application_context.return_url}&subscription_id=I-OTRA`);
  assert.equal(r.status, 400);
  assert.equal(ls.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE id = 'I-OTRA'").get().n, 0);

  // Pago sin aprobar: no hay licencia
  r = await call('GET', `${mine.request.application_context.return_url}&subscription_id=I-SUB3`);
  assert.equal(r.status, 200);
  assert.match(r.data, /Pago pendiente/);

  // Un comercial no puede comprar
  await api('POST', '/users', { name: 'Ven', email: 'ven@cliente.com', password: 'password123', role: 'sales' });
  const salesToken = (await call('POST', `${url(crmServer)}/api/auth/login`, { email: 'ven@cliente.com', password: 'password123' }, null)).data.token;
  r = await call('POST', `${url(crmServer)}/api/license/store/checkout`, { plan: 'pro', interval: 'month', crm_url: 'https://x.com' }, salesToken);
  assert.equal(r.status, 403);

  // El listado de administración exige token
  r = await call('GET', `${url(lsServer)}/admin/subscriptions`, null, 'malo');
  assert.equal(r.status, 401);
});

test('sin LICENSE_SERVER_URL la tienda no aparece', async () => {
  assert.equal(createStore({}), null);
});
