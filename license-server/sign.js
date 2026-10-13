import crypto from 'node:crypto';

/** Acepta la clave privada en PEM, en PEM con "\n" escritos o en base64 (una sola línea). */
export function loadPrivateKey(raw) {
  if (!raw) throw new Error('Falta la variable LICENSE_PRIVATE_KEY');
  let pem = String(raw).trim();
  if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
  pem = pem.replace(/\\n/g, '\n');
  return crypto.createPrivateKey(pem);
}

/** Firma una licencia con el mismo formato que tools/license.js: base64url(JSON).base64url(firma). */
export function signLicense(privateKey, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${sig}`;
}
