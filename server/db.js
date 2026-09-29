import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Cada entrada es una migración; el índice + 1 es la versión (PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('admin','manager','sales')),
    active        INTEGER NOT NULL DEFAULT 1,
    phone         TEXT,
    title         TEXT,
    color         TEXT,
    token_version INTEGER NOT NULL DEFAULT 0,
    last_login    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE api_keys (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    prefix     TEXT NOT NULL,
    key_hash   TEXT NOT NULL UNIQUE,
    last_used  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE companies (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    industry       TEXT,
    website        TEXT,
    email          TEXT,
    phone          TEXT,
    tax_id         TEXT,
    address        TEXT,
    city           TEXT,
    state          TEXT,
    postal_code    TEXT,
    country        TEXT,
    employees      INTEGER,
    annual_revenue REAL,
    owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    tags           TEXT,
    description    TEXT,
    custom         TEXT,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_companies_owner ON companies(owner_id);
  CREATE INDEX idx_companies_name ON companies(name);

  CREATE TABLE contacts (
    id            INTEGER PRIMARY KEY,
    first_name    TEXT NOT NULL,
    last_name     TEXT,
    email         TEXT,
    phone         TEXT,
    mobile        TEXT,
    job_title     TEXT,
    company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'lead',
    source        TEXT,
    score         INTEGER NOT NULL DEFAULT 0,
    owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    address       TEXT,
    city          TEXT,
    state         TEXT,
    postal_code   TEXT,
    country       TEXT,
    birthday      TEXT,
    linkedin      TEXT,
    email_opt_out INTEGER NOT NULL DEFAULT 0,
    tags          TEXT,
    description   TEXT,
    custom        TEXT,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_contacts_company ON contacts(company_id);
  CREATE INDEX idx_contacts_owner ON contacts(owner_id);
  CREATE INDEX idx_contacts_email ON contacts(email);

  CREATE TABLE pipelines (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE stages (
    id          INTEGER PRIMARY KEY,
    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    probability INTEGER NOT NULL DEFAULT 0,
    kind        TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open','won','lost')),
    color       TEXT
  );
  CREATE INDEX idx_stages_pipeline ON stages(pipeline_id);

  CREATE TABLE deals (
    id             INTEGER PRIMARY KEY,
    title          TEXT NOT NULL,
    value          REAL NOT NULL DEFAULT 0,
    pipeline_id    INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    stage_id       INTEGER NOT NULL REFERENCES stages(id),
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
    contact_id     INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expected_close TEXT,
    closed_at      TEXT,
    lost_reason    TEXT,
    source         TEXT,
    priority       TEXT NOT NULL DEFAULT 'normal',
    position       REAL NOT NULL DEFAULT 0,
    tags           TEXT,
    description    TEXT,
    custom         TEXT,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_deals_stage ON deals(stage_id);
  CREATE INDEX idx_deals_pipeline ON deals(pipeline_id);
  CREATE INDEX idx_deals_contact ON deals(contact_id);
  CREATE INDEX idx_deals_company ON deals(company_id);
  CREATE INDEX idx_deals_owner ON deals(owner_id);

  CREATE TABLE tickets (
    id          INTEGER PRIMARY KEY,
    subject     TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
    priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    channel     TEXT,
    category    TEXT,
    contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_at      TEXT,
    resolved_at TEXT,
    tags        TEXT,
    custom      TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tickets_contact ON tickets(contact_id);
  CREATE INDEX idx_tickets_owner ON tickets(owner_id);

  CREATE TABLE activities (
    id           INTEGER PRIMARY KEY,
    type         TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task','call','meeting','email','deadline')),
    subject      TEXT NOT NULL,
    description  TEXT,
    due_at       TEXT,
    duration_min INTEGER,
    priority     TEXT NOT NULL DEFAULT 'normal',
    done         INTEGER NOT NULL DEFAULT 0,
    done_at      TEXT,
    contact_id   INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    deal_id      INTEGER REFERENCES deals(id) ON DELETE CASCADE,
    ticket_id    INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_activities_due ON activities(due_at);
  CREATE INDEX idx_activities_owner ON activities(owner_id);
  CREATE INDEX idx_activities_contact ON activities(contact_id);
  CREATE INDEX idx_activities_deal ON activities(deal_id);
  CREATE INDEX idx_activities_company ON activities(company_id);

  CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    body       TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    deal_id    INTEGER REFERENCES deals(id) ON DELETE CASCADE,
    ticket_id  INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_notes_contact ON notes(contact_id);
  CREATE INDEX idx_notes_company ON notes(company_id);
  CREATE INDEX idx_notes_deal ON notes(deal_id);
  CREATE INDEX idx_notes_ticket ON notes(ticket_id);

  CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    sku         TEXT,
    category    TEXT,
    description TEXT,
    unit        TEXT NOT NULL DEFAULT 'ud',
    price       REAL NOT NULL DEFAULT 0,
    cost        REAL,
    tax_rate    REAL NOT NULL DEFAULT 21,
    active      INTEGER NOT NULL DEFAULT 1,
    custom      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quotes (
    id              INTEGER PRIMARY KEY,
    kind            TEXT NOT NULL DEFAULT 'quote' CHECK (kind IN ('quote','invoice')),
    number          TEXT NOT NULL,
    title           TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    contact_id      INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    company_id      INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    deal_id         INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    issue_date      TEXT NOT NULL,
    due_date        TEXT,
    currency        TEXT NOT NULL DEFAULT 'EUR',
    subtotal        REAL NOT NULL DEFAULT 0,
    discount_total  REAL NOT NULL DEFAULT 0,
    tax_total       REAL NOT NULL DEFAULT 0,
    total           REAL NOT NULL DEFAULT 0,
    notes           TEXT,
    terms           TEXT,
    source_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
    paid_at         TEXT,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (kind, number)
  );
  CREATE INDEX idx_quotes_deal ON quotes(deal_id);
  CREATE INDEX idx_quotes_contact ON quotes(contact_id);
  CREATE INDEX idx_quotes_company ON quotes(company_id);

  CREATE TABLE quote_items (
    id           INTEGER PRIMARY KEY,
    quote_id     INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
    description  TEXT NOT NULL,
    quantity     REAL NOT NULL DEFAULT 1,
    unit_price   REAL NOT NULL DEFAULT 0,
    discount_pct REAL NOT NULL DEFAULT 0,
    tax_rate     REAL NOT NULL DEFAULT 0,
    subtotal     REAL NOT NULL DEFAULT 0,
    tax          REAL NOT NULL DEFAULT 0,
    total        REAL NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);

  CREATE TABLE custom_fields (
    id       INTEGER PRIMARY KEY,
    entity   TEXT NOT NULL CHECK (entity IN ('contacts','companies','deals','tickets','products')),
    key      TEXT NOT NULL,
    label    TEXT NOT NULL,
    type     TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','textarea','number','date','select','checkbox','url')),
    options  TEXT,
    required INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (entity, key)
  );

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  INTEGER,
    summary    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
  CREATE INDEX idx_audit_created ON audit_log(created_at);

  CREATE TABLE webhooks (
    id          INTEGER PRIMARY KEY,
    url         TEXT NOT NULL,
    events      TEXT NOT NULL DEFAULT '*',
    secret      TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    last_status TEXT,
    last_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export const DEFAULT_SETTINGS = {
  company_name: 'Mi Empresa',
  company_tax_id: '',
  company_address: '',
  company_email: '',
  company_phone: '',
  currency: 'EUR',
  locale: 'es-ES',
  default_tax_rate: '21',
  quote_prefix: 'PRE-',
  invoice_prefix: 'FAC-',
  next_quote_number: '1',
  next_invoice_number: '1',
  quote_validity_days: '30',
  invoice_due_days: '30',
  quote_terms: 'Presupuesto válido durante 30 días desde su emisión.',
  invoice_terms: 'Pago por transferencia bancaria.',
  sales_see_own_only: '0',
  contact_sources: 'Web,Referido,Llamada en frío,Redes sociales,Evento,Publicidad,Otro',
  lost_reasons: 'Precio,Competencia,Sin presupuesto,Sin respuesta,Momento inadecuado,Otro',
  industries: 'Tecnología,Retail,Servicios,Industria,Salud,Educación,Hostelería,Construcción,Finanzas,Otro',
  ticket_categories: 'Consulta,Incidencia,Facturación,Sugerencia',
};

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  ensureSettings(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

function ensureSettings(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
  insert.run('installed_at', new Date().toISOString());
  insert.run('instance_id', crypto.randomUUID());
  insert.run('jwt_secret', crypto.randomBytes(48).toString('hex'));
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}

export function getSettings(db) {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
  return out;
}

export function createDefaultPipeline(db) {
  const { lastInsertRowid: pid } = db.prepare('INSERT INTO pipelines (name, position) VALUES (?, 0)').run('Ventas');
  const stages = [
    ['Nuevo', 10, 'open', '#2a78d6'],
    ['Calificado', 25, 'open', '#4a3aa7'],
    ['Propuesta', 50, 'open', '#eda100'],
    ['Negociación', 75, 'open', '#eb6834'],
    ['Ganado', 100, 'won', '#0ca30c'],
    ['Perdido', 0, 'lost', '#d03b3b'],
  ];
  const ins = db.prepare('INSERT INTO stages (pipeline_id, name, position, probability, kind, color) VALUES (?, ?, ?, ?, ?, ?)');
  stages.forEach(([name, prob, kind, color], i) => ins.run(pid, name, i, prob, kind, color));
  return Number(pid);
}
