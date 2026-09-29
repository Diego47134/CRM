import { HttpError } from './http.js';

const owner = { type: 'ref', label: 'Responsable' };
const tags = { type: 'tags', label: 'Etiquetas' };

const contactName = (alias) => `TRIM(${alias}.first_name || ' ' || COALESCE(${alias}.last_name, ''))`;

const dateRange = (col) => ({
  [`${col}_from`]: (v) => [`${col} >= ?`, [v]],
  [`${col}_to`]: (v) => [`${col} <= ?`, [v.length === 10 ? `${v}T23:59:59` : v]],
});

export function resourceDefs(db) {
  const companies = {
    name: 'companies',
    label: 'Empresa',
    table: 'companies',
    alias: 'c',
    customEntity: 'companies',
    ownerScoped: true,
    select: `SELECT c.*, u.name AS owner_name,
      (SELECT COUNT(*) FROM contacts x WHERE x.company_id = c.id) AS contacts_count,
      (SELECT COALESCE(SUM(value), 0) FROM deals d WHERE d.company_id = c.id AND d.status = 'open') AS open_deals_value
      FROM companies c LEFT JOIN users u ON u.id = c.owner_id`,
    fields: {
      name: { type: 'text', required: true, label: 'Nombre', max: 200 },
      industry: { type: 'text', label: 'Sector' },
      website: { type: 'url', label: 'Web' },
      email: { type: 'email', label: 'Email' },
      phone: { type: 'text', label: 'Teléfono', max: 50 },
      tax_id: { type: 'text', label: 'CIF/NIF', max: 50 },
      address: { type: 'text', label: 'Dirección' },
      city: { type: 'text', label: 'Ciudad' },
      state: { type: 'text', label: 'Provincia' },
      postal_code: { type: 'text', label: 'Código postal', max: 20 },
      country: { type: 'text', label: 'País' },
      employees: { type: 'int', label: 'Empleados', min: 0 },
      annual_revenue: { type: 'num', label: 'Facturación anual', min: 0 },
      owner_id: owner,
      tags,
      description: { type: 'textarea', label: 'Descripción' },
    },
    search: ['c.name', 'c.email', 'c.city', 'c.tax_id', 'c.industry', 'c.phone'],
    filters: { owner_id: 'c.owner_id', industry: 'c.industry', city: 'c.city', country: 'c.country' },
    sorts: { name: 'c.name', created_at: 'c.created_at', city: 'c.city', industry: 'c.industry', owner: 'u.name', open_deals_value: 'open_deals_value' },
    defaultSort: 'c.name ASC',
    bulkFields: ['owner_id', 'industry'],
    summary: (r) => r.name,
    csv: [
      { key: 'id', label: 'ID' }, { key: 'name', label: 'Nombre' }, { key: 'industry', label: 'Sector' },
      { key: 'website', label: 'Web' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Teléfono' },
      { key: 'tax_id', label: 'CIF/NIF' }, { key: 'address', label: 'Dirección' }, { key: 'city', label: 'Ciudad' },
      { key: 'state', label: 'Provincia' }, { key: 'postal_code', label: 'Código postal' }, { key: 'country', label: 'País' },
      { key: 'employees', label: 'Empleados' }, { key: 'annual_revenue', label: 'Facturación anual' },
      { key: 'owner_name', label: 'Responsable' }, { key: 'tags', label: 'Etiquetas' }, { key: 'created_at', label: 'Creado' },
    ],
  };

  const contacts = {
    name: 'contacts',
    label: 'Contacto',
    table: 'contacts',
    alias: 'c',
    customEntity: 'contacts',
    ownerScoped: true,
    select: `SELECT c.*, ${contactName('c')} AS full_name, co.name AS company_name, u.name AS owner_name
      FROM contacts c LEFT JOIN companies co ON co.id = c.company_id LEFT JOIN users u ON u.id = c.owner_id`,
    fields: {
      first_name: { type: 'text', required: true, label: 'Nombre', max: 100 },
      last_name: { type: 'text', label: 'Apellidos', max: 150 },
      email: { type: 'email', label: 'Email' },
      phone: { type: 'text', label: 'Teléfono', max: 50 },
      mobile: { type: 'text', label: 'Móvil', max: 50 },
      job_title: { type: 'text', label: 'Cargo' },
      company_id: { type: 'ref', label: 'Empresa' },
      status: { type: 'enum', values: ['lead', 'prospect', 'customer', 'inactive'], default: 'lead', label: 'Estado' },
      source: { type: 'text', label: 'Origen' },
      score: { type: 'int', min: 0, max: 100, default: 0, label: 'Puntuación' },
      owner_id: owner,
      address: { type: 'text', label: 'Dirección' },
      city: { type: 'text', label: 'Ciudad' },
      state: { type: 'text', label: 'Provincia' },
      postal_code: { type: 'text', label: 'Código postal', max: 20 },
      country: { type: 'text', label: 'País' },
      birthday: { type: 'date', label: 'Cumpleaños' },
      linkedin: { type: 'url', label: 'LinkedIn' },
      email_opt_out: { type: 'bool', label: 'No enviar emails' },
      tags,
      description: { type: 'textarea', label: 'Descripción' },
    },
    search: ['c.first_name', 'c.last_name', 'c.email', 'c.phone', 'c.mobile', 'co.name', 'c.city'],
    filters: { status: 'c.status', owner_id: 'c.owner_id', company_id: 'c.company_id', source: 'c.source', city: 'c.city' },
    sorts: { name: 'c.first_name', created_at: 'c.created_at', company: 'co.name', status: 'c.status', score: 'c.score', owner: 'u.name', updated_at: 'c.updated_at' },
    defaultSort: 'c.created_at DESC',
    bulkFields: ['owner_id', 'status', 'source'],
    summary: (r) => r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' '),
    beforeSave(data, existing) {
      const email = data.email ?? existing?.email;
      if (data.email) {
        const dup = db.prepare('SELECT id FROM contacts WHERE email = ? AND id != ?').get(data.email, existing?.id ?? 0);
        if (dup) throw new HttpError(409, `Ya existe un contacto con el email ${email}`, { duplicate_id: dup.id });
      }
    },
    csv: [
      { key: 'id', label: 'ID' }, { key: 'first_name', label: 'Nombre' }, { key: 'last_name', label: 'Apellidos' },
      { key: 'email', label: 'Email' }, { key: 'phone', label: 'Teléfono' }, { key: 'mobile', label: 'Móvil' },
      { key: 'job_title', label: 'Cargo' }, { key: 'company_name', label: 'Empresa' }, { key: 'status', label: 'Estado' },
      { key: 'source', label: 'Origen' }, { key: 'score', label: 'Puntuación' }, { key: 'address', label: 'Dirección' },
      { key: 'city', label: 'Ciudad' }, { key: 'state', label: 'Provincia' }, { key: 'postal_code', label: 'Código postal' },
      { key: 'country', label: 'País' }, { key: 'birthday', label: 'Cumpleaños' }, { key: 'owner_name', label: 'Responsable' },
      { key: 'tags', label: 'Etiquetas' }, { key: 'created_at', label: 'Creado' },
    ],
  };

  const deals = {
    name: 'deals',
    label: 'Oportunidad',
    table: 'deals',
    alias: 'd',
    customEntity: 'deals',
    ownerScoped: true,
    select: `SELECT d.*, s.name AS stage_name, s.kind AS stage_kind, s.probability AS probability, s.color AS stage_color,
      p.name AS pipeline_name, ${contactName('ct')} AS contact_name, co.name AS company_name, u.name AS owner_name,
      (SELECT MIN(a.due_at) FROM activities a WHERE a.deal_id = d.id AND a.done = 0) AS next_activity_at
      FROM deals d
      JOIN stages s ON s.id = d.stage_id
      JOIN pipelines p ON p.id = d.pipeline_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
      LEFT JOIN companies co ON co.id = d.company_id
      LEFT JOIN users u ON u.id = d.owner_id`,
    fields: {
      title: { type: 'text', required: true, label: 'Título', max: 200 },
      value: { type: 'num', min: 0, default: 0, label: 'Importe' },
      pipeline_id: { type: 'ref', label: 'Embudo' },
      stage_id: { type: 'ref', label: 'Etapa' },
      contact_id: { type: 'ref', label: 'Contacto' },
      company_id: { type: 'ref', label: 'Empresa' },
      owner_id: owner,
      expected_close: { type: 'date', label: 'Cierre previsto' },
      lost_reason: { type: 'text', label: 'Motivo de pérdida' },
      source: { type: 'text', label: 'Origen' },
      priority: { type: 'enum', values: ['low', 'normal', 'high'], default: 'normal', label: 'Prioridad' },
      tags,
      description: { type: 'textarea', label: 'Descripción' },
    },
    search: ['d.title', 'co.name', 'ct.first_name', 'ct.last_name'],
    filters: {
      pipeline_id: 'd.pipeline_id', stage_id: 'd.stage_id', status: 'd.status', owner_id: 'd.owner_id',
      contact_id: 'd.contact_id', company_id: 'd.company_id', priority: 'd.priority',
      // Tablero: abiertas + cerradas en los últimos N días
      board: (v) => ["(d.status = 'open' OR d.closed_at >= date('now', ?))", [`-${Math.min(Math.max(Number(v) || 30, 1), 3650)} days`]],
      ...dateRange('d.expected_close'),
    },
    sorts: { title: 'd.title', value: 'd.value', expected_close: 'd.expected_close', created_at: 'd.created_at', stage: 's.position', owner: 'u.name', company: 'co.name' },
    defaultSort: 'd.created_at DESC',
    bulkFields: ['owner_id', 'stage_id'],
    summary: (r) => r.title,
    beforeSave(data, existing) {
      const pipelineId = data.pipeline_id ?? existing?.pipeline_id;
      let stageId = data.stage_id ?? existing?.stage_id;
      let pid = pipelineId;
      if (!pid) {
        pid = db.prepare('SELECT id FROM pipelines ORDER BY position, id LIMIT 1').get()?.id;
        if (!pid) throw new HttpError(400, 'No hay ningún embudo de ventas configurado');
        data.pipeline_id = pid;
      }
      if (!stageId || (data.pipeline_id && existing && data.pipeline_id !== existing.pipeline_id && !data.stage_id)) {
        stageId = db.prepare('SELECT id FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1').get(pid)?.id;
        data.stage_id = stageId;
      }
      const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(stageId);
      if (!stage || stage.pipeline_id !== pid) throw new HttpError(400, 'La etapa no pertenece al embudo seleccionado');
      if (!existing || data.stage_id !== undefined) {
        data.status = stage.kind;
        if (stage.kind !== 'open' && (!existing || existing.status !== stage.kind)) data.closed_at = new Date().toISOString();
        if (stage.kind === 'open') { data.closed_at = null; data.lost_reason = data.lost_reason ?? null; }
      }
      // Si se indica contacto sin empresa, hereda la empresa del contacto.
      if (data.contact_id && !data.company_id && !(existing?.company_id)) {
        const c = db.prepare('SELECT company_id FROM contacts WHERE id = ?').get(data.contact_id);
        if (c?.company_id) data.company_id = c.company_id;
      }
    },
    decorate: (r) => ({ ...r, weighted_value: Math.round((r.value * (r.probability || 0)) / 100 * 100) / 100 }),
    csv: [
      { key: 'id', label: 'ID' }, { key: 'title', label: 'Título' }, { key: 'value', label: 'Importe' },
      { key: 'pipeline_name', label: 'Embudo' }, { key: 'stage_name', label: 'Etapa' }, { key: 'status', label: 'Estado' },
      { key: 'contact_name', label: 'Contacto' }, { key: 'company_name', label: 'Empresa' }, { key: 'owner_name', label: 'Responsable' },
      { key: 'expected_close', label: 'Cierre previsto' }, { key: 'closed_at', label: 'Cerrada' }, { key: 'lost_reason', label: 'Motivo pérdida' },
      { key: 'source', label: 'Origen' }, { key: 'tags', label: 'Etiquetas' }, { key: 'created_at', label: 'Creado' },
    ],
  };

  const activities = {
    name: 'activities',
    label: 'Actividad',
    table: 'activities',
    alias: 'a',
    ownerScoped: true,
    select: `SELECT a.*, ${contactName('ct')} AS contact_name, co.name AS company_name, d.title AS deal_title,
      t.subject AS ticket_subject, u.name AS owner_name
      FROM activities a
      LEFT JOIN contacts ct ON ct.id = a.contact_id
      LEFT JOIN companies co ON co.id = a.company_id
      LEFT JOIN deals d ON d.id = a.deal_id
      LEFT JOIN tickets t ON t.id = a.ticket_id
      LEFT JOIN users u ON u.id = a.owner_id`,
    fields: {
      type: { type: 'enum', values: ['task', 'call', 'meeting', 'email', 'deadline'], default: 'task', label: 'Tipo' },
      subject: { type: 'text', required: true, label: 'Asunto', max: 300 },
      description: { type: 'textarea', label: 'Descripción' },
      due_at: { type: 'datetime', label: 'Fecha' },
      duration_min: { type: 'int', min: 0, max: 100000, label: 'Duración (min)' },
      priority: { type: 'enum', values: ['low', 'normal', 'high'], default: 'normal', label: 'Prioridad' },
      done: { type: 'bool', label: 'Completada' },
      contact_id: { type: 'ref', label: 'Contacto' },
      company_id: { type: 'ref', label: 'Empresa' },
      deal_id: { type: 'ref', label: 'Oportunidad' },
      ticket_id: { type: 'ref', label: 'Ticket' },
      owner_id: owner,
    },
    search: ['a.subject', 'a.description', 'ct.first_name', 'ct.last_name', 'co.name', 'd.title'],
    filters: {
      type: 'a.type', owner_id: 'a.owner_id', contact_id: 'a.contact_id', company_id: 'a.company_id', deal_id: 'a.deal_id', ticket_id: 'a.ticket_id',
      done: (v) => ['a.done = ?', [v === '1' || v === 'true' ? 1 : 0]],
      when: (v) => {
        const today = new Date().toISOString().slice(0, 10);
        if (v === 'overdue') return ['a.done = 0 AND a.due_at < ?', [today]];
        if (v === 'today') return ['substr(a.due_at, 1, 10) = ?', [today]];
        if (v === 'upcoming') return ['a.done = 0 AND a.due_at > ?', [`${today}T23:59:59`]];
        if (v === 'nodate') return ['a.due_at IS NULL', []];
        return null;
      },
      ...dateRange('a.due_at'),
    },
    sorts: { due_at: 'a.due_at', subject: 'a.subject', type: 'a.type', created_at: 'a.created_at', owner: 'u.name', priority: 'a.priority' },
    defaultSort: 'a.done ASC, a.due_at IS NULL, a.due_at ASC',
    bulkFields: ['owner_id', 'done'],
    summary: (r) => r.subject,
    beforeSave(data, existing) {
      if (data.done !== undefined) {
        if (data.done && !existing?.done) data.done_at = new Date().toISOString();
        if (!data.done) data.done_at = null;
      }
    },
    csv: [
      { key: 'id', label: 'ID' }, { key: 'type', label: 'Tipo' }, { key: 'subject', label: 'Asunto' },
      { key: 'due_at', label: 'Fecha' }, { key: 'duration_min', label: 'Duración' }, { key: 'priority', label: 'Prioridad' },
      { key: 'done', label: 'Completada' }, { key: 'contact_name', label: 'Contacto' }, { key: 'company_name', label: 'Empresa' },
      { key: 'deal_title', label: 'Oportunidad' }, { key: 'owner_name', label: 'Responsable' }, { key: 'description', label: 'Descripción' },
    ],
  };

  const products = {
    name: 'products',
    label: 'Producto',
    table: 'products',
    alias: 'p',
    customEntity: 'products',
    hasCreatedBy: false,
    select: 'SELECT p.* FROM products p',
    fields: {
      name: { type: 'text', required: true, label: 'Nombre', max: 200 },
      sku: { type: 'text', label: 'Referencia/SKU', max: 100 },
      category: { type: 'text', label: 'Categoría' },
      description: { type: 'textarea', label: 'Descripción' },
      unit: { type: 'text', label: 'Unidad', max: 20, default: 'ud' },
      price: { type: 'num', min: 0, default: 0, label: 'Precio' },
      cost: { type: 'num', min: 0, label: 'Coste' },
      tax_rate: { type: 'num', min: 0, max: 100, default: 21, label: 'IVA %' },
      active: { type: 'bool', default: 1, label: 'Activo' },
    },
    search: ['p.name', 'p.sku', 'p.category', 'p.description'],
    filters: { category: 'p.category', active: (v) => ['p.active = ?', [v === '1' || v === 'true' ? 1 : 0]] },
    sorts: { name: 'p.name', price: 'p.price', sku: 'p.sku', category: 'p.category', created_at: 'p.created_at' },
    defaultSort: 'p.name ASC',
    bulkFields: ['active', 'category', 'tax_rate'],
    summary: (r) => r.name,
    canDelete: (req) => req.user.role !== 'sales',
    csv: [
      { key: 'id', label: 'ID' }, { key: 'name', label: 'Nombre' }, { key: 'sku', label: 'SKU' },
      { key: 'category', label: 'Categoría' }, { key: 'unit', label: 'Unidad' }, { key: 'price', label: 'Precio' },
      { key: 'cost', label: 'Coste' }, { key: 'tax_rate', label: 'IVA %' }, { key: 'active', label: 'Activo' },
      { key: 'description', label: 'Descripción' },
    ],
  };

  const tickets = {
    name: 'tickets',
    label: 'Ticket',
    table: 'tickets',
    alias: 't',
    customEntity: 'tickets',
    ownerScoped: true,
    select: `SELECT t.*, ${contactName('ct')} AS contact_name, ct.email AS contact_email, co.name AS company_name, u.name AS owner_name
      FROM tickets t
      LEFT JOIN contacts ct ON ct.id = t.contact_id
      LEFT JOIN companies co ON co.id = t.company_id
      LEFT JOIN users u ON u.id = t.owner_id`,
    fields: {
      subject: { type: 'text', required: true, label: 'Asunto', max: 300 },
      description: { type: 'textarea', label: 'Descripción' },
      status: { type: 'enum', values: ['open', 'pending', 'resolved', 'closed'], default: 'open', label: 'Estado' },
      priority: { type: 'enum', values: ['low', 'normal', 'high', 'urgent'], default: 'normal', label: 'Prioridad' },
      channel: { type: 'enum', values: ['email', 'phone', 'web', 'chat', 'whatsapp', 'other'], label: 'Canal' },
      category: { type: 'text', label: 'Categoría' },
      contact_id: { type: 'ref', label: 'Contacto' },
      company_id: { type: 'ref', label: 'Empresa' },
      owner_id: owner,
      due_at: { type: 'datetime', label: 'Vencimiento' },
      tags,
    },
    search: ['t.subject', 't.description', 'ct.first_name', 'ct.last_name', 'ct.email', 'co.name'],
    filters: {
      status: (v) => (v === 'active' ? ["t.status IN ('open','pending')", []] : ['t.status = ?', [v]]),
      priority: 't.priority', owner_id: 't.owner_id', contact_id: 't.contact_id', company_id: 't.company_id', channel: 't.channel', category: 't.category',
    },
    sorts: { subject: 't.subject', created_at: 't.created_at', priority: "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END", status: 't.status', due_at: 't.due_at', updated_at: 't.updated_at' },
    defaultSort: "CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, t.created_at DESC",
    bulkFields: ['owner_id', 'status', 'priority'],
    summary: (r) => `#${r.id} ${r.subject}`,
    beforeSave(data, existing) {
      if (data.contact_id && !data.company_id && !existing?.company_id) {
        const c = db.prepare('SELECT company_id FROM contacts WHERE id = ?').get(data.contact_id);
        if (c?.company_id) data.company_id = c.company_id;
      }
      if (data.status) {
        const closing = ['resolved', 'closed'].includes(data.status);
        if (closing && !existing?.resolved_at) data.resolved_at = new Date().toISOString();
        if (!closing) data.resolved_at = null;
      }
    },
    csv: [
      { key: 'id', label: 'ID' }, { key: 'subject', label: 'Asunto' }, { key: 'status', label: 'Estado' },
      { key: 'priority', label: 'Prioridad' }, { key: 'channel', label: 'Canal' }, { key: 'category', label: 'Categoría' },
      { key: 'contact_name', label: 'Contacto' }, { key: 'company_name', label: 'Empresa' }, { key: 'owner_name', label: 'Responsable' },
      { key: 'created_at', label: 'Creado' }, { key: 'resolved_at', label: 'Resuelto' },
    ],
  };

  return { companies, contacts, deals, activities, products, tickets };
}
