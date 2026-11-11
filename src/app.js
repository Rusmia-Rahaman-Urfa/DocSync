import express from 'express';
import multer from 'multer';
import { join } from 'node:path';
import { getDb, ROOT } from './db.js';
import { router } from './routes.js';

/**
 * Build the Express app without binding a port, so tests can run it on an
 * ephemeral port against a throwaway database.
 */
export function createApp() {
  // Open (and, on first boot, seed) the database before serving traffic.
  getDb();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
    );
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  app.use('/api', router);
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Unknown API route.' });
  });

  const publicDir = join(ROOT, 'public');
  app.use(express.static(publicDir, { etag: true, maxAge: 0 }));

  // Single-page app fallback for non-API GET requests.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.sendFile(join(publicDir, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large', message: 'Files must be 2 MB or smaller.' });
      }
      return res.status(400).json({ error: 'upload_failed', message: 'That file could not be uploaded.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'That request is too large.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON.' });
    }

    console.error('[docsync] unhandled error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  });

  return app;
}
