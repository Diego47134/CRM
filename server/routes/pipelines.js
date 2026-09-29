import { Router } from 'express';
import { requireRole } from '../auth.js';
import { HttpError, coerceField, idParam } from '../http.js';
import { tx } from '../db.js';

export function pipelineRoutes({ db, events }) {
  const r = Router();
  const admin = requireRole('admin', 'manager');

  const withStages = (p) => ({
    ...p,
    stages: db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM deals d WHERE d.stage_id = s.id) AS deals_count
      FROM stages s WHERE s.pipeline_id = ? ORDER BY s.position, s.id`).all(p.id),
  });

  r.get('/', (_req, res) => {
    res.json(db.prepare('SELECT * FROM pipelines ORDER BY position, id').all().map(withStages));
  });

  const readStages = (list) => {
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'El embudo necesita al menos una etapa');
    const stages = list.map((s, i) => ({
      id: s.id ? Number(s.id) : null,
      name: coerceField('name', { type: 'text', required: true, max: 80 }, s.name, 'Nombre de etapa'),
      probability: coerceField('probability', { type: 'int', min: 0, max: 100 }, s.probability ?? 0, 'Probabilidad') ?? 0,
      kind: coerceField('kind', { type: 'enum', values: ['open', 'won', 'lost'] }, s.kind || 'open', 'Tipo'),
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : null,
      position: i,
    }));
    if (!stages.some((s) => s.kind === 'open')) throw new HttpError(400, 'Debe haber al menos una etapa abierta');
    return stages;
  };

  function saveStages(pipelineId, stages, moveTo) {
    const current = db.prepare('SELECT id FROM stages WHERE pipeline_id = ?').all(pipelineId).map((s) => s.id);
    const keep = new Set();
    for (const s of stages) {
      if (s.id && current.includes(s.id)) {
        db.prepare('UPDATE stages SET name = ?, probability = ?, kind = ?, color = ?, position = ? WHERE id = ?')
          .run(s.name, s.probability, s.kind, s.color, s.position, s.id);
        db.prepare("UPDATE deals SET status = ? WHERE stage_id = ?").run(s.kind, s.id);
        keep.add(s.id);
      } else {
        const info = db.prepare('INSERT INTO stages (pipeline_id, name, probability, kind, color, position) VALUES (?, ?, ?, ?, ?, ?)')
          .run(pipelineId, s.name, s.probability, s.kind, s.color, s.position);
        keep.add(Number(info.lastInsertRowid));
      }
    }
    const removed = current.filter((id) => !keep.has(id));
    if (removed.length) {
      const fallback = db.prepare("SELECT id, kind FROM stages WHERE pipeline_id = ? AND id IN (" + [...keep].join(',') + ") ORDER BY position LIMIT 1").get(pipelineId);
      const target = moveTo && keep.has(moveTo) ? db.prepare('SELECT id, kind FROM stages WHERE id = ?').get(moveTo) : fallback;
      for (const id of removed) {
        db.prepare('UPDATE deals SET stage_id = ?, status = ? WHERE stage_id = ?').run(target.id, target.kind, id);
        db.prepare('DELETE FROM stages WHERE id = ?').run(id);
      }
    }
  }

  r.post('/', admin, (req, res) => {
    const name = coerceField('name', { type: 'text', required: true, max: 100 }, req.body?.name, 'Nombre');
    const stages = readStages(req.body?.stages || [
      { name: 'Nuevo', probability: 10 }, { name: 'En curso', probability: 50 },
      { name: 'Ganado', probability: 100, kind: 'won' }, { name: 'Perdido', probability: 0, kind: 'lost' },
    ]);
    const id = tx(db, () => {
      const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pipelines').get().p;
      const pid = Number(db.prepare('INSERT INTO pipelines (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid);
      saveStages(pid, stages.map((s) => ({ ...s, id: null })));
      return pid;
    });
    events.record(req, 'created', 'pipelines', id, name);
    res.status(201).json(withStages(db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id)));
  });

  r.put('/:id', admin, (req, res) => {
    const id = idParam(req);
    const p = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    if (!p) throw new HttpError(404, 'Embudo no encontrado');
    const name = coerceField('name', { type: 'text', required: true, max: 100 }, req.body?.name ?? p.name, 'Nombre');
    const stages = req.body?.stages ? readStages(req.body.stages) : null;
    tx(db, () => {
      db.prepare('UPDATE pipelines SET name = ? WHERE id = ?').run(name, id);
      if (stages) saveStages(id, stages, req.body.move_to ? Number(req.body.move_to) : null);
    });
    events.record(req, 'updated', 'pipelines', id, name);
    res.json(withStages(db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id)));
  });

  r.delete('/:id', requireRole('admin'), (req, res) => {
    const id = idParam(req);
    if (db.prepare('SELECT COUNT(*) AS n FROM pipelines').get().n <= 1) throw new HttpError(400, 'Debe existir al menos un embudo');
    const n = db.prepare('SELECT COUNT(*) AS n FROM deals WHERE pipeline_id = ?').get(id).n;
    if (n > 0) throw new HttpError(400, `El embudo tiene ${n} oportunidades. Muévelas antes de eliminarlo.`);
    db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
    events.record(req, 'deleted', 'pipelines', id, null);
    res.json({ ok: true });
  });

  return r;
}
