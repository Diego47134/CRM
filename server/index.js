import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const { app, db } = createApp();

const server = app.listen(port, host, () => {
  console.log(`NexoCRM escuchando en http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
