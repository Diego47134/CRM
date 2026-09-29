import { Router } from 'express';
import { HttpError, coerceField, idParam, parseCsv, toInt } from '../http.js';
import { getSetting, tx } from '../db.js';

const NOTE_TARGETS = ['contact_id', 'company_id', 'deal_id', 'ticket_id'];

function ownOnly(db, req) {
  return req.user.role === 'sales' && getSetting(db, 'sales_see_own_only') === '1';
}

const TARGET_TABLE = { contact_id: 'contacts', company_id: 'companies', deal_id: 'deals', ticket_id: 'tickets' };

/** Comprueba que el registro existe y que el usuario puede verlo (visibilidad restringida). */
function assertTargetAccess(db, req, key, id) {
  const row = db.prepare(`SELECT owner_id FROM ${TARGET_TABLE[key]} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Registro no encontrado');
  if (ownOnly(db, req) && row.owner_id !== req.user.id) throw new HttpError(403, 'Solo puedes acceder a tus propios registros');
}

export function noteRoutes({ db, events }) {
  const r = Router();

  r.post('/', (req, res) => {
    const b = req.body || {};
    const body = coerceField('body', { type: 'textarea', required: true, max: 20000 }, b.body, 'Nota');
    const targets = NOTE_TARGETS.map((k) => (b[k] ? Number(b[k]) : null));
    if (!targets.some(Boolean)) throw new HttpError(400, 'La nota debe asociarse a un registro');
    NOTE_TARGETS.forEach((k, i) => { if (targets[i]) assertTargetAccess(db, req, k, targets[i]); });
    const info = db.prepare('INSERT INTO notes (body, contact_id, company_id, deal_id, ticket_id, user_id, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(body, ...targets, req.user.id, b.pinned ? 1 : 0);
    const note = db.prepare('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = ?').get(Number(info.lastInsertRowid));
    events.record(req, 'created', 'notes', note.id, body.slice(0, 80));
    res.status(201).json(note);
  });

  const loadOwn = (req) => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(idParam(req));
    if (!note) throw new HttpError(404, 'Nota no encontrada');
    if (note.user_id !== req.user.id && req.user.role === 'sales') throw new HttpError(403, 'Solo puedes modificar tus notas');
    return note;
  };

  r.patch('/:id', (req, res) => {
    const note = loadOwn(req);
    const body = req.body?.body !== undefined ? coerceField('body', { type: 'textarea', required: true }, req.body.body, 'Nota') : note.body;
    const pinned = req.body?.pinned !== undefined ? (req.body.pinned ? 1 : 0) : note.pinned;
    db.prepare("UPDATE notes SET body = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?").run(body, pinned, note.id);
    res.json(db.prepare('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = ?').get(note.id));
  });

  r.delete('/:id', (req, res) => {
    const note = loadOwn(req);
    db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
    events.record(req, 'deleted', 'notes', note.id, null);
    res.json({ ok: true });
  });

  return r;
}

/** Cronología combinada (notas + actividades + cambios) de un registro. */
export function timelineRoutes({ db }) {
  const r = Router();
  r.get('/', (req, res) => {
    const key = NOTE_TARGETS.find((k) => req.query[k]);
    if (!key) throw new HttpError(400, 'Indica el registro');
    const id = toInt(req.query[key]);
    assertTargetAccess(db, req, key, id);
    const notes = db.prepare(`SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.${key} = ? ORDER BY n.pinned DESC, n.created_at DESC LIMIT 200`).all(id);
    const activities = db.prepare(`SELECT a.*, u.name AS owner_name, d.title AS deal_title,
      TRIM(ct.first_name || ' ' || COALESCE(ct.last_name, '')) AS contact_name
      FROM activities a LEFT JOIN users u ON u.id = a.owner_id LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN contacts ct ON ct.id = a.contact_id
      WHERE a.${key} = ? ORDER BY a.done ASC, a.due_at DESC LIMIT 200`).all(id);
    const entity = { contact_id: 'contacts', company_id: 'companies', deal_id: 'deals', ticket_id: 'tickets' }[key];
    const changes = db.prepare(`SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.entity = ? AND l.entity_id = ? ORDER BY l.id DESC LIMIT 50`).all(entity, id);
    res.json({ notes, activities, changes });
  });
  return r;
}

export function searchRoutes({ db, license }) {
  const r = Router();
  r.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ contacts: [], companies: [], deals: [], tickets: [] });
    const t = `%${q}%`;
    const own = ownOnly(db, req);
    const scope = (a) => (own ? ` AND ${a}.owner_id = ${Number(req.user.id)}` : '');
    const out = {
      contacts: db.prepare(`SELECT c.id, TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')) AS title, COALESCE(c.email, c.phone, '') AS subtitle
        FROM contacts c WHERE (c.first_name || ' ' || COALESCE(c.last_name, '') LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.mobile LIKE ?)${scope('c')} LIMIT 6`).all(t, t, t, t),
      companies: db.prepare(`SELECT c.id, c.name AS title, COALESCE(c.city, c.industry, '') AS subtitle FROM companies c
        WHERE (c.name LIKE ? OR c.tax_id LIKE ? OR c.email LIKE ?)${scope('c')} LIMIT 6`).all(t, t, t),
      deals: db.prepare(`SELECT d.id, d.title, s.name AS subtitle FROM deals d JOIN stages s ON s.id = d.stage_id
        WHERE d.title LIKE ?${scope('d')} LIMIT 6`).all(t),
      tickets: license.hasFeature('tickets')
        ? db.prepare(`SELECT t.id, '#' || t.id || ' ' || t.subject AS title, t.status AS subtitle FROM tickets t
          WHERE (t.subject LIKE ? OR CAST(t.id AS TEXT) = ?)${scope('t')} LIMIT 6`).all(t, q.replace('#', ''))
        : [],
    };
    res.json(out);
  });
  return r;
}

export function dealActionRoutes({ db, events }) {
  const r = Router();
  // Mover en el kanban: cambia etapa y posición.
  r.post('/:id/move', (req, res) => {
    const id = idParam(req);
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(id);
    if (!deal) throw new HttpError(404, 'Oportunidad no encontrada');
    if (ownOnly(db, req) && deal.owner_id !== req.user.id) throw new HttpError(403, 'Solo puedes mover tus oportunidades');
    const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(toInt(req.body?.stage_id));
    if (!stage || stage.pipeline_id !== deal.pipeline_id) throw new HttpError(400, 'Etapa no válida');
    const position = Number.isFinite(Number(req.body?.position)) ? Number(req.body.position) : Date.now();
    const lostReason = stage.kind === 'lost' ? (req.body?.lost_reason ? String(req.body.lost_reason).slice(0, 200) : deal.lost_reason) : null;
    const closedAt = stage.kind === 'open' ? null : (deal.status === stage.kind ? deal.closed_at : new Date().toISOString());
    db.prepare("UPDATE deals SET stage_id = ?, status = ?, position = ?, closed_at = ?, lost_reason = ?, updated_at = datetime('now') WHERE id = ?")
      .run(stage.id, stage.kind, position, closedAt, lostReason, id);
    if (stage.id !== deal.stage_id) events.record(req, 'stage_changed', 'deals', id, `${deal.title} → ${stage.name}`);
    res.json({ ok: true, status: stage.kind });
  });
  return r;
}

export function notificationRoutes({ db, license }) {
  const r = Router();
  r.get('/', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = db.prepare(`SELECT id, subject, due_at, type FROM activities WHERE owner_id = ? AND done = 0 AND due_at < ? ORDER BY due_at LIMIT 20`).all(req.user.id, today);
    const todayList = db.prepare(`SELECT id, subject, due_at, type FROM activities WHERE owner_id = ? AND done = 0 AND substr(due_at, 1, 10) = ? ORDER BY due_at LIMIT 20`).all(req.user.id, today);
    const tickets = license.hasFeature('tickets')
      ? db.prepare(`SELECT id, subject, priority FROM tickets WHERE owner_id = ? AND status IN ('open') ORDER BY created_at DESC LIMIT 10`).all(req.user.id)
      : [];
    const closing = db.prepare(`SELECT id, title, expected_close FROM deals WHERE owner_id = ? AND status = 'open' AND expected_close BETWEEN ? AND date(?, '+7 days') ORDER BY expected_close LIMIT 10`)
      .all(req.user.id, today, today);
    res.json({ overdue, today: todayList, tickets, closing, count: overdue.length + todayList.length + tickets.length });
  });
  return r;
}

// ---------- Panel e informes ----------

export function dashboardRoutes({ db, license }) {
  const r = Router();
  r.get('/', (req, res) => {
    const own = ownOnly(db, req) || req.query.mine === '1';
    const uid = req.user.id;
    const f = (a) => (own ? ` AND ${a}.owner_id = ${Number(uid)}` : '');
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const pipelineId = toInt(req.query.pipeline_id) || db.prepare('SELECT id FROM pipelines ORDER BY position, id LIMIT 1').get()?.id;

    const open = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value, COALESCE(SUM(d.value * s.probability / 100.0), 0) AS weighted
      FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.status = 'open'${f('d')}`).get();
    const wonMonth = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value FROM deals d WHERE d.status = 'won' AND d.closed_at >= ?${f('d')}`).get(monthStart);
    const closed90 = db.prepare(`SELECT SUM(d.status = 'won') AS won, COUNT(*) AS n FROM deals d WHERE d.status IN ('won','lost') AND d.closed_at >= date('now', '-90 days')${f('d')}`).get();
    const newContacts = db.prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE c.created_at >= ?${f('c')}`).get(monthStart).n;
    const tasks = db.prepare(`SELECT SUM(a.due_at < ?) AS overdue, SUM(substr(a.due_at, 1, 10) = ?) AS today FROM activities a WHERE a.done = 0${f('a')}`).get(today, today);
    const tickets = license.hasFeature('tickets')
      ? db.prepare(`SELECT COUNT(*) AS n FROM tickets t WHERE t.status IN ('open','pending')${f('t')}`).get().n
      : null;

    const byStage = db.prepare(`SELECT s.id, s.name, s.color, s.kind, COUNT(d.id) AS n, COALESCE(SUM(d.value), 0) AS value
      FROM stages s LEFT JOIN deals d ON d.stage_id = s.id${own ? ` AND d.owner_id = ${Number(uid)}` : ''}
      WHERE s.pipeline_id = ? AND s.kind = 'open' GROUP BY s.id ORDER BY s.position`).all(pipelineId);

    const wonByMonth = db.prepare(`SELECT substr(d.closed_at, 1, 7) AS month, COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value
      FROM deals d WHERE d.status = 'won' AND d.closed_at >= date('now', 'start of month', '-11 months')${f('d')} GROUP BY month ORDER BY month`).all();
    const months = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const found = wonByMonth.find((m) => m.month === key);
      months.push({ month: key, n: found?.n || 0, value: found?.value || 0 });
    }

    const sources = db.prepare(`SELECT COALESCE(NULLIF(c.source, ''), 'Sin origen') AS source, COUNT(*) AS n FROM contacts c WHERE 1 = 1${f('c')} GROUP BY 1 ORDER BY n DESC LIMIT 8`).all();
    const upcoming = db.prepare(`SELECT a.*, TRIM(ct.first_name || ' ' || COALESCE(ct.last_name, '')) AS contact_name, d.title AS deal_title
      FROM activities a LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN deals d ON d.id = a.deal_id
      WHERE a.done = 0 AND a.owner_id = ? ORDER BY a.due_at IS NULL, a.due_at LIMIT 8`).all(uid);
    const leaderboard = db.prepare(`SELECT u.id, u.name, u.color, COUNT(d.id) AS n, COALESCE(SUM(d.value), 0) AS value
      FROM users u LEFT JOIN deals d ON d.owner_id = u.id AND d.status = 'won' AND d.closed_at >= ?
      WHERE u.active = 1 GROUP BY u.id ORDER BY value DESC LIMIT 6`).all(monthStart);
    const recent = db.prepare(`SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.action IN ('created','stage_changed','updated') AND l.entity IN ('contacts','companies','deals','tickets','quotes','invoices')
      ORDER BY l.id DESC LIMIT 10`).all();

    res.json({
      kpis: {
        open_deals: open.n, pipeline_value: open.value, weighted_value: Math.round(open.weighted * 100) / 100,
        won_month_count: wonMonth.n, won_month_value: wonMonth.value,
        win_rate: closed90.n ? Math.round((closed90.won / closed90.n) * 100) : null,
        new_contacts_month: newContacts, tasks_overdue: tasks.overdue || 0, tasks_today: tasks.today || 0, open_tickets: tickets,
      },
      pipeline_id: pipelineId,
      by_stage: byStage,
      won_by_month: months,
      sources,
      upcoming,
      leaderboard,
      recent,
    });
  });
  return r;
}

