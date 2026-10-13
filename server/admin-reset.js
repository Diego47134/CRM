import { hashPassword, validatePassword } from './auth.js';
import { USER_COLORS } from './routes/auth.js';
import { createDefaultPipeline } from './db.js';

/**
 * Recuperación de acceso sin SSH: si al arrancar existen las variables de entorno
 * ADMIN_RESET_EMAIL y ADMIN_RESET_PASSWORD, ese usuario queda como administrador activo
 * con esa contraseña (se crea si no existe) y se cierran sus sesiones abiertas.
 * Después de entrar hay que borrar las dos variables del panel del hosting.
 */
export function applyAdminReset(db, env = process.env) {
  const email = String(env.ADMIN_RESET_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_RESET_PASSWORD;
  if (!email && !password) return null;
  if (!email || !password) {
    console.error('[NexoCRM] Recuperación de acceso: faltan ADMIN_RESET_EMAIL o ADMIN_RESET_PASSWORD. No se ha cambiado nada.');
    return null;
  }
  try {
    validatePassword(password);
  } catch (err) {
    console.error(`[NexoCRM] Recuperación de acceso: ${err.message}. No se ha cambiado nada.`);
    return null;
  }
  const hash = hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare(`UPDATE users SET password_hash = ?, role = 'admin', active = 1, token_version = token_version + 1,
      updated_at = datetime('now') WHERE id = ?`).run(hash, existing.id);
  } else {
    db.prepare('INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)')
      .run('Administrador', email, hash, 'admin', USER_COLORS[0]);
  }
  // Si la base de datos estaba vacía (sin pasar por el asistente), crea el embudo por defecto.
  if (!db.prepare('SELECT 1 FROM pipelines LIMIT 1').get()) createDefaultPipeline(db);
  db.prepare("INSERT INTO audit_log (action, entity, summary) VALUES ('admin_reset', 'users', ?)").run(email);
  console.warn(`[NexoCRM] Acceso de administrador restablecido para ${email}. BORRA ya las variables ADMIN_RESET_EMAIL y ADMIN_RESET_PASSWORD.`);
  return { email, created: !existing };
}
