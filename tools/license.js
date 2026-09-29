#!/usr/bin/env node
/**
 * Herramienta del PROVEEDOR para gestionar licencias de NexoCRM.
 *
 *   node tools/license.js keygen
 *       Genera el par de claves Ed25519. La privada queda en tools/keys/private.pem (¡NO la subas a git!)
 *       y la pública se copia a server/license-public.pem (esa sí se distribuye con el CRM).
 *
 *   node tools/license.js issue --customer "Cliente SL" --email cliente@x.com --plan pro [--seats 10] [--days 365] [--instance <id>] [--features core,quotes]
 *       Emite una licencia firmada. Si indicas --instance, solo funcionará en esa instalación
 *       (el cliente ve su ID de instancia en Configuración → Licencia).
 *
 *   node tools/license.js inspect <licencia>
 *       Muestra el contenido de una licencia y verifica su firma.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS, FEATURES, decodeLicense } from '../server/license.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = process.env.LICENSE_KEYS_DIR || path.join(here, 'keys');
const PRIVATE = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_DIST = process.env.LICENSE_PUBLIC_KEY_FILE || path.join(here, '..', 'server', 'license-public.pem');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(argv[i]);
  }
  return out;
}

function keygen(opts) {
  if (fs.existsSync(PRIVATE) && !opts.force) {
    console.error(`Ya existe ${PRIVATE}. Usa --force para sobrescribir (invalidará todas las licencias emitidas).`);
    process.exit(1);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PRIVATE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(PUBLIC_DIST, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`Clave privada: ${PRIVATE}  (guárdala en un lugar seguro, con copia de seguridad)`);
  console.log(`Clave pública: ${PUBLIC_DIST}  (se distribuye con el CRM)`);
}

export function issueLicense(privateKeyPem, { customer, email, plan, seats, days = 365, instance, features, id }) {
  if (!PLANS[plan]) throw new Error(`Plan no válido. Usa: ${Object.keys(PLANS).join(', ')}`);
  const issued = new Date();
  const payload = {
    id: id || `LIC-${issued.getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    customer,
    email,
    plan,
    seats: Number(seats || PLANS[plan].seats),
    issued: issued.toISOString(),
    expires: new Date(issued.getTime() + Number(days) * 86400000).toISOString(),
  };
  if (instance) payload.instance_id = instance;
  if (features) {
    const list = String(features).split(',').map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((f) => !FEATURES[f]);
    if (bad.length) throw new Error(`Funcionalidades desconocidas: ${bad.join(', ')}`);
    payload.features = list;
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  return { key: `${body}.${sig}`, payload };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  if (cmd === 'keygen') return keygen(opts);
  if (cmd === 'issue') {
    if (!fs.existsSync(PRIVATE)) { console.error('No hay clave privada. Ejecuta primero: npm run license:keygen'); process.exit(1); }
    if (!opts.customer) { console.error('Falta --customer "Nombre del cliente"'); process.exit(1); }
    const { key, payload } = issueLicense(fs.readFileSync(PRIVATE, 'utf8'), {
      customer: opts.customer, email: opts.email, plan: opts.plan || 'pro', seats: opts.seats,
      days: opts.days || 365, instance: opts.instance, features: opts.features,
    });
    console.log('\nLicencia emitida:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\nClave para el cliente (cópiala completa):\n');
    console.log(key);
    console.log('');
    return;
  }
  if (cmd === 'inspect') {
    const key = opts._[0];
    if (!key) { console.error('Uso: node tools/license.js inspect <licencia>'); process.exit(1); }
    const pub = fs.existsSync(PUBLIC_DIST) ? crypto.createPublicKey(fs.readFileSync(PUBLIC_DIST, 'utf8')) : null;
    try {
      console.log(JSON.stringify(decodeLicense(key, pub), null, 2));
      console.log('Firma: válida');
    } catch (e) {
      console.error(`Licencia no válida: ${e.message}`);
      process.exit(1);
    }
    return;
  }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
}

// ¿Se ejecuta como comando (y no importado desde otro módulo)?
// En Windows la letra de unidad puede venir en minúsculas, así que se compara sin distinguir mayúsculas.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(path.resolve(process.argv[1]));
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isMainModule()) main();