export function reportRoutes({ db }) {
  const r = Router();
  r.get('/', (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : `${new Date().getFullYear()}-01-01`;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);
    const toEnd = `${to}T23:59:59`;
    const own = ownOnly(db, req);
    const ownerId = own ? req.user.id : toInt(req.query.owner_id);
    const f = (a) => (ownerId ? ` AND ${a}.owner_id = ${Number(ownerId)}` : '');

    const byOwner = db.prepare(`SELECT u.id, u.name, u.color,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.status = 'won' AND d.closed_at BETWEEN ? AND ?) AS won_count,
        (SELECT COALESCE(SUM(value), 0) FROM deals d WHERE d.owner_id = u.id AND d.status = 'won' AND d.closed_at BETWEEN ? AND ?) AS won_value,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.status = 'lost' AND d.closed_at BETWEEN ? AND ?) AS lost_count,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.created_at BETWEEN ? AND ?) AS created_count,
        (SELECT COUNT(*) FROM activities a WHERE a.owner_id = u.id AND a.done = 1 AND a.done_at BETWEEN ? AND ?) AS activities_done,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.status = 'open') AS open_count,
        (SELECT COALESCE(SUM(value), 0) FROM deals d WHERE d.owner_id = u.id AND d.status = 'open') AS open_value
      FROM users u WHERE u.active = 1${ownerId ? ` AND u.id = ${Number(ownerId)}` : ''} ORDER BY won_value DESC`)
      .all(from, toEnd, from, toEnd, from, toEnd, from, toEnd, from, toEnd);

    const funnel = db.prepare(`SELECT s.name, s.kind, s.color, p.name AS pipeline, COUNT(d.id) AS n, COALESCE(SUM(d.value), 0) AS value
      FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
      LEFT JOIN deals d ON d.stage_id = s.id AND d.created_at BETWEEN ? AND ?${ownerId ? ` AND d.owner_id = ${Number(ownerId)}` : ''}
      GROUP BY s.id ORDER BY p.position, s.position`).all(from, toEnd);

    const lostReasons = db.prepare(`SELECT COALESCE(NULLIF(d.lost_reason, ''), 'Sin motivo') AS reason, COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value
      FROM deals d WHERE d.status = 'lost' AND d.closed_at BETWEEN ? AND ?${f('d')} GROUP BY 1 ORDER BY n DESC`).all(from, toEnd);

    const bySource = db.prepare(`SELECT COALESCE(NULLIF(d.source, ''), 'Sin origen') AS source, COUNT(*) AS n,
        SUM(d.status = 'won') AS won, COALESCE(SUM(CASE WHEN d.status = 'won' THEN d.value END), 0) AS won_value
      FROM deals d WHERE d.created_at BETWEEN ? AND ?${f('d')} GROUP BY 1 ORDER BY won_value DESC`).all(from, toEnd);

    const forecast = db.prepare(`SELECT substr(d.expected_close, 1, 7) AS month, COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value,
        COALESCE(SUM(d.value * s.probability / 100.0), 0) AS weighted
      FROM deals d JOIN stages s ON s.id = d.stage_id
      WHERE d.status = 'open' AND d.expected_close IS NOT NULL AND d.expected_close >= date('now', 'start of month')${f('d')}
      GROUP BY month ORDER BY month LIMIT 6`).all();

    const activitiesByType = db.prepare(`SELECT a.type, COUNT(*) AS n FROM activities a WHERE a.done = 1 AND a.done_at BETWEEN ? AND ?${f('a')} GROUP BY a.type`).all(from, toEnd);

    const invoices = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN q.status = 'paid' THEN q.total END), 0) AS paid,
        COALESCE(SUM(CASE WHEN q.status IN ('sent','overdue') THEN q.total END), 0) AS pending,
        COALESCE(SUM(CASE WHEN q.status IN ('sent','overdue') AND q.due_date < date('now') THEN q.total END), 0) AS overdue,
        COUNT(*) AS n
      FROM quotes q WHERE q.kind = 'invoice' AND q.status != 'cancelled' AND q.issue_date BETWEEN ? AND ?${f('q')}`).get(from, to);

    const quotes = db.prepare(`SELECT COUNT(*) AS n, SUM(q.status = 'accepted') AS accepted, COALESCE(SUM(q.total), 0) AS value
      FROM quotes q WHERE q.kind = 'quote' AND q.issue_date BETWEEN ? AND ?${f('q')}`).get(from, to);

    const tickets = db.prepare(`SELECT COUNT(*) AS n, SUM(t.status IN ('resolved','closed')) AS resolved,
        AVG(CASE WHEN t.resolved_at IS NOT NULL THEN (julianday(t.resolved_at) - julianday(t.created_at)) * 24 END) AS avg_hours
      FROM tickets t WHERE t.created_at BETWEEN ? AND ?${f('t')}`).get(from, toEnd);

    const totals = byOwner.reduce((acc, o) => ({
      won_count: acc.won_count + o.won_count, won_value: acc.won_value + o.won_value, lost_count: acc.lost_count + o.lost_count,
    }), { won_count: 0, won_value: 0, lost_count: 0 });

    res.json({
      from, to, totals,
      win_rate: totals.won_count + totals.lost_count ? Math.round((totals.won_count / (totals.won_count + totals.lost_count)) * 100) : null,
      avg_deal: totals.won_count ? Math.round((totals.won_value / totals.won_count) * 100) / 100 : 0,
      by_owner: byOwner, funnel, lost_reasons: lostReasons, by_source: bySource, forecast,
      activities_by_type: activitiesByType, invoices, quotes,
      tickets: { ...tickets, avg_hours: tickets.avg_hours ? Math.round(tickets.avg_hours * 10) / 10 : null },
    });
  });
  return r;
}

// ---------- Importación CSV ----------

const IMPORT_ALIASES = {
  contacts: {
    first_name: ['nombre', 'first name', 'firstname', 'first_name', 'name'],
    last_name: ['apellidos', 'apellido', 'last name', 'lastname', 'last_name', 'surname'],
    email: ['email', 'correo', 'e-mail', 'correo electrónico', 'mail'],
    phone: ['teléfono', 'telefono', 'phone', 'tel'],
    mobile: ['móvil', 'movil', 'mobile', 'celular'],
    job_title: ['cargo', 'puesto', 'job title', 'title', 'job_title'],
    company: ['empresa', 'company', 'compañía', 'organización', 'organization', 'company_name'],
    status: ['estado', 'status'],
    source: ['origen', 'source', 'fuente'],
    city: ['ciudad', 'city', 'localidad'],
    state: ['provincia', 'state', 'región', 'region'],
    postal_code: ['código postal', 'cp', 'postal code', 'zip', 'postal_code'],
    country: ['país', 'pais', 'country'],
    address: ['dirección', 'direccion', 'address'],
    tags: ['etiquetas', 'tags'],
    description: ['descripción', 'descripcion', 'notas', 'notes', 'description'],
  },
  companies: {
    name: ['nombre', 'name', 'empresa', 'company', 'razón social', 'razon social'],
    industry: ['sector', 'industria', 'industry'],
    website: ['web', 'website', 'sitio web', 'url'],
    email: ['email', 'correo', 'mail'],
    phone: ['teléfono', 'telefono', 'phone'],
    tax_id: ['cif', 'nif', 'cif/nif', 'tax id', 'vat', 'tax_id'],
    address: ['dirección', 'direccion', 'address'],
    city: ['ciudad', 'city'],
    state: ['provincia', 'state'],
    postal_code: ['código postal', 'cp', 'postal code', 'zip', 'postal_code'],
    country: ['país', 'pais', 'country'],
    employees: ['empleados', 'employees'],
    tags: ['etiquetas', 'tags'],
    description: ['descripción', 'descripcion', 'description', 'notas'],
  },
  products: {
    name: ['nombre', 'name', 'producto', 'product'],
    sku: ['sku', 'referencia', 'ref', 'código', 'codigo'],
    category: ['categoría', 'categoria', 'category'],
    price: ['precio', 'price', 'pvp'],
    cost: ['coste', 'costo', 'cost'],
    tax_rate: ['iva', 'iva %', 'tax', 'tax_rate', 'impuesto'],
    unit: ['unidad', 'unit'],
    description: ['descripción', 'descripcion', 'description'],
  },
};

const STATUS_MAP = { lead: 'lead', prospecto: 'prospect', prospect: 'prospect', cliente: 'customer', customer: 'customer', inactivo: 'inactive', inactive: 'inactive' };

export function importRoutes(ctx) {
  const { db, events, resources } = ctx;
  const r = Router();

  r.get('/fields', (_req, res) => {
    res.json(Object.fromEntries(Object.entries(IMPORT_ALIASES).map(([k, v]) => [k, Object.keys(v)])));
  });

  r.post('/:entity', (req, res) => {
    const entity = req.params.entity;
    const aliases = IMPORT_ALIASES[entity];
    if (!aliases) throw new HttpError(400, 'Entidad no importable');
    const rows = parseCsv(req.body?.csv || '');
    if (rows.length < 2) throw new HttpError(400, 'El CSV debe tener cabecera y al menos una fila');
    if (rows.length > 20001) throw new HttpError(400, 'Máximo 20.000 filas por importación');
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const mapping = req.body?.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : null;
    const colFor = {};
    for (const [field, names] of Object.entries(aliases)) {
      const explicit = mapping?.[field];
      const idx = explicit !== undefined && explicit !== '' ? headers.indexOf(String(explicit).toLowerCase()) : headers.findIndex((h) => names.includes(h) || h === field);
      if (idx >= 0) colFor[field] = idx;
    }
    const requiredField = entity === 'contacts' ? 'first_name' : 'name';
    if (colFor[requiredField] === undefined) throw new HttpError(400, `No se encuentra la columna obligatoria «${requiredField}» en el CSV`);

    const def = resources[entity];
    const skipDuplicates = req.body?.skip_duplicates !== false;
    const result = { created: 0, skipped: 0, errors: [] };
    const companyCache = new Map();

    tx(db, () => {
      rows.slice(1).forEach((row, i) => {
        const line = i + 2;
        try {
          const raw = {};
          for (const [field, idx] of Object.entries(colFor)) raw[field] = (row[idx] ?? '').trim();
          const data = {};
          for (const [key, f] of Object.entries(def.fields)) {
            if (raw[key] === undefined || f.readonly) continue;
            let v = raw[key];
            if (key === 'status' && entity === 'contacts') v = STATUS_MAP[v.toLowerCase()] || 'lead';
            const c = coerceField(key, f, v, f.label || key);
            if (c !== undefined && c !== null) data[key] = c;
          }
          if (!data[requiredField]) throw new Error('Falta el campo obligatorio');
          if (entity === 'contacts') {
            if (data.email && db.prepare('SELECT 1 FROM contacts WHERE email = ?').get(data.email)) {
              if (skipDuplicates) { result.skipped++; return; }
            }
            if (raw.company) {
              const name = raw.company.slice(0, 200);
              let cid = companyCache.get(name.toLowerCase());
              if (!cid) {
                cid = db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE').get(name)?.id;
                if (!cid) cid = Number(db.prepare('INSERT INTO companies (name, owner_id, created_by) VALUES (?, ?, ?)').run(name, req.user.id, req.user.id).lastInsertRowid);
                companyCache.set(name.toLowerCase(), cid);
              }
              data.company_id = cid;
            }
          }
          if (entity === 'companies' && skipDuplicates && db.prepare('SELECT 1 FROM companies WHERE name = ? COLLATE NOCASE').get(data.name)) {
            result.skipped++; return;
          }
          if (entity === 'products' && skipDuplicates && data.sku && db.prepare('SELECT 1 FROM products WHERE sku = ?').get(data.sku)) {
            result.skipped++; return;
          }
          if (def.fields.owner_id) data.owner_id = req.user.id;
          if (def.hasCreatedBy !== false) data.created_by = req.user.id;
          const keys = Object.keys(data);
          db.prepare(`INSERT INTO ${def.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => data[k]));
          result.created++;
        } catch (err) {
          if (result.errors.length < 100) result.errors.push({ line, error: err.message });
        }
      });
    });
    events.record(req, 'import', entity, null, `${result.created} creados, ${result.skipped} omitidos, ${result.errors.length} errores`);
    res.json(result);
  });

  return r;
}
