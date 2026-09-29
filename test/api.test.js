import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Par de claves de prueba para firmar licencias
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubFile = path.join(tmp, 'pub.pem');
fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
process.env.LICENSE_PUBLIC_KEY_FILE = pubFile;
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const { createApp } = await import('../server/app.js');
const { issueLicense } = await import('../tools/license.js');
const { setSetting } = await import('../server/db.js');

let server; let base; let db; let license; let token;

async function call(method, url, body, tok = token, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const get = (u, t) => call('GET', u, undefined, t);
const post = (u, b, t) => call('POST', u, b, t);
const patch = (u, b, t) => call('PATCH', u, b, t);
const del = (u, t) => call('DELETE', u, undefined, t);

before(async () => {
  const created = createApp({ dbFile: path.join(tmp, 'test.db') });
  db = created.db;
  license = created.license;
  await new Promise((r) => { server = created.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('configuración inicial y login', async () => {
  let r = await get('/setup/status');
  assert.equal(r.data.needsSetup, true);
  r = await post('/setup', { name: 'Admin', email: 'admin@test.com', password: 'corta' });
  assert.equal(r.status, 400);
  r = await post('/setup', { name: 'Admin', email: 'admin@test.com', password: 'password123', company_name: 'Test SL' });
  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  r = await post('/setup', { name: 'Otro', email: 'x@test.com', password: 'password123' });
  assert.equal(r.status, 409, 'no se puede repetir el setup');

  r = await post('/auth/login', { email: 'admin@test.com', password: 'mala' });
  assert.equal(r.status, 401);
  r = await post('/auth/login', { email: 'ADMIN@test.com', password: 'password123' });
  assert.equal(r.status, 200);
  token = r.data.token;
  r = await get('/me');
  assert.equal(r.data.role, 'admin');
  r = await get('/contacts', 'token-falso');
  assert.equal(r.status, 401);
});

test('CRUD de contactos, validación y duplicados', async () => {
  let r = await post('/contacts', { last_name: 'Sin nombre' });
  assert.equal(r.status, 400);
  r = await post('/contacts', { first_name: 'Ana', email: 'no-es-email' });
  assert.equal(r.status, 400);
  const co = await post('/companies', { name: 'Empresa Uno', website: 'empresa.es' });
  assert.equal(co.data.website, 'https://empresa.es');
  r = await post('/contacts', { first_name: 'Ana', last_name: 'López', email: 'Ana@Ej.com', company_id: co.data.id, tags: 'VIP, Newsletter ' });
  assert.equal(r.status, 201);
  assert.equal(r.data.email, 'ana@ej.com');
  assert.equal(r.data.tags, 'vip,newsletter');
  assert.equal(r.data.company_name, 'Empresa Uno');
  const id = r.data.id;
  r = await post('/contacts', { first_name: 'Ana 2', email: 'ana@ej.com' });
  assert.equal(r.status, 409);
  r = await patch(`/contacts/${id}`, { status: 'customer', score: 80 });
  assert.equal(r.data.status, 'customer');
  r = await patch(`/contacts/${id}`, { status: 'inventado' });
  assert.equal(r.status, 400);
  r = await get('/contacts?q=lópez');
  assert.equal(r.data.total, 1);
  r = await get('/contacts?tag=vip');
  assert.equal(r.data.total, 1);
  r = await post('/contacts', { first_name: 'Ref', company_id: 99999 });
  assert.equal(r.status, 400, 'referencia inexistente');
  r = await get('/search?q=ana');
  assert.equal(r.data.contacts.length, 1);
});

test('oportunidades: etapas, ganada/perdida y kanban', async () => {
  const pipes = (await get('/pipelines')).data;
  const stages = pipes[0].stages;
  const won = stages.find((s) => s.kind === 'won');
  const lost = stages.find((s) => s.kind === 'lost');
  let r = await post('/deals', { title: 'Venta 1', value: 1000 });
  assert.equal(r.status, 201);
  assert.equal(r.data.stage_id, stages[0].id, 'etapa inicial por defecto');
  assert.equal(r.data.weighted_value, 100);
  const id = r.data.id;
  r = await post(`/deals/${id}/move`, { stage_id: won.id });
  assert.equal(r.data.status, 'won');
  r = await get(`/deals/${id}`);
  assert.ok(r.data.closed_at);
  r = await post(`/deals/${id}/move`, { stage_id: lost.id, lost_reason: 'Precio' });
  r = await get(`/deals/${id}`);
  assert.equal(r.data.status, 'lost');
  assert.equal(r.data.lost_reason, 'Precio');
  r = await post(`/deals/${id}/move`, { stage_id: stages[1].id });
  r = await get(`/deals/${id}`);
  assert.equal(r.data.status, 'open');
  assert.equal(r.data.closed_at, null);
  r = await post('/deals/bulk', { ids: [id], action: 'update', data: { stage_id: won.id } });
  assert.equal(r.data.affected, 1);
  assert.equal((await get(`/deals/${id}`)).data.status, 'won', 'la edición masiva de etapa actualiza el estado');
  const dash = await get('/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.data.won_by_month.length, 12);
});

test('presupuestos: totales, conversión a factura y numeración', async () => {
  const deal = (await post('/deals', { title: 'Proyecto web', value: 0 })).data;
  let r = await post('/quotes', {
    deal_id: deal.id,
    items: [
      { description: 'Diseño', quantity: 2, unit_price: 100, tax_rate: 21 },
      { description: 'Hosting', quantity: 1, unit_price: 50, discount_pct: 10, tax_rate: 21 },
    ],
  });
  assert.equal(r.status, 201);
  const q = r.data;
  assert.match(q.number, /^PRE-\d{4}-0001$/);
  assert.equal(q.subtotal, 245);
  assert.equal(q.discount_total, 5);
  assert.equal(q.tax_total, 51.45);
  assert.equal(q.total, 296.45);
  r = await patch(`/quotes/${q.id}`, { status: 'accepted' });
  assert.equal(r.data.status, 'accepted');
  const d = (await get(`/deals/${deal.id}`)).data;
  assert.equal(d.status, 'won', 'aceptar el presupuesto gana la oportunidad');
  assert.equal(d.value, 296.45);
  r = await post(`/quotes/${q.id}/convert`);
  assert.equal(r.status, 201);
  assert.equal(r.data.kind, 'invoice');
  assert.match(r.data.number, /^FAC-\d{4}-0001$/);
  assert.equal(r.data.total, 296.45);
  r = await patch(`/quotes/${r.data.id}`, { status: 'paid' });
  assert.ok(r.data.paid_at);
  const rep = await get('/reports');
  assert.equal(rep.data.invoices.paid, 296.45);
});

test('actividades, notas y cronología', async () => {
  const c = (await post('/contacts', { first_name: 'Luis' })).data;
  let r = await post('/activities', { subject: 'Llamar', type: 'call', due_at: '2020-01-01T10:00', contact_id: c.id });
  assert.equal(r.status, 201);
  r = await get('/activities?when=overdue');
  assert.ok(r.data.total >= 1);
  r = await patch(`/activities/${r.data.data[0].id}`, { done: true });
  assert.ok(r.data.done_at);
  await post('/notes', { body: 'Nota importante', contact_id: c.id });
  r = await get(`/timeline?contact_id=${c.id}`);
  assert.equal(r.data.notes.length, 1);
  assert.equal(r.data.activities.length, 1);
  r = await post('/notes', { body: 'Huérfana' });
  assert.equal(r.status, 400);
});

test('importación CSV con punto y coma y exportación', async () => {
  const csv = 'Nombre;Apellidos;Email;Empresa;Estado\nMarta;Ruiz;marta@x.es;Nueva Empresa SA;cliente\nPedro;;pedro@x.es;Nueva Empresa SA;\n;SinNombre;z@x.es;;\nDup;;marta@x.es;;';
  const r = await post('/import/contacts', { csv });
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 2);
  assert.equal(r.data.skipped, 1);
  assert.equal(r.data.errors.length, 1);
  const cos = await get('/companies?q=Nueva Empresa');
  assert.equal(cos.data.total, 1, 'reutiliza la empresa creada');
  const m = (await get('/contacts?q=marta')).data.data[0];
  assert.equal(m.status, 'customer');
  const res = await fetch(`${base}/contacts/export.csv`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(text, /Marta/);
});

test('campos personalizados', async () => {
  let r = await post('/custom-fields', { entity: 'contacts', label: 'Talla de camiseta', type: 'select', options: ['S', 'M', 'L'] });
  assert.equal(r.status, 201);
  assert.equal(r.data.key, 'talla_de_camiseta');
  r = await post('/contacts', { first_name: 'Custom', custom: { talla_de_camiseta: 'XL' } });
  assert.equal(r.status, 400);
  r = await post('/contacts', { first_name: 'Custom', custom: { talla_de_camiseta: 'M', inventado: 'x' } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.custom, { talla_de_camiseta: 'M' });
});

test('roles y visibilidad de comerciales', async () => {
  let r = await post('/users', { name: 'Comercial', email: 'sales@test.com', password: 'password123', role: 'sales' });
  assert.equal(r.status, 201);
  const salesToken = (await post('/auth/login', { email: 'sales@test.com', password: 'password123' })).data.token;
  r = await patch('/settings', { company_name: 'Hack' }, salesToken);
  assert.equal(r.status, 403);
  r = await post('/users', { name: 'X', email: 'x2@test.com', password: 'password123' }, salesToken);
  assert.equal(r.status, 403);
  const own = await post('/contacts', { first_name: 'Del comercial' }, salesToken);
  assert.equal(own.status, 201);
  const total = (await get('/contacts', salesToken)).data.total;
  assert.ok(total > 1);
  await patch('/settings', { sales_see_own_only: '1' });
  r = await get('/contacts', salesToken);
  assert.equal(r.data.total, 1, 'solo ve sus contactos');
  const other = (await get('/contacts?q=Ana')).data.data[0];
  r = await get(`/contacts/${other.id}`, salesToken);
  assert.equal(r.status, 403);
  await patch('/settings', { sales_see_own_only: '0' });
  // No se puede degradar al último administrador
  const me = (await get('/me')).data;
  r = await patch(`/users/${me.id}`, { role: 'sales' });
  assert.equal(r.status, 400);
});

test('claves de API', async () => {
  const r = await post('/api-keys', { name: 'Web' });
  assert.equal(r.status, 201);
  const res = await fetch(`${base}/contacts`, { headers: { 'x-api-key': r.data.key } });
  assert.equal(res.status, 200);
  const bad = await fetch(`${base}/contacts`, { headers: { 'x-api-key': 'nxk_falsa' } });
  assert.equal(bad.status, 401);
});

test('licencias: activación, plan, asientos, instancia y caducidad', async () => {
  let r = await get('/license');
  assert.equal(r.data.status, 'trial');
  assert.equal(r.data.publicKeyLoaded, true);

  // Licencia firmada con otra clave => rechazada
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const forged = issueLicense(other, { customer: 'Pirata', plan: 'business' }).key;
  r = await post('/license', { key: forged });
  assert.equal(r.status, 400);

  // Manipular el contenido invalida la firma
  const good = issueLicense(privatePem, { customer: 'Cliente', plan: 'starter', seats: 2 }).key;
  const [body, sig] = good.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), seats: 999 })).toString('base64url');
  r = await post('/license', { key: `${tampered}.${sig}` });
  assert.equal(r.status, 400);

  // Licencia de otra instalación
  r = await post('/license', { key: issueLicense(privatePem, { customer: 'C', plan: 'pro', instance: 'otra' }).key });
  assert.equal(r.status, 400);

  // Starter válida: 2 asientos (ya hay 2 usuarios) y sin presupuestos
  const instance = (await get('/license')).data.instanceId;
  r = await post('/license', { key: issueLicense(privatePem, { customer: 'Cliente SL', plan: 'starter', seats: 2, instance }).key });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'active');
  r = await get('/quotes');
  assert.equal(r.status, 402, 'starter no incluye presupuestos');
  r = await post('/users', { name: 'Tercero', email: 'tres@test.com', password: 'password123' });
  assert.equal(r.status, 402, 'límite de usuarios');

  // Caducada fuera del periodo de gracia => solo lectura
  setSetting(db, 'license_key', issueLicense(privatePem, { customer: 'Cliente SL', plan: 'business', days: -30 }).key);
  license.invalidate();
  r = await get('/license');
  assert.equal(r.data.status, 'expired');
  r = await get('/contacts');
  assert.equal(r.status, 200, 'lectura permitida');
  r = await post('/contacts', { first_name: 'Bloqueado' });
  assert.equal(r.status, 402, 'escritura bloqueada');

  // En periodo de gracia se puede seguir trabajando
  r = await post('/license', { key: issueLicense(privatePem, { customer: 'Cliente SL', plan: 'business', days: -2 }).key });
  assert.equal(r.data.status, 'grace');
  r = await post('/contacts', { first_name: 'En gracia' });
  assert.equal(r.status, 201);

  // Renovación
  r = await post('/license', { key: issueLicense(privatePem, { customer: 'Cliente SL', plan: 'business' }).key });
  assert.equal(r.data.status, 'active');
  assert.equal(r.data.seats, 50);
});

test('prueba caducada => solo lectura', async () => {
  await del('/license');
  setSetting(db, 'installed_at', new Date(Date.now() - 30 * 86400000).toISOString());
  license.invalidate();
  const r = await get('/license');
  assert.equal(r.data.status, 'trial_expired');
  assert.equal((await post('/companies', { name: 'X' })).status, 402);
  assert.equal((await post('/license', { key: issueLicense(privatePem, { customer: 'C', plan: 'pro' }).key })).status, 200, 'se puede activar aunque esté bloqueado');
});

test('copia de seguridad', async () => {
  const res = await fetch(`${base}/backup`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});
