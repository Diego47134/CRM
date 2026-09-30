// Punto de entrada CommonJS para hostings que cargan la app con require() (LiteSpeed, Passenger…).
import('./server/index.js').catch((err) => {
  console.error('[NexoCRM] Error al arrancar:', err);
  process.exit(1);
});
