import { Router } from 'express';
import { HttpError, coerceField, idParam, toInt, toCsv } from './http.js';
import { getSetting } from './db.js';

/**
 * Crea un router REST (listar, ver, crear, editar, borrar, borrado masivo, exportar CSV)
 * a partir de la definición declarativa de un recurso.
 */
export function crudRouter(ctx, def) {
  const { db, events, license } = ctx;
  const r = Router();
  const A = def.alias;

  const byIdSql = `${def.select} WHERE ${A}.id = ?`;

  const customDefs = () => (def.customEntity
    ? db.prepare('SELECT * FROM custom_fields WHERE entity = ? ORDER BY position, id').all(def.customEntity)
    : []);

  function ownScope(req) {
    return def.ownerScoped && req.user.role === 'sales' && getSetting(db, 'sales_see_own_only') === '1';
  }

  function assertCanTouch(req, row) {
    if (ownScope(req) && row.owner_id !== req.user.id) throw new HttpError(403, 'Solo puedes acceder a tus propios registros');
  }

  function loadOr404(req, id) {
    const row = db.prepare(byIdSql).get(id);
    if (!row) throw new HttpError(404, `${def.label} no encontrado`);
    assertCanTouch(req, row);
    return row;
  }

  function buildWhere(req) {
    const where = [];
    const params = [];
    const q = String(req.query.q || '').trim();
    if (q && def.search?.length) {
      const terms = q.split(/\s+/).slice(0, 5);
      for (const t of terms) {
        where.push(`(${def.search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
        for (let i = 0; i < def.search.length; i++) params.push(`%${t}%`);
      }
    }
    for (const [key, spec] of Object.entries(def.filters || {})) {
      const v = req.query[key];
      if (v === undefined || v === '') continue;
      if (typeof spec === 'function') {
        const res = spec(v, req);
        if (res) { where.push(res[0]); params.push(...res[1]); }
      } else if (v === 'none') {
        where.push(`${spec} IS NULL`);
      } else {
        where.push(`${spec} = ?`);
        params.push(v === 'me' ? req.user.id : v);
      }
    }
    if (req.query.tag) {
      where.push(`(',' || COALESCE(${A}.tags, '') || ',') LIKE ?`);
      params.push(`%,${String(req.query.tag).toLowerCase()},%`);
    }
    if (ownScope(req)) { where.push(`${A}.owner_id = ?`); params.push(req.user.id); }
    return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
  }

  function orderBy(req) {
    const key = String(req.query.sort || '');
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    if (def.sorts?.[key]) return ` ORDER BY ${def.sorts[key]} ${dir}, ${A}.id DESC`;
    return ` ORDER BY ${def.defaultSort || `${A}.id DESC`}`;
  }

  function sanitizeCustom(input, existing) {
    const defs = customDefs();
    if (!defs.length) return existing ?? null;
    const prev = existing ? JSON.parse(existing) : {};
    const out = { ...prev };
    const src = input && typeof input === 'object' ? input : {};
    for (const f of defs) {
      if (!(f.key in src)) continue;
      const type = { number: 'num', date: 'date', checkbox: 'bool', url: 'url', textarea: 'textarea' }[f.type] || 'text';
      let v = coerceField(f.key, { type, required: !!f.required }, src[f.key], f.label);
      if (f.type === 'select' && v != null) {
        const opts = JSON.parse(f.options || '[]');
        if (!opts.includes(v)) throw new HttpError(400, `«${f.label}» tiene un valor no permitido`);
      }
      if (f.type === 'checkbox') v = !!v;
      out[f.key] = v;
    }
    return JSON.stringify(out);
  }

  function readBody(req, existing) {
    const body = req.body || {};
    const data = {};
    for (const [key, f] of Object.entries(def.fields)) {
      if (f.readonly) continue;
      let v = body[key];
      if (v === undefined && !existing && f.default !== undefined) v = f.default;
      if (v === undefined && !existing && f.required) throw new HttpError(400, `El campo «${f.label || key}» es obligatorio`);
      const coerced = coerceField(key, f, v, f.label || key);
      if (coerced !== undefined) data[key] = coerced;
    }
    if (def.customEntity && body.custom !== undefined) data.custom = sanitizeCustom(body.custom, existing?.custom);
    return data;
  }

  const decorate = (row) => {
    if (!row) return row;
    if (row.custom && typeof row.custom === 'string') {
      try { row.custom = JSON.parse(row.custom); } catch { row.custom = {}; }
    }
    return def.decorate ? def.decorate(row) : row;
  };

  // ---- Rutas ----
  r.get('/', (req, res) => {
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 500);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const { sql, params } = buildWhere(req);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${def.select}${sql})`).get(...params).n;
    const rows = db.prepare(`${def.select}${sql}${orderBy(req)} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ data: rows.map(decorate), total, page, limit });
  });

  if (def.csv) {
    r.get('/export.csv', (req, res) => {
      if (!license.hasFeature('import_export')) throw new HttpError(402, 'Tu plan no incluye exportación CSV');
      const { sql, params } = buildWhere(req);
      const rows = db.prepare(`${def.select}${sql}${orderBy(req)} LIMIT 100000`).all(...params);
      const cols = [...def.csv];
      for (const f of customDefs()) cols.push({ key: `custom.${f.key}`, label: f.label });
      const flat = rows.map((row) => {
        const custom = row.custom ? JSON.parse(row.custom) : {};
        const o = { ...row };
        for (const [k, v] of Object.entries(custom)) o[`custom.${k}`] = v;
        return o;
      });
      events.record(req, 'export', def.name, null, `${rows.length} registros`);
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${def.name}-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(toCsv(flat, cols));
    });
  }

  r.get('/:id', (req, res) => {
    const row = loadOr404(req, idParam(req));
    res.json(decorate(def.detail ? def.detail(row, req) : row));
  });

  r.post('/', (req, res) => {
    const data = readBody(req, null);
    if (def.fields.owner_id && data.owner_id === undefined) data.owner_id = req.user.id;
    if (ownScope(req)) data.owner_id = req.user.id;
    if (def.hasCreatedBy !== false) data.created_by = req.user.id;
    def.beforeSave?.(data, null, req);
    const keys = Object.keys(data);
    const info = db.prepare(`INSERT INTO ${def.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => data[k]));
    const row = db.prepare(byIdSql).get(Number(info.lastInsertRowid));
    def.afterSave?.(row, null, req);
    events.record(req, 'created', def.name, row.id, def.summary(row));
    res.status(201).json(decorate(row));
  });

  r.patch('/:id', (req, res) => {
    const id = idParam(req);
    const existing = loadOr404(req, id);
    const data = readBody(req, existing);
    if (ownScope(req)) delete data.owner_id;
    def.beforeSave?.(data, existing, req);
    const keys = Object.keys(data);
    if (keys.length) {
      db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => data[k]), id);
    }
    const row = db.prepare(byIdSql).get(id);
    def.afterSave?.(row, existing, req);
    events.record(req, 'updated', def.name, id, def.summary(row));
    res.json(decorate(row));
  });

  r.delete('/:id', (req, res) => {
    const id = idParam(req);
    const existing = loadOr404(req, id);
    if (def.canDelete && !def.canDelete(req, existing)) throw new HttpError(403, 'No tienes permisos para eliminar este registro');
    db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
    events.record(req, 'deleted', def.name, id, def.summary(existing));
    res.json({ ok: true });
  });

  r.post('/bulk', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 1000) : [];
    if (!ids.length) throw new HttpError(400, 'No hay registros seleccionados');
    const action = req.body.action;
    let n = 0;
    for (const id of ids) {
      const row = db.prepare(byIdSql).get(id);
      if (!row) continue;
      try { assertCanTouch(req, row); } catch { continue; }
      if (action === 'delete') {
        if (def.canDelete && !def.canDelete(req, row)) continue;
        db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
        events.record(req, 'deleted', def.name, id, def.summary(row));
      } else if (action === 'update') {
        const allowed = def.bulkFields || ['owner_id'];
        const data = {};
        for (const k of allowed) {
          if (req.body.data?.[k] !== undefined) data[k] = coerceField(k, def.fields[k], req.body.data[k], def.fields[k].label || k);
        }
        if (ownScope(req)) delete data.owner_id;
        if (!Object.keys(data).length) throw new HttpError(400, 'Nada que actualizar');
        def.beforeSave?.(data, row, req);
        const keys = Object.keys(data);
        db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...keys.map((k) => data[k]), id);
        events.record(req, 'updated', def.name, id, def.summary(row));
      } else if (action === 'add_tag' && def.fields.tags) {
        const tag = coerceField('tags', { type: 'tags' }, req.body.tag);
        if (!tag) throw new HttpError(400, 'Etiqueta vacía');
        const merged = [...new Set([...(row.tags ? row.tags.split(',') : []), ...tag.split(',')])].join(',');
        db.prepare(`UPDATE ${def.table} SET tags = ?, updated_at = datetime('now') WHERE id = ?`).run(merged, id);
      } else {
        throw new HttpError(400, 'Acción no válida');
      }
      n++;
    }
    res.json({ ok: true, affected: n });
  });

  return r;
}
