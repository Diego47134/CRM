import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, validatePassword, publicUser, requireRole, generateApiKey } from '../auth.js';
import { HttpError, coerceField, idParam, toInt } from '../http.js';
import { getSetting, getSettings, setSetting, DEFAULT_SETTINGS } from '../db.js';
import { syncLicense } from '../store.js';
import { requireFeature, FEATURES, PLANS } from '../license.js';
import { USER_COLORS } from './auth.js';

const PRIVATE_SETTINGS = new Set(['jwt_secret', 'license_key']);

export function userRoutes({ db, license, events }) {
  const r = Router();
  const adminOnly = requireRole('admin');

  r.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY active DESC, name').all();
    res.json(rows.map(publicUser));
  });

  r.post('/', adminOnly, (req, res) => {
    const b = req.body || {};
    const name = coerceField('name', { type: 'text', required: true }, b.name, 'Nombre');
    const email = coerceField('email', { type: 'email', required: true }, b.email, 'Email');
    const role = coerceField('role', { type: 'enum', values: ['admin', 'manager', 'sales'], default: 'sales' }, b.role ?? 'sales', 'Rol');
    validatePassword(b.password);
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Ya existe un usuario con ese email');
    license.assertSeatAvailable();
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const info = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, title, color) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, email, hashPassword(b.password), role, b.phone || null, b.title || null, USER_COLORS[count % USER_COLORS.length]);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    events.record(req, 'created', 'users', user.id, user.email);
    res.status(201).json(publicUser(user));
  });

  r.patch('/:id', adminOnly, (req, res) => {
    const id = idParam(req);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Usuario no encontrado');
    const b = req.body || {};
    const data = {};
    if (b.name !== undefined) data.name = coerceField('name', { type: 'text', required: true }, b.name, 'Nombre');
    if (b.email !== undefined) {
      data.email = coerceField('email', { type: 'email', required: true }, b.email, 'Email');
      if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(data.email, id)) throw new HttpError(409, 'Ya existe un usuario con ese email');
    }
    if (b.role !== undefined) data.role = coerceField('role', { type: 'enum', values: ['admin', 'manager', 'sales'] }, b.role, 'Rol');
    if (b.phone !== undefined) data.phone = b.phone || null;
    if (b.title !== undefined) data.title = b.title || null;
    if (b.active !== undefined) {
      data.active = b.active ? 1 : 0;
      if (data.active && !existing.active) license.assertSeatAvailable();
    }
    if (b.password) {
      validatePassword(b.password);
      data.password_hash = hashPassword(b.password);
    }
    const demoting = (data.role && data.role !== 'admin') || data.active === 0;
    if (existing.role === 'admin' && demoting) {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw new HttpError(400, 'Debe existir al menos un administrador activo');
    }
    const keys = Object.keys(data);
    if (keys.length) {
      const bump = data.password_hash || data.active === 0 || data.role ? ', token_version = token_version + 1' : '';
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}${bump}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => data[k]), id);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    events.record(req, 'updated', 'users', id, user.email);
    res.json(publicUser(user));
  });

  r.delete('/:id', adminOnly, (req, res) => {
    const id = idParam(req);
    if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propio usuario');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    if (user.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw new HttpError(400, 'Debe existir al menos un administrador activo');
    }
    // Reasignar registros al usuario que elimina (o al indicado)
    const to = toInt(req.query.reassign_to, req.user.id);
    for (const t of ['contacts', 'companies', 'deals', 'activities', 'tickets', 'quotes']) {
      db.prepare(`UPDATE ${t} SET owner_id = ? WHERE owner_id = ?`).run(to, id);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    events.record(req, 'deleted', 'users', id, user.email);
    res.json({ ok: true });
  });

  return r;
}

export function settingsRoutes({ db, events }) {
  const r = Router();

  r.get('/', (_req, res) => {
    const s = getSettings(db);
    for (const k of PRIVATE_SETTINGS) delete s[k];
    res.json(s);
  });

  r.patch('/', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const editable = new Set([...Object.keys(DEFAULT_SETTINGS), 'company_logo', 'company_website', 'brand_color']);
    for (const [k, v] of Object.entries(b)) {
      if (!editable.has(k)) continue;
      if (['next_quote_number', 'next_invoice_number'].includes(k) && (!Number.isInteger(Number(v)) || Number(v) < 1)) {
        throw new HttpError(400, 'La numeración debe ser un entero positivo');
      }
      if (k === 'company_logo' && v && (!/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(v) || v.length > 400000)) {
        throw new HttpError(400, 'Logo no válido (PNG/JPG/SVG/WebP, máx. 300 KB)');
      }
      if (k === 'brand_color' && v && !/^#[0-9a-f]{6}$/i.test(v)) throw new HttpError(400, 'Color no válido');
      setSetting(db, k, typeof v === 'string' ? v.slice(0, 400000) : v);
    }
    events.record(req, 'updated', 'settings', null, Object.keys(b).join(', '));
    const s = getSettings(db);
    for (const k of PRIVATE_SETTINGS) delete s[k];
    res.json(s);
  });

  return r;
}

