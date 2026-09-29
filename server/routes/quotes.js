import { Router } from 'express';
import { HttpError, coerceField, idParam, toInt, toCsv } from '../http.js';
import { getSetting, getSettings, setSetting, tx } from '../db.js';

const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcItem(it) {
  const gross = it.quantity * it.unit_price;
  const subtotal = round2(gross * (1 - it.discount_pct / 100));
  const tax = round2(subtotal * (it.tax_rate / 100));
  return { ...it, subtotal, tax, total: round2(subtotal + tax), discount: round2(gross - subtotal) };
}

export function quoteRoutes({ db, events }) {
  const r = Router();

  const SELECT = `SELECT q.*, TRIM(ct.first_name || ' ' || COALESCE(ct.last_name, '')) AS contact_name, ct.email AS contact_email,
      co.name AS company_name, d.title AS deal_title, u.name AS owner_name
    FROM quotes q
    LEFT JOIN contacts ct ON ct.id = q.contact_id
    LEFT JOIN companies co ON co.id = q.company_id
    LEFT JOIN deals d ON d.id = q.deal_id
    LEFT JOIN users u ON u.id = q.owner_id`;

  const ownScope = (req) => req.user.role === 'sales' && getSetting(db, 'sales_see_own_only') === '1';

  function load(req, id) {
    const q = db.prepare(`${SELECT} WHERE q.id = ?`).get(id);
    if (!q) throw new HttpError(404, 'Documento no encontrado');
    if (ownScope(req) && q.owner_id !== req.user.id) throw new HttpError(403, 'Solo puedes acceder a tus propios documentos');
    q.items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, id').all(id);
    return q;
  }

  function nextNumber(kind) {
    const prefixKey = kind === 'invoice' ? 'invoice_prefix' : 'quote_prefix';
    const numKey = kind === 'invoice' ? 'next_invoice_number' : 'next_quote_number';
    const year = new Date().getFullYear();
    let n = toInt(getSetting(db, numKey), 1);
    let number;
    do {
      number = `${getSetting(db, prefixKey) || ''}${year}-${String(n).padStart(4, '0')}`;
      n++;
    } while (db.prepare('SELECT 1 FROM quotes WHERE kind = ? AND number = ?').get(kind, number));
    setSetting(db, numKey, n);
    return number;
  }

  function readItems(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 500).map((it, i) => calcItem({
      product_id: it.product_id ? Number(it.product_id) : null,
      description: coerceField('description', { type: 'textarea', required: true, max: 2000 }, it.description, 'Descripción de línea'),
      quantity: coerceField('quantity', { type: 'num', min: 0 }, it.quantity ?? 1, 'Cantidad') ?? 0,
      unit_price: coerceField('unit_price', { type: 'num' }, it.unit_price ?? 0, 'Precio') ?? 0,
      discount_pct: coerceField('discount_pct', { type: 'num', min: 0, max: 100 }, it.discount_pct ?? 0, 'Descuento') ?? 0,
      tax_rate: coerceField('tax_rate', { type: 'num', min: 0, max: 100 }, it.tax_rate ?? 0, 'IVA') ?? 0,
      position: i,
    }));
  }

  function saveItems(quoteId, items) {
    db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
    const ins = db.prepare(`INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, subtotal, tax, total, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let subtotal = 0; let discount = 0; let tax = 0;
    for (const it of items) {
      ins.run(quoteId, it.product_id, it.description, it.quantity, it.unit_price, it.discount_pct, it.tax_rate, it.subtotal, it.tax, it.total, it.position);
      subtotal += it.subtotal; discount += it.discount; tax += it.tax;
    }
    db.prepare("UPDATE quotes SET subtotal = ?, discount_total = ?, tax_total = ?, total = ?, updated_at = datetime('now') WHERE id = ?")
      .run(round2(subtotal), round2(discount), round2(tax), round2(subtotal + tax), quoteId);
  }

  function readHeader(b, kind, existing) {
    const statuses = kind === 'invoice' ? INVOICE_STATUSES : QUOTE_STATUSES;
    const f = (key, def, label) => coerceField(key, def, b[key], label);
    const data = {
      title: f('title', { type: 'text', max: 200 }, 'Título'),
      status: f('status', { type: 'enum', values: statuses }, 'Estado'),
      contact_id: f('contact_id', { type: 'ref' }, 'Contacto'),
      company_id: f('company_id', { type: 'ref' }, 'Empresa'),
      deal_id: f('deal_id', { type: 'ref' }, 'Oportunidad'),
      owner_id: f('owner_id', { type: 'ref' }, 'Responsable'),
      issue_date: f('issue_date', { type: 'date' }, 'Fecha de emisión'),
      due_date: f('due_date', { type: 'date' }, 'Vencimiento'),
      currency: b.currency && /^[A-Z]{3}$/.test(b.currency) ? b.currency : undefined,
      notes: f('notes', { type: 'textarea', max: 5000 }, 'Notas'),
      terms: f('terms', { type: 'textarea', max: 5000 }, 'Condiciones'),
    };
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    if (data.status === 'paid' && existing?.status !== 'paid') data.paid_at = new Date().toISOString();
    if (data.status && data.status !== 'paid') data.paid_at = null;
    return data;
  }

  r.get('/', (req, res) => {
    const where = [];
    const params = [];
    const kind = req.query.kind === 'invoice' ? 'invoice' : 'quote';
    where.push('q.kind = ?'); params.push(kind);
    if (req.query.status) { where.push('q.status = ?'); params.push(req.query.status); }
    for (const k of ['contact_id', 'company_id', 'deal_id', 'owner_id']) {
      if (req.query[k]) { where.push(`q.${k} = ?`); params.push(req.query[k] === 'me' ? req.user.id : req.query[k]); }
    }
    if (req.query.q) {
      where.push("(q.number LIKE ? OR q.title LIKE ? OR co.name LIKE ? OR ct.first_name LIKE ? OR ct.last_name LIKE ?)");
      const t = `%${req.query.q}%`; params.push(t, t, t, t, t);
    }
    if (req.query.from) { where.push('q.issue_date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('q.issue_date <= ?'); params.push(req.query.to); }
    if (ownScope(req)) { where.push('q.owner_id = ?'); params.push(req.user.id); }
    const sql = ` WHERE ${where.join(' AND ')}`;
    const sorts = { number: 'q.number', issue_date: 'q.issue_date', total: 'q.total', status: 'q.status', due_date: 'q.due_date' };
    const order = sorts[req.query.sort] ? `${sorts[req.query.sort]} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}` : 'q.issue_date DESC, q.id DESC';
    const limit = Math.min(toInt(req.query.limit, 25), 500);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${SELECT}${sql})`).get(...params).n;
    const sums = db.prepare(`SELECT COALESCE(SUM(q.total), 0) AS total FROM (${SELECT}${sql}) q`).get(...params);
    const data = db.prepare(`${SELECT}${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ data, total, page, limit, sum_total: sums.total });
  });

  r.get('/export.csv', (req, res) => {
    const kind = req.query.kind === 'invoice' ? 'invoice' : 'quote';
    const rows = db.prepare(`${SELECT} WHERE q.kind = ? ORDER BY q.issue_date DESC`).all(kind);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${kind === 'invoice' ? 'facturas' : 'presupuestos'}.csv"`);
    res.send(toCsv(rows, [
      { key: 'number', label: 'Número' }, { key: 'title', label: 'Título' }, { key: 'status', label: 'Estado' },
      { key: 'issue_date', label: 'Fecha' }, { key: 'due_date', label: 'Vencimiento' }, { key: 'company_name', label: 'Empresa' },
      { key: 'contact_name', label: 'Contacto' }, { key: 'subtotal', label: 'Base imponible' }, { key: 'tax_total', label: 'Impuestos' },
      { key: 'total', label: 'Total' }, { key: 'currency', label: 'Moneda' }, { key: 'paid_at', label: 'Pagada' },
    ]));
  });

  r.get('/:id', (req, res) => res.json(load(req, idParam(req))));

  r.post('/', (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'invoice' ? 'invoice' : 'quote';
    const settings = getSettings(db);
    const data = readHeader(b, kind, null);
    const items = readItems(b.items);
    const id = tx(db, () => {
      const today = new Date().toISOString().slice(0, 10);
      const issue = data.issue_date || today;
      const days = toInt(kind === 'invoice' ? settings.invoice_due_days : settings.quote_validity_days, 30);
      const due = data.due_date || new Date(Date.parse(issue) + days * 86400000).toISOString().slice(0, 10);
      // Rellena contacto/empresa desde la oportunidad si no vienen
      if (data.deal_id && (!data.contact_id || !data.company_id)) {
        const d = db.prepare('SELECT contact_id, company_id FROM deals WHERE id = ?').get(data.deal_id);
        data.contact_id ??= d?.contact_id ?? null;
        data.company_id ??= d?.company_id ?? null;
      }
      const row = {
        ...data,
        kind,
        number: nextNumber(kind),
        status: data.status || 'draft',
        issue_date: issue,
        due_date: due,
        currency: data.currency || settings.currency || 'EUR',
        terms: data.terms ?? (kind === 'invoice' ? settings.invoice_terms : settings.quote_terms),
        owner_id: ownScope(req) ? req.user.id : (data.owner_id ?? req.user.id),
        created_by: req.user.id,
        source_quote_id: b.source_quote_id ? Number(b.source_quote_id) : null,
      };
      const keys = Object.keys(row);
      const qid = Number(db.prepare(`INSERT INTO quotes (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k])).lastInsertRowid);
      saveItems(qid, items);
      return qid;
    });
    const q = load(req, id);
    events.record(req, 'created', kind === 'invoice' ? 'invoices' : 'quotes', id, q.number);
    res.status(201).json(q);
  });

  r.patch('/:id', (req, res) => {
    const id = idParam(req);
    const existing = load(req, id);
    const data = readHeader(req.body || {}, existing.kind, existing);
    if (ownScope(req)) delete data.owner_id;
    tx(db, () => {
      const keys = Object.keys(data);
      if (keys.length) {
        db.prepare(`UPDATE quotes SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => data[k]), id);
      }
      if (Array.isArray(req.body?.items)) saveItems(id, readItems(req.body.items));
      // Presupuesto aceptado => oportunidad ganada (si está abierta)
      if (existing.kind === 'quote' && data.status === 'accepted' && existing.status !== 'accepted' && existing.deal_id) {
        const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(existing.deal_id);
        const won = deal && db.prepare("SELECT id FROM stages WHERE pipeline_id = ? AND kind = 'won' ORDER BY position LIMIT 1").get(deal.pipeline_id);
        if (deal && deal.status === 'open' && won) {
          const total = db.prepare('SELECT total FROM quotes WHERE id = ?').get(id).total;
          db.prepare("UPDATE deals SET stage_id = ?, status = 'won', closed_at = ?, value = CASE WHEN value = 0 THEN ? ELSE value END, updated_at = datetime('now') WHERE id = ?")
            .run(won.id, new Date().toISOString(), total, deal.id);
        }
      }
    });
    const q = load(req, id);
    events.record(req, 'updated', q.kind === 'invoice' ? 'invoices' : 'quotes', id, `${q.number} · ${q.status}`);
    res.json(q);
  });

  r.post('/:id/convert', (req, res) => {
    const src = load(req, idParam(req));
    if (src.kind !== 'quote') throw new HttpError(400, 'Solo se pueden convertir presupuestos');
    const settings = getSettings(db);
    const id = tx(db, () => {
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + toInt(settings.invoice_due_days, 30) * 86400000).toISOString().slice(0, 10);
      const qid = Number(db.prepare(`INSERT INTO quotes (kind, number, title, status, contact_id, company_id, deal_id, owner_id, issue_date, due_date, currency, notes, terms, source_quote_id, created_by)
        VALUES ('invoice', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(nextNumber('invoice'), src.title, src.contact_id, src.company_id, src.deal_id, src.owner_id, today, due, src.currency, src.notes, settings.invoice_terms, src.id, req.user.id).lastInsertRowid);
      saveItems(qid, src.items.map((it) => calcItem(it)));
      if (src.status !== 'accepted') db.prepare("UPDATE quotes SET status = 'accepted' WHERE id = ?").run(src.id);
      return qid;
    });
    const inv = load(req, id);
    events.record(req, 'created', 'invoices', id, `${inv.number} (desde ${src.number})`);
    res.status(201).json(inv);
  });

  r.post('/:id/duplicate', (req, res) => {
    const src = load(req, idParam(req));
    const id = tx(db, () => {
      const today = new Date().toISOString().slice(0, 10);
      const qid = Number(db.prepare(`INSERT INTO quotes (kind, number, title, status, contact_id, company_id, deal_id, owner_id, issue_date, due_date, currency, notes, terms, created_by)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(src.kind, nextNumber(src.kind), src.title, src.contact_id, src.company_id, src.deal_id, src.owner_id, today, src.due_date, src.currency, src.notes, src.terms, req.user.id).lastInsertRowid);
      saveItems(qid, src.items.map((it) => calcItem(it)));
      return qid;
    });
    const q = load(req, id);
    events.record(req, 'created', q.kind === 'invoice' ? 'invoices' : 'quotes', id, `${q.number} (copia de ${src.number})`);
    res.status(201).json(q);
  });

  r.delete('/:id', (req, res) => {
    const q = load(req, idParam(req));
    if (q.kind === 'invoice' && q.status !== 'draft' && req.user.role !== 'admin') {
      throw new HttpError(403, 'Solo un administrador puede eliminar facturas emitidas');
    }
    db.prepare('DELETE FROM quotes WHERE id = ?').run(q.id);
    events.record(req, 'deleted', q.kind === 'invoice' ? 'invoices' : 'quotes', q.id, q.number);
    res.json({ ok: true });
  });

  return r;
}
