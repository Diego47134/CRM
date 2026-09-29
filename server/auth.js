import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { HttpError } from './http.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 12;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  }
  if (password.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function jwtSecret(db) {
  return process.env.JWT_SECRET || getSetting(db, 'jwt_secret');
}

export function signToken(db, user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: user.id, tv: user.token_version, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const sig = crypto.createHmac('sha256', jwtSecret(db)).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(db, token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', jwtSecret(db)).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey() {
  const raw = 'nxk_' + crypto.randomBytes(24).toString('base64url');
  return { raw, prefix: raw.slice(0, 10), hash: hashApiKey(raw) };
}

export const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active,
  phone: u.phone, title: u.title, color: u.color, last_login: u.last_login, created_at: u.created_at,
});

export function authenticate(db, { hasFeature }) {
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byKey = db.prepare('SELECT u.*, k.id AS api_key_id FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?');
  const touchKey = db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?");

  return (req, _res, next) => {
    const apiKey = req.get('x-api-key');
    if (apiKey) {
      if (!hasFeature('api')) throw new HttpError(403, 'Tu plan no incluye acceso por API');
      const user = byKey.get(hashApiKey(apiKey));
      if (!user || !user.active) throw new HttpError(401, 'API key no válida');
      touchKey.run(user.api_key_id);
      req.user = user;
      req.viaApiKey = true;
      return next();
    }
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const data = token && verifyToken(db, token);
    if (!data) throw new HttpError(401, 'Sesión no válida o caducada');
    const user = byId.get(data.sub);
    if (!user || !user.active || user.token_version !== data.tv) throw new HttpError(401, 'Sesión no válida o caducada');
    req.user = user;
    next();
  };
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'No tienes permisos para esta acción');
  next();
};

// Limitador simple en memoria para intentos de login (por IP + email).
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function checkLoginRate(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
  }
}

export function registerLoginFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first >= WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else entry.count++;
  if (attempts.size > 10000) attempts.clear();
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}