export function licenseRoutes({ db, license, events, store }) {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json({
      ...license.state(),
      seatsUsed: license.activeSeatsUsed(),
      publicKeyLoaded: license.publicKeyLoaded,
      allFeatures: FEATURES,
      plans: PLANS,
      storeEnabled: !!store,
    });
  });

  // ---- Compra con PayPal a través del servidor de licencias ----
  const needStore = () => {
    if (!store) throw new HttpError(404, 'La compra en línea no está configurada en esta instalación');
  };

  r.get('/store/plans', async (_req, res) => {
    needStore();
    res.json(await store.plans());
  });

  r.post('/store/checkout', requireRole('admin'), async (req, res) => {
    needStore();
    const { plan, interval } = req.body || {};
    let crmUrl;
    try { crmUrl = new URL(String(req.body?.crm_url)).origin; } catch { throw new HttpError(400, 'URL del CRM no válida'); }
    const result = await store.checkout({
      plan, interval, crm_url: crmUrl,
      instance_id: getSetting(db, 'instance_id'),
      customer: getSetting(db, 'company_name'),
      email: req.user.email,
    });
    events.record(req, 'checkout', 'license', null, `${plan} · ${interval}`);
    res.json(result);
  });

  r.post('/store/sync', requireRole('admin'), async (req, res) => {
    needStore();
    const result = await syncLicense({ db, license, store }, { force: true });
    if (result.updated) events.record(req, 'activated', 'license', null, `${result.remote.plan} · ${result.remote.interval} (automática)`);
    res.json({
      updated: result.updated,
      subscription: result.remote ? { status: result.remote.status, plan: result.remote.plan, interval: result.remote.interval, expires: result.remote.expires } : null,
      error: result.error,
      license: { ...license.state(), seatsUsed: license.activeSeatsUsed() },
    });
  });

  r.post('/', requireRole('admin'), (req, res) => {
    try {
      const state = license.activate(String(req.body?.key || ''));
      events.record(req, 'activated', 'license', null, `${state.plan} · ${state.customer}`);
      res.json({ ...state, seatsUsed: license.activeSeatsUsed() });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message);
    }
  });

  r.delete('/', requireRole('admin'), (req, res) => {
    license.remove();
    events.record(req, 'removed', 'license', null, null);
    res.json(license.state());
  });

  return r;
}

export function customFieldRoutes({ db, license, events }) {
  const r = Router();
  const gate = requireFeature(license, 'custom_fields');

  r.get('/', (req, res) => {
    const rows = req.query.entity
      ? db.prepare('SELECT * FROM custom_fields WHERE entity = ? ORDER BY position, id').all(req.query.entity)
      : db.prepare('SELECT * FROM custom_fields ORDER BY entity, position, id').all();
    res.json(rows.map((f) => ({ ...f, options: f.options ? JSON.parse(f.options) : [], required: !!f.required })));
  });

  const read = (b) => {
    const entity = coerceField('entity', { type: 'enum', values: ['contacts', 'companies', 'deals', 'tickets', 'products'], required: true }, b.entity, 'Entidad');
    const label = coerceField('label', { type: 'text', required: true, max: 100 }, b.label, 'Etiqueta');
    const type = coerceField('type', { type: 'enum', values: ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'url'], required: true }, b.type, 'Tipo');
    const options = Array.isArray(b.options) ? b.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 100) : [];
    if (type === 'select' && !options.length) throw new HttpError(400, 'Un desplegable necesita al menos una opción');
    return { entity, label, type, options: JSON.stringify(options), required: b.required ? 1 : 0, position: toInt(b.position, 0) };
  };

  r.post('/', requireRole('admin'), gate, (req, res) => {
    const d = read(req.body || {});
    const base = d.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'campo';
    let key = base;
    for (let i = 2; db.prepare('SELECT 1 FROM custom_fields WHERE entity = ? AND key = ?').get(d.entity, key); i++) key = `${base}_${i}`;
    const info = db.prepare('INSERT INTO custom_fields (entity, key, label, type, options, required, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(d.entity, key, d.label, d.type, d.options, d.required, d.position);
    events.record(req, 'created', 'custom_fields', Number(info.lastInsertRowid), `${d.entity}.${key}`);
    res.status(201).json({ id: Number(info.lastInsertRowid), key, ...d, options: JSON.parse(d.options) });
  });

  r.patch('/:id', requireRole('admin'), gate, (req, res) => {
    const id = idParam(req);
    const existing = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Campo no encontrado');
    const d = read({ ...existing, options: JSON.parse(existing.options || '[]'), ...req.body, entity: existing.entity });
    db.prepare('UPDATE custom_fields SET label = ?, type = ?, options = ?, required = ?, position = ? WHERE id = ?')
      .run(d.label, d.type, d.options, d.required, d.position, id);
    res.json({ ok: true });
  });

  r.delete('/:id', requireRole('admin'), (req, res) => {
    db.prepare('DELETE FROM custom_fields WHERE id = ?').run(idParam(req));
    res.json({ ok: true });
  });

  return r;
}

