import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const selfFile = fileURLToPath(import.meta.url);
console.log(`[NexoCRM] Iniciando con Node.js ${process.version}`);

// node:sqlite existe desde Node 22.5; hasta la 22.12 necesita el flag --experimental-sqlite.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`[NexoCRM] ERROR: se necesita Node.js 22.13 o superior y este servidor usa ${process.version}.`);
  console.error('[NexoCRM] Cambia la versión de Node.js en tu panel de hosting (elige 22.x o 24.x) y vuelve a desplegar.');
  process.exit(1);
}
if (major === 22 && minor < 13 && !process.execArgv.includes('--experimental-sqlite')) {
  // Se relanza a sí mismo con el flag necesario.
  const child = spawn(process.execPath, ['--experimental-sqlite', ...process.execArgv, selfFile, ...process.argv.slice(2)], { stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  // Sin await en el nivel superior: así el módulo también se puede cargar con require()
  // (LiteSpeed/Passenger, usados por hostings como Hostinger).
  start().catch((err) => {
    console.error('[NexoCRM] Error al arrancar:', err);
    process.exit(1);
  });
}

async function start() {

  // Silencia el aviso "SQLite is an experimental feature" sin necesitar flags en la línea de comandos.
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function emitWarning(warning, ...args) {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
    if (type === 'ExperimentalWarning' && String(warning?.message ?? warning).includes('SQLite')) return;
    return originalEmitWarning.call(process, warning, ...args);
  };

  // Carga .env si existe (sin dependencias ni flags).
  const root = path.join(path.dirname(selfFile), '..');
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  const { createApp } = await import('./app.js');
  let created;
  try {
    created = createApp();
  } catch (err) {
    // Si la ruta de DB_FILE no es válida o no tiene permisos, usa data/crm.db dentro de la app.
    if (!process.env.DB_FILE) throw err;
    console.error(`[NexoCRM] No se puede usar DB_FILE=${process.env.DB_FILE}: ${err.message}`);
    const fallback = path.join(root, 'data', 'crm.db');
    console.error(`[NexoCRM] Usando ${fallback} en su lugar.`);
    created = createApp({ dbFile: fallback });
  }
  const { app, db } = created;

  // Algunos hostings (Passenger/LiteSpeed) pasan PORT como ruta de socket en lugar de número.
  const rawPort = process.env.PORT || '3000';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
  const host = process.env.HOST || '0.0.0.0';

  const onListen = () => {
    console.log(`NexoCRM escuchando en ${typeof port === 'number' ? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}` : port}`);
  };
  const server = typeof port === 'number' ? app.listen(port, host, onListen) : app.listen(port, onListen);

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
