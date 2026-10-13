import { getSetting } from './db.js';
import { HttpError } from './http.js';

/**
 * Cliente del servidor de licencias (tienda). Se activa con la variable LICENSE_SERVER_URL.
 * Permite comprar suscripciones con PayPal desde el CRM y recoge automáticamente las licencias
 * emitidas y sus renovaciones.
 */
export function createStore(env = process.env) {
  const base = String(env.LICENSE_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      throw new HttpError(502, `No se puede contactar con el servidor de licencias (${err.message})`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && method === 'GET' && path.startsWith('/api/licenses/')) return null;
    if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : res.status, data.error || `Servidor de licencias: error ${res.status}`);
    return data;
  }

  return {
    url: base,
    plans: () => call('GET', '/api/plans'),
    checkout: (body) => call('POST', '/api/checkout', body),
    fetchLicense: (instanceId, force) => call('GET', `/api/licenses/${encodeURIComponent(instanceId)}${force ? '?force=1' : ''}`),
  };
}

/**
 * Descarga la licencia vigente de esta instalación y la activa si es más reciente que la actual.
 * Devuelve { updated, remote } (remote = respuesta del servidor o null si no hay suscripción).
 */
export async function syncLicense({ db, license, store }, { force = false } = {}) {
  if (!store) return { updated: false, remote: null };
  const remote = await store.fetchLicense(getSetting(db, 'instance_id'), force);
  if (!remote?.key) return { updated: false, remote };
  const currentKey = getSetting(db, 'license_key');
  if (currentKey === remote.key) return { updated: false, remote };
  const st = license.state();
  const currentValid = currentKey && st.plan !== 'trial' && !st.error;
  // Una licencia comprada en la tienda se sustituye por lo que diga la tienda (renovación, cambio de plan…).
  // Una licencia introducida a mano solo se sustituye si la de la tienda dura más.
  const currentIsManual = currentValid && !st.subscription;
  if (currentIsManual && Date.parse(st.expires) >= Date.parse(remote.expires)) return { updated: false, remote };
  try {
    license.activate(remote.key);
    return { updated: true, remote };
  } catch (err) {
    console.error(`[NexoCRM] Licencia recibida no válida: ${err.message}`);
    return { updated: false, remote, error: err.message };
  }
}

/** Sincroniza al arrancar y después periódicamente (por defecto cada 6 horas). */
export function startAutoSync(ctx, everyMs = 6 * 60 * 60 * 1000) {
  if (!ctx.store) return null;
  const run = () => syncLicense(ctx)
    .then((r) => { if (r.updated) console.log(`[NexoCRM] Licencia actualizada automáticamente (hasta ${r.remote.expires})`); })
    .catch((err) => console.error(`[NexoCRM] Sincronización de licencia: ${err.message}`));
  setTimeout(run, 5000).unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return timer;
}