export function apiKeyRoutes({ db, license }) {
  const r = Router();
  r.use(requireFeature(license, 'api'));

  r.get('/', (req, res) => {
    res.json(db.prepare('SELECT id, name, prefix, last_used, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC').all(req.user.id));
  });

  r.post('/', (req, res) => {
    const name = coerceField('name', { type: 'text', required: true, max: 100 }, req.body?.name, 'Nombre');
    const key = generateApiKey();
    const info = db.prepare('INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES (?, ?, ?, ?)').run(req.user.id, name, key.prefix, key.hash);
    res.status(201).json({ id: Number(info.lastInsertRowid), name, key: key.raw, prefix: key.prefix });
  });

  r.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(idParam(req), req.user.id);
    res.json({ ok: true });
  });

  return r;
}

export function webhookRoutes({ db, license, events }) {
  const r = Router();
  r.use(requireRole('admin'), requireFeature(license, 'webhooks'));

  r.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM webhooks ORDER BY id').all()));

  r.post('/', (req, res) => {
    const url = coerceField('url', { type: 'url', required: true }, req.body?.url, 'URL');
    const eventsList = String(req.body?.events || '*').split(',').map((s) => s.trim()).filter(Boolean).join(',') || '*';
    const secret = crypto.randomBytes(24).toString('hex');
    const info = db.prepare('INSERT INTO webhooks (url, events, secret) VALUES (?, ?, ?)').run(url, eventsList, secret);
    res.status(201).json(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(Number(info.lastInsertRowid)));
  });

  r.patch('/:id', (req, res) => {
    const id = idParam(req);
    const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
    if (!hook) throw new HttpError(404, 'Webhook no encontrado');
    const url = req.body?.url !== undefined ? coerceField('url', { type: 'url', required: true }, req.body.url, 'URL') : hook.url;
    const ev = req.body?.events !== undefined ? String(req.body.events).trim() || '*' : hook.events;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : hook.active;
    db.prepare('UPDATE webhooks SET url = ?, events = ?, active = ? WHERE id = ?').run(url, ev, active, id);
    res.json(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id));
  });

  r.post('/:id/test', (req, res) => {
    const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(idParam(req));
    if (!hook) throw new HttpError(404, 'Webhook no encontrado');
    events.testHook(hook);
    res.json({ ok: true });
  });

  r.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(idParam(req));
    res.json({ ok: true });
  });

  return r;
}

export function auditRoutes({ db, license }) {
  const r = Router();
  r.use(requireRole('admin', 'manager'), requireFeature(license, 'audit'));

  r.get('/', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.entity) { where.push('a.entity = ?'); params.push(req.query.entity); }
    if (req.query.user_id) { where.push('a.user_id = ?'); params.push(req.query.user_id); }
    if (req.query.action) { where.push('a.action = ?'); params.push(req.query.action); }
    const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(toInt(req.query.limit, 50), 500);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a${sql}`).get(...params).n;
    const data = db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id${sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    res.json({ data, total, page, limit });
  });

  return r;
}

export function backupRoutes({ db, events }) {
  const r = Router();
  r.get('/', requireRole('admin'), (req, res) => {
    const tmp = path.join(os.tmpdir(), `crm-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    events.record(req, 'backup', 'system', null, null);
    res.download(tmp, `crm-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(tmp, { force: true }, () => {}));
  });
  return r;
}
