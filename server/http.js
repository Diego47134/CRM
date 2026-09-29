export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const toInt = (v, def = null) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

export const idParam = (req) => {
  const id = toInt(req.params.id);
  if (!id || id < 1) throw new HttpError(400, 'Identificador no válido');
  return id;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeTags = (v) => {
  const list = (Array.isArray(v) ? v : String(v).split(','))
    .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);
  return [...new Set(list)].join(',') || null;
};

/**
 * Valida y normaliza un campo según su definición.
 * Tipos: text, textarea, email, url, int, num, bool, date, datetime, enum, ref, tags, json
 */
export function coerceField(key, def, raw, label = key) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') {
    if (def.required) throw new HttpError(400, `El campo «${label}» es obligatorio`);
    if (def.type === 'bool') return 0;
    return def.default !== undefined ? def.default : null;
  }
  switch (def.type) {
    case 'int':
    case 'ref': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new HttpError(400, `«${label}» debe ser un número entero`);
      if (def.min !== undefined && n < def.min) throw new HttpError(400, `«${label}» debe ser ≥ ${def.min}`);
      if (def.max !== undefined && n > def.max) throw new HttpError(400, `«${label}» debe ser ≤ ${def.max}`);
      return n;
    }
    case 'num': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n)) throw new HttpError(400, `«${label}» debe ser un número`);
      if (def.min !== undefined && n < def.min) throw new HttpError(400, `«${label}» debe ser ≥ ${def.min}`);
      if (def.max !== undefined && n > def.max) throw new HttpError(400, `«${label}» debe ser ≤ ${def.max}`);
      return n;
    }
    case 'bool':
      return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on' || raw === 'si' || raw === 'sí' ? 1 : 0;
    case 'date': {
      const s = String(raw).slice(0, 10);
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `«${label}» debe ser una fecha (AAAA-MM-DD)`);
      return s;
    }
    case 'datetime': {
      const s = String(raw).trim();
      if (!DATETIME_RE.test(s) && !DATE_RE.test(s)) throw new HttpError(400, `«${label}» debe ser fecha y hora`);
      return DATE_RE.test(s) ? `${s}T09:00` : s.slice(0, 16).replace(' ', 'T');
    }
    case 'enum': {
      const s = String(raw);
      if (!def.values.includes(s)) throw new HttpError(400, `«${label}» tiene un valor no permitido`);
      return s;
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(s) || s.length > 254) throw new HttpError(400, `«${label}» no es un email válido`);
      return s;
    }
    case 'url': {
      let s = String(raw).trim();
      if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
      try { new URL(s); } catch { throw new HttpError(400, `«${label}» no es una URL válida`); }
      return s.slice(0, 500);
    }
    case 'tags':
      return normalizeTags(raw);
    case 'json':
      return raw; // validado por el llamador
    case 'textarea':
      return String(raw).slice(0, def.max || 20000);
    default: {
      const s = String(raw).trim();
      if (def.required && !s) throw new HttpError(400, `El campo «${label}» es obligatorio`);
      return s.slice(0, def.max || 500) || null;
    }
  }
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Evita inyección de fórmulas al abrir el CSV en hojas de cálculo.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}

export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  // Detecta separador: ; o , (Excel en español usa ;)
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}
