import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Arranque del servidor de licencias. Sin await de nivel superior para que también
// funcione en hostings que cargan la app con require() (LiteSpeed/Passenger).
const selfFile = fileURLToPath(import.meta.url);
const [major, minor] = process.versions.node.split('.').map(Number);
console.log(`[licencias] Iniciando con Node.js ${process.version}`);

if (major < 22 || (major === 22 && minor < 5)) {
  console.error('[licencias] ERROR: se necesita Node.js 22.13 o superior. Cambia la versión en el panel del hosting.');
  process.exit(1);
} else if (major === 22 && minor < 13 && !process.execArgv.includes('--experimental-sqlite')) {
  const child = spawn(process.execPath, ['--experimental-sqlite', ...process.execArgv, selfFile, ...process.argv.slice(2)], { stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function emitWarning(warning, ...args) {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
    if (type === 'ExperimentalWarning' && String(warning?.message ?? warning).includes('SQLite')) return;
    return originalEmitWarning.call(process, warning, ...args);
  };
  const envFile = path.join(path.dirname(selfFile), '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  import('./server.js')
    .then((m) => m.start())
    .catch((err) => {
      console.error('[licencias] Error al arrancar:', err.message);
      process.exit(1);
    });
}
