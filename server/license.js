import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting, setSetting } from './db.js';
import { HttpError } from './http.js';

/**
 * Sistema de licencias anuales.
 *
 * Una licencia es `base64url(JSON).base64url(firma Ed25519)`. El proveedor la firma con su
 * clave privada (tools/license.js) y el CRM la verifica con la clave pública incluida en
 * server/license-public.pem. Sin licencia, el CRM funciona en modo prueba durante TRIAL_DAYS.
 */

export const TRIAL_DAYS = 14;
export const TRIAL_SEATS = 5;
export const GRACE_DAYS = 7;

export const FEATURES = {
  core: 'Contactos, empresas, oportunidades, actividades y panel',
  import_export: 'Importación y exportación CSV',
  products: 'Catálogo de productos',
  quotes: 'Presupuestos y facturas',
  tickets: 'Soporte / tickets',
  reports: 'Informes avanzados',
  custom_fields: 'Campos personalizados',
  api: 'API REST con claves',
  webhooks: 'Webhooks',
  audit: 'Registro de auditoría',
};

export const PLANS = {
  starter: { label: 'Starter', seats: 3, features: ['core', 'import_export', 'products'] },
  pro: { label: 'Profesional', seats: 10, features: ['core', 'import_export', 'products', 'quotes', 'tickets', 'reports', 'custom_fields'] },
  business: { label: 'Business', seats: 50, features: Object.keys(FEATURES) },
};

const ALL_FEATURES = Object.keys(FEATURES);
const DAY = 86400000;

const here = path.dirname(fileURLToPath(import.meta.url));

function loadPublicKey() {
  const file = process.env.LICENSE_PUBLIC_KEY_FILE || path.join(here, 'license-public.pem');
  try {
    return crypto.createPublicKey(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function decodeLicense(key, publicKey) {
  if (typeof key !== 'string') throw new Error('Formato de licencia no válido');
  const [payloadB64, sigB64] = key.trim().split('.');
  if (!payloadB64 || !sigB64) throw new Error('Formato de licencia no válido');
  if (!publicKey) throw new Error('Esta instalación no tiene clave pública de licencias (server/license-public.pem)');
  const ok = crypto.verify(null, Buffer.from(payloadB64), publicKey, Buffer.from(sigB64, 'base64url'));
  if (!ok) throw new Error('La firma de la licencia no es válida');
  const data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (!data.expires || !data.plan) throw new Error('Licencia incompleta');
  return data;
}

export function createLicenseService(db) {
  const publicKey = loadPublicKey();
  let cache = null;
  let cacheAt = 0;

  function compute() {
    const now = Date.now();
    const instanceId = getSetting(db, 'instance_id');
    const key = getSetting(db, 'license_key');
    if (key) {
      try {
        const lic = decodeLicense(key, publicKey);
        if (lic.instance_id && lic.instance_id !== instanceId) throw new Error('La licencia pertenece a otra instalación');
        const plan = PLANS[lic.plan] || PLANS.starter;
        const expires = Date.parse(lic.expires);
        const daysLeft = Math.ceil((expires - now) / DAY);
        let status = 'active';
        if (daysLeft < 0) status = daysLeft >= -GRACE_DAYS ? 'grace' : 'expired';
        return {
          status,
          plan: lic.plan,
          planLabel: plan.label,
          customer: lic.customer,
          email: lic.email,
          licenseId: lic.id,
          seats: lic.seats ?? plan.seats,
          features: Array.isArray(lic.features) ? lic.features : plan.features,
          issued: lic.issued,
          expires: lic.expires,
          daysLeft,
          readOnly: status === 'expired',
          instanceId,
        };
      } catch (err) {
        return baseTrial(now, instanceId, err.message);
      }
    }
    return baseTrial(now, instanceId);
  }

  function baseTrial(now, instanceId, error) {
    const installed = Date.parse(getSetting(db, 'installed_at')) || now;
    const expires = installed + TRIAL_DAYS * DAY;
    const daysLeft = Math.ceil((expires - now) / DAY);
    const expired = daysLeft < 0;
    return {
      status: expired ? 'trial_expired' : 'trial',
      plan: 'trial',
      planLabel: 'Prueba gratuita',
      seats: TRIAL_SEATS,
      features: ALL_FEATURES,
      expires: new Date(expires).toISOString(),
      daysLeft,
      readOnly: expired,
      instanceId,
      error,
    };
  }

  const service = {
    publicKeyLoaded: !!publicKey,
    state() {
      if (!cache || Date.now() - cacheAt > 30000) {
        cache = compute();
        cacheAt = Date.now();
      }
      return cache;
    },
    invalidate() { cache = null; },
    hasFeature(f) { return service.state().features.includes(f); },
    activate(key) {
      const lic = decodeLicense(key, publicKey);
      if (lic.instance_id && lic.instance_id !== getSetting(db, 'instance_id')) {
        throw new Error('La licencia pertenece a otra instalación (ID de instancia distinto)');
      }
      if (Date.parse(lic.expires) < Date.now() - GRACE_DAYS * DAY) throw new Error('La licencia ha caducado');
      setSetting(db, 'license_key', key.trim());
      service.invalidate();
      return service.state();
    },
    remove() {
      db.prepare("DELETE FROM settings WHERE key = 'license_key'").run();
      service.invalidate();
    },
    activeSeatsUsed() {
      return db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;
    },
    assertSeatAvailable() {
      const { seats } = service.state();
      if (service.activeSeatsUsed() >= seats) {
        throw new HttpError(402, `Has alcanzado el límite de ${seats} usuarios de tu licencia. Amplía tu plan para añadir más.`);
      }
    },
  };
  return service;
}

export const requireFeature = (license, feature) => (_req, _res, next) => {
  if (!license.hasFeature(feature)) {
    throw new HttpError(402, `Tu plan no incluye: ${FEATURES[feature] || feature}. Amplía tu licencia para usarlo.`);
  }
  next();
};

// Bloquea escrituras si la licencia/prueba ha caducado (modo solo lectura).
export const licenseGuard = (license) => (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (license.state().readOnly) {
    throw new HttpError(402, 'Tu licencia ha caducado. El CRM está en modo solo lectura hasta que la renueves.');
  }
  next();
};
