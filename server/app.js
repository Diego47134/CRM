import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { authenticate, requireRole } from './auth.js';
import { HttpError } from './http.js';
import { createLicenseService, licenseGuard, requireFeature } from './license.js';
import { createEvents } from './events.js';
import { createStore } from './store.js';
import { crudRouter } from './crud.js';
import { resourceDefs } from './resources.js';
import { setupRoutes, authRoutes, meRoutes } from './routes/auth.js';
import {
  userRoutes, settingsRoutes, licenseRoutes, customFieldRoutes, apiKeyRoutes, webhookRoutes, auditRoutes, backupRoutes,
} from './routes/admin.js';
import { pipelineRoutes } from './routes/pipelines.js';
import { quoteRoutes } from './routes/quotes.js';
import {
  noteRoutes, timelineRoutes, searchRoutes, dealActionRoutes, notificationRoutes, dashboardRoutes, reportRoutes, importRoutes,
} from './routes/misc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

export function createApp({ dbFile = process.env.DB_FILE || path.join(here, '..', 'data', 'crm.db'), store = createStore() } = {}) {
  const db = openDb(dbFile);
  const license = createLicenseService(db);
  const events = createEvents(db, license);
  const resources = resourceDefs(db);
  const ctx = { db, license, events, resources, store };

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });

  app.use('/api', express.json({ limit: '15mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true, version: process.env.npm_package_version || '1.0.0' }));
  api.use('/setup', setupRoutes(ctx));
  api.use('/auth', authRoutes(ctx));

  // A partir de aquí todo requiere autenticación.
  api.use(authenticate(db, license));
  api.use('/license', licenseRoutes(ctx));
  api.use(licenseGuard(license));
  api.use('/me', meRoutes(ctx));
  api.use('/users', userRoutes(ctx));
  api.use('/settings', settingsRoutes(ctx));
  api.use('/pipelines', pipelineRoutes(ctx));
  api.use('/deals', dealActionRoutes(ctx));

  const core = requireFeature(license, 'core');
  api.use('/companies', core, crudRouter(ctx, resources.companies));
  api.use('/contacts', core, crudRouter(ctx, resources.contacts));
  api.use('/deals', core, crudRouter(ctx, resources.deals));
  api.use('/activities', core, crudRouter(ctx, resources.activities));
  api.use('/products', requireFeature(license, 'products'), crudRouter(ctx, resources.products));
  api.use('/tickets', requireFeature(license, 'tickets'), crudRouter(ctx, resources.tickets));
  api.use('/quotes', requireFeature(license, 'quotes'), quoteRoutes(ctx));
  api.use('/notes', noteRoutes(ctx));
  api.use('/timeline', timelineRoutes(ctx));
  api.use('/search', searchRoutes(ctx));
  api.use('/notifications', notificationRoutes(ctx));
  api.use('/dashboard', dashboardRoutes(ctx));
  api.use('/reports', requireFeature(license, 'reports'), reportRoutes(ctx));
  api.use('/import', requireFeature(license, 'import_export'), requireRole('admin', 'manager'), importRoutes(ctx));
  api.use('/custom-fields', customFieldRoutes(ctx));
  api.use('/api-keys', apiKeyRoutes(ctx));
  api.use('/webhooks', webhookRoutes(ctx));
  api.use('/audit', auditRoutes(ctx));
  api.use('/backup', backupRoutes(ctx));

  api.use((_req, _res) => { throw new HttpError(404, 'Ruta no encontrada'); });

  app.use('/api', api);

  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // Manejador de errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La petición es demasiado grande' });
    const msg = String(err.message || '');
    if (msg.includes('FOREIGN KEY constraint failed')) return res.status(400).json({ error: 'Alguna de las referencias indicadas no existe' });
    if (msg.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
    if (msg.includes('NOT NULL constraint failed')) return res.status(400).json({ error: 'Falta algún campo obligatorio' });
    if (msg.includes('CHECK constraint failed')) return res.status(400).json({ error: 'Algún valor no está permitido' });
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return { app, db, license, ctx };
}
