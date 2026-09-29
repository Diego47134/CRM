import crypto from 'node:crypto';
import { hashPassword } from './auth.js';
import { calcItem } from './routes/quotes.js';

/** Datos de ejemplo para demos comerciales y pruebas. */
export function seedDemo(db, adminId) {
  const rnd = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const daysFromNow = (d) => new Date(Date.now() + d * 86400000);
  const iso = (d) => d.toISOString();
  const day = (d) => d.toISOString().slice(0, 10);

  const users = [adminId];
  for (const [name, email, color] of [['Laura Gómez', 'laura@demo.local', '#eb6834'], ['Carlos Ruiz', 'carlos@demo.local', '#1baf7a']]) {
    const info = db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)')
      // Contraseña aleatoria: el administrador puede restablecerla si quiere usar estos usuarios.
      .run(name, email, hashPassword(crypto.randomBytes(18).toString('base64url')), 'sales', color);
    if (info.changes) users.push(Number(info.lastInsertRowid));
  }

  const companies = [
    ['Innova Soluciones SL', 'Tecnología', 'Madrid'], ['Grupo Alimentario Norte', 'Industria', 'Bilbao'],
    ['Clínica Dental Sonrisa', 'Salud', 'Valencia'], ['Construcciones Levante', 'Construcción', 'Alicante'],
    ['Hotel Mirador del Mar', 'Hostelería', 'Málaga'], ['Academia Formación Plus', 'Educación', 'Sevilla'],
    ['Moda Urbana Retail', 'Retail', 'Barcelona'], ['Asesoría Fiscal Pérez', 'Finanzas', 'Zaragoza'],
    ['Logística Express 24', 'Servicios', 'Madrid'], ['Energía Verde Solar', 'Industria', 'Murcia'],
  ];
  const companyIds = companies.map(([name, industry, city], i) => Number(db.prepare(
    'INSERT INTO companies (name, industry, city, country, website, phone, employees, owner_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(name, industry, city, 'España', `https://www.${name.toLowerCase().split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '')}.es`,
    `+34 9${String(10000000 + i * 7654321).slice(0, 8)}`, 5 + Math.floor(rnd() * 200), pick(users), adminId, iso(daysFromNow(-120 + i * 5))).lastInsertRowid));

  const first = ['Ana', 'Javier', 'María', 'David', 'Lucía', 'Pablo', 'Elena', 'Sergio', 'Marta', 'Alberto', 'Sara', 'Miguel', 'Paula', 'Jorge', 'Irene', 'Raúl', 'Carmen', 'Diego', 'Nuria', 'Iván'];
  const last = ['García', 'Martínez', 'López', 'Sánchez', 'Fernández', 'Romero', 'Navarro', 'Torres', 'Díaz', 'Moreno'];
  const titles = ['Director General', 'Gerente', 'Responsable de Compras', 'Director Comercial', 'CTO', 'Administración', 'Jefa de Marketing'];
  const sources = ['Web', 'Referido', 'Llamada en frío', 'Redes sociales', 'Evento', 'Publicidad'];
  const statuses = ['lead', 'lead', 'prospect', 'prospect', 'customer', 'customer', 'inactive'];
  const contactIds = [];
  first.forEach((fn, i) => {
    const ln = last[i % last.length];
    const companyIdx = i % companyIds.length;
    const email = `${fn}.${ln}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + `@ejemplo${companyIdx}.es`;
    contactIds.push(Number(db.prepare(`INSERT INTO contacts (first_name, last_name, email, phone, job_title, company_id, status, source, score, owner_id, city, country, tags, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      fn, ln, email, `+34 6${String(10000000 + i * 3456789).slice(0, 8)}`, pick(titles), companyIds[companyIdx], pick(statuses), pick(sources),
      Math.floor(rnd() * 100), pick(users), companies[companyIdx][2], 'España', i % 3 === 0 ? 'vip' : (i % 4 === 0 ? 'newsletter' : null), adminId,
      iso(daysFromNow(-90 + i * 4)),
    ).lastInsertRowid));
  });

  const pipelineId = db.prepare('SELECT id FROM pipelines ORDER BY position LIMIT 1').get().id;
  const stages = db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position').all(pipelineId);
  const dealNames = ['Implantación ERP', 'Renovación anual', 'Web corporativa', 'Consultoría estratégica', 'Pack formación', 'Mantenimiento 24/7',
    'Campaña marketing', 'Licencias software', 'Auditoría seguridad', 'Ampliación contrato', 'Proyecto piloto', 'Integración API',
    'Soporte premium', 'Migración a la nube', 'App móvil', 'Tienda online', 'Plan de fidelización', 'Equipamiento oficina'];
  const lostReasons = ['Precio', 'Competencia', 'Sin presupuesto', 'Sin respuesta'];
  const dealIds = [];
  dealNames.forEach((title, i) => {
    const stage = stages[i % stages.length];
    const ci = i % contactIds.length;
    const created = daysFromNow(-200 + i * 11);
    const closed = stage.kind !== 'open' ? iso(daysFromNow(-Math.floor(rnd() * 300))) : null;
    dealIds.push(Number(db.prepare(`INSERT INTO deals (title, value, pipeline_id, stage_id, status, contact_id, company_id, owner_id, expected_close, closed_at, lost_reason, source, position, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `${title} - ${companies[ci % companies.length][0].split(' ')[0]}`, Math.round((1500 + rnd() * 28000) / 50) * 50, pipelineId, stage.id, stage.kind,
      contactIds[ci], companyIds[ci % companyIds.length], pick(users), day(daysFromNow(Math.floor(rnd() * 90) - 10)), closed,
      stage.kind === 'lost' ? pick(lostReasons) : null, pick(sources), i, adminId, iso(created),
    ).lastInsertRowid));
  });

  const acts = [
    ['call', 'Llamada de seguimiento'], ['meeting', 'Reunión de presentación'], ['email', 'Enviar propuesta'],
    ['task', 'Preparar presupuesto'], ['call', 'Confirmar requisitos'], ['meeting', 'Demo del producto'], ['deadline', 'Fecha límite de oferta'],
  ];
  for (let i = 0; i < 24; i++) {
    const [type, subject] = acts[i % acts.length];
    const due = daysFromNow(Math.floor(i / 2) - 5);
    due.setHours(9 + (i % 8), i % 2 ? 30 : 0, 0, 0);
    const done = i < 7 ? 1 : 0;
    const di = i % dealIds.length;
    db.prepare(`INSERT INTO activities (type, subject, due_at, duration_min, done, done_at, contact_id, deal_id, owner_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(type, subject, `${day(due)}T${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
      type === 'meeting' ? 60 : 15, done, done ? iso(due) : null, contactIds[di % contactIds.length], dealIds[di], i % 3 === 0 ? adminId : pick(users), adminId);
  }

  db.prepare('INSERT INTO notes (body, contact_id, user_id) VALUES (?, ?, ?)').run('Muy interesado en la integración con su ERP actual. Volver a llamar la próxima semana.', contactIds[0], adminId);
  db.prepare('INSERT INTO notes (body, deal_id, user_id) VALUES (?, ?, ?)').run('El cliente pide un 10% de descuento si firma antes de fin de mes.', dealIds[2], adminId);

  const products = [
    ['Licencia anual Básica', 'LIC-BAS', 'Licencias', 290], ['Licencia anual Pro', 'LIC-PRO', 'Licencias', 590],
    ['Hora de consultoría', 'SRV-CON', 'Servicios', 65], ['Instalación y configuración', 'SRV-INS', 'Servicios', 450],
    ['Formación (jornada)', 'SRV-FOR', 'Formación', 380], ['Soporte premium anual', 'SOP-PRE', 'Soporte', 900],
  ];
  const productIds = products.map(([name, sku, cat, price]) => Number(db.prepare(
    "INSERT INTO products (name, sku, category, price, cost, tax_rate, unit) VALUES (?, ?, ?, ?, ?, 21, ?)",
  ).run(name, sku, cat, price, Math.round(price * 0.4), cat === 'Servicios' ? 'h' : 'ud').lastInsertRowid));

  // Un presupuesto y una factura de ejemplo
  const mkDoc = (kind, number, status, dealIdx, lines) => {
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealIds[dealIdx]);
    const qid = Number(db.prepare(`INSERT INTO quotes (kind, number, title, status, contact_id, company_id, deal_id, owner_id, issue_date, due_date, currency, terms, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?)`).run(kind, number, deal.title, status, deal.contact_id, deal.company_id, deal.id, deal.owner_id,
      day(daysFromNow(-10)), day(daysFromNow(20)), kind === 'quote' ? 'Presupuesto válido durante 30 días.' : 'Pago por transferencia bancaria.', adminId).lastInsertRowid);
    let sub = 0; let tax = 0;
    lines.forEach(([pIdx, qty], pos) => {
      const [name, , , price] = products[pIdx];
      const it = calcItem({ product_id: productIds[pIdx], description: name, quantity: qty, unit_price: price, discount_pct: 0, tax_rate: 21, position: pos });
      db.prepare(`INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, subtotal, tax, total, position)
        VALUES (?, ?, ?, ?, ?, 0, 21, ?, ?, ?, ?)`).run(qid, it.product_id, it.description, qty, price, it.subtotal, it.tax, it.total, pos);
      sub += it.subtotal; tax += it.tax;
    });
    db.prepare('UPDATE quotes SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?').run(sub, tax, Math.round((sub + tax) * 100) / 100, qid);
  };
  const y = new Date().getFullYear();
  mkDoc('quote', `PRE-${y}-0001`, 'sent', 2, [[1, 3], [3, 1], [4, 2]]);
  mkDoc('invoice', `FAC-${y}-0001`, 'paid', 4, [[0, 5], [5, 1]]);
  db.prepare("UPDATE settings SET value = '2' WHERE key IN ('next_quote_number', 'next_invoice_number')").run();

  const ticketData = [
    ['No puedo acceder a mi cuenta', 'open', 'high', 'email'], ['Duda sobre la factura de marzo', 'pending', 'normal', 'phone'],
    ['Solicitud de nueva funcionalidad', 'open', 'low', 'web'], ['Error al exportar informe', 'resolved', 'urgent', 'chat'],
  ];
  ticketData.forEach(([subject, status, priority, channel], i) => {
    db.prepare(`INSERT INTO tickets (subject, description, status, priority, channel, category, contact_id, company_id, owner_id, resolved_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(subject, 'Descripción de ejemplo del ticket.', status, priority, channel, i % 2 ? 'Facturación' : 'Incidencia',
      contactIds[i], companyIds[i], pick(users), status === 'resolved' ? iso(daysFromNow(-1)) : null, adminId);
  });
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
