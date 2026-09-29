import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Comprobación de versión: node:sqlite necesita Node.js 22.13 o superior.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n[NexoCRM] ERROR: se necesita Node.js 22.13 o superior y este servidor usa ${process.version}.`);
  console.error('[NexoCRM] Cambia la versión de Node.js en tu panel de hosting (elige 22.x o 24.x) y vuelve a desplegar.\n');
  process.exit(1);
}

// Silencia el aviso "SQLite is an experimental feature" sin necesitar flags en la línea de comandos.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type === 'ExperimentalWarning' && String(warning?.message ?? warning).includes('SQLite')) return;
  return originalEmitWarning.call(process, warning, ...args);
};

// Carga .env si existe (sin dependencias ni flags).
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { createApp } = await import('./app.js');
const { app, db } = createApp();

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
