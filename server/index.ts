/** Starts the I SEE gateway. Configuration comes from the environment (see .env.example). */
import net from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { log } from './log';

// On slow or high-latency connections Node gives each address only 250 ms before trying the
// next, which can make every attempt fail. Give each one longer.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2000);

const cfg = loadConfig();
if (!cfg.staticDir && process.env.NODE_ENV === 'production') cfg.staticDir = 'dist';
const { app, jobs, health } = createApp({ cfg });
const h = health();

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
  log('info', 'I SEE gateway listening', {
    url: `http://${info.address}:${info.port}`,
    mode: h.mode,
    routes: Object.entries(h.routes)
      .filter(([, on]) => on)
      .map(([r]) => r),
    privacyTier: h.privacyTier,
  });
  if (h.mode === 'unconfigured') log('warn', 'No model provider configured: set MODEL_API_KEY in .env. The app will offer sample runs only.');
});

const shutdown = () => {
  jobs.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
// A checked, labelled cutaway can take a few minutes; do not cut the request off at Node's 5-minute default.
(server as unknown as { requestTimeout: number; headersTimeout: number }).requestTimeout = 12 * 60_000;

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
