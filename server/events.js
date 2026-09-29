import crypto from 'node:crypto';

/** Registro de auditoría + envío de webhooks. */
export function createEvents(db, license) {
  const insAudit = db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, ip) VALUES (?, ?, ?, ?, ?, ?)');
  const hooksStmt = db.prepare('SELECT * FROM webhooks WHERE active = 1');
  const hookStatus = db.prepare("UPDATE webhooks SET last_status = ?, last_at = datetime('now') WHERE id = ?");

  function deliver(hook, event, data) {
    const body = JSON.stringify({ event, data, sent_at: new Date().toISOString() });
    const signature = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
    fetch(hook.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-crm-event': event, 'x-crm-signature': `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => hookStatus.run(String(r.status), hook.id))
      .catch((e) => hookStatus.run(`error: ${e.message}`.slice(0, 200), hook.id));
  }

  return {
    record(req, action, entity, entityId, summary) {
      insAudit.run(req.user?.id ?? null, action, entity, entityId ?? null, summary ? String(summary).slice(0, 300) : null, req.ip || null);
      const event = `${entity}.${action}`;
      if (!license.hasFeature('webhooks')) return;
      for (const hook of hooksStmt.all()) {
        const events = hook.events.split(',').map((s) => s.trim());
        if (events.includes('*') || events.includes(event) || events.includes(`${entity}.*`)) {
          deliver(hook, event, { id: entityId, summary, user_id: req.user?.id ?? null });
        }
      }
    },
    testHook(hook) {
      deliver(hook, 'webhook.test', { message: 'Webhook de prueba' });
    },
  };
}
