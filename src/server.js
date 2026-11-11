import { createApp } from './app.js';
import { closeDb, databasePath, DEMO_PASSWORD_HINT } from './db.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`DocSync listening on http://localhost:${port}`);
  console.log(`Database: ${databasePath()}`);
  console.log(`Demo accounts: ana@ajaia.dev / ben@ajaia.dev / cara@ajaia.dev (password: ${DEMO_PASSWORD_HINT})`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
