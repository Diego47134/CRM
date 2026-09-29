import { Router } from 'express';
import {
  hashPassword, verifyPassword, validatePassword, signToken, publicUser,
  checkLoginRate, registerLoginFailure, clearLoginFailures,
} from '../auth.js';
import { HttpError, coerceField } from '../http.js';
import { createDefaultPipeline, setSetting, tx } from '../db.js';
import { seedDemo } from '../demo.js';

export const USER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export function setupRoutes({ db, license }) {
  const r = Router();
  const needsSetup = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

  r.get('/status', (_req, res) => {
    res.json({ needsSetup: needsSetup() });
  });

  r.post('/', (req, res) => {
    if (!needsSetup()) throw new HttpError(409, 'El CRM ya está configurado');
    const b = req.body || {};
    const name = coerceField('name', { type: 'text', required: true }, b.name, 'Nombre');
    const email = coerceField('email', { type: 'email', required: true }, b.email, 'Email');
    validatePassword(b.password);
    const companyName = coerceField('company_name', { type: 'text' }, b.company_name, 'Empresa');
    const user = tx(db, () => {
      const info = db.prepare('INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, hashPassword(b.password), 'admin', USER_COLORS[0]);
      if (companyName) setSetting(db, 'company_name', companyName);
      if (b.currency && /^[A-Z]{3}$/.test(b.currency)) setSetting(db, 'currency', b.currency);
      createDefaultPipeline(db);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
      if (b.demo) seedDemo(db, u.id);
      return u;
    });
    license.invalidate();
    res.status(201).json({ token: signToken(db, user), user: publicUser(user) });
  });

  return r;
}

export function authRoutes({ db, events }) {
  const r = Router();

  r.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${email}`;
    checkLoginRate(key);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      registerLoginFailure(key);
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }
    if (!user.active) throw new HttpError(403, 'Tu usuario está desactivado. Contacta con el administrador.');
    clearLoginFailures(key);
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    req.user = user;
    events.record(req, 'login', 'users', user.id, user.email);
    res.json({ token: signToken(db, user), user: publicUser(user) });
  });

  return r;
}

export function meRoutes({ db, events }) {
  const r = Router();

  r.get('/', (req, res) => res.json(publicUser(req.user)));

  r.patch('/', (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.name !== undefined) data.name = coerceField('name', { type: 'text', required: true }, b.name, 'Nombre');
    if (b.phone !== undefined) data.phone = coerceField('phone', { type: 'text' }, b.phone);
    if (b.title !== undefined) data.title = coerceField('title', { type: 'text' }, b.title);
    if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) data.color = b.color;
    const keys = Object.keys(data);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => data[k]), req.user.id);
    }
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
  });

  r.post('/password', (req, res) => {
    const { current, password } = req.body || {};
    if (!verifyPassword(current || '', req.user.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
    validatePassword(password);
    db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(password), req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    events.record(req, 'password_changed', 'users', user.id, user.email);
    res.json({ token: signToken(db, user) });
  });

  return r;
}
