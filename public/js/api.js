const TOKEN_KEY = 'crm_token';

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ } },
};

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, query, raw } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error || 'Error');
    return res;
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Error ${res.status}`, data);
  }
  return data;
}

api.get = (p, query) => api(p, { query });
api.post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
api.patch = (p, body) => api(p, { method: 'PATCH', body });
api.put = (p, body) => api(p, { method: 'PUT', body });
api.del = (p, query) => api(p, { method: 'DELETE', query });

/** Descarga un fichero autenticado (CSV, copia de seguridad…). */
export async function download(path, query, fallbackName = 'descarga') {
  const res = await api(path, { query, raw: true });
  const cd = res.headers.get('content-disposition') || '';
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
