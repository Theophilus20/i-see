/** Starts the I SEE gateway. Configuration comes from the environment (see docs/SETTINGS.md). */
import dns from 'node:dns';
import net from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { log } from './log';
import { runModelCheck } from './meta/models';

// On slow or high-latency connections Node gives each address only 250 ms before trying the
// next, which can make every attempt fail. Give each one longer.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2000);
// Try IPv4 addresses first. Some services place an IPv6 address less reliably than an IPv4 one,
// and a service that decides by location can then refuse a request it would otherwise accept.
dns.setDefaultResultOrder('ipv4first');

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
  void runModelCheck(cfg, log);
});

/**
 * Stops taking new requests and lets the ones in progress finish before exiting. A new
 * deployment sends SIGTERM to the old one while scans and drawings may still be running on
 * it; ending at once would cut them off. railway.json allows 300 seconds before a hard stop.
 */
let closing = false;
const shutdown = (graceMs: number) => {
  if (closing) return;
  closing = true;
  log('info', 'Shutting down once the requests in progress finish', { graceMs });
  const exit = () => {
    jobs.close();
    process.exit(0);
  };
  server.close(exit);
  setTimeout(exit, graceMs).unref();
};
// A checked, labelled cutaway can take a few minutes; do not cut the request off at Node's 5-minute default.
(server as unknown as { requestTimeout: number; headersTimeout: number }).requestTimeout = 12 * 60_000;

process.on('SIGINT', () => shutdown(3000));
process.on('SIGTERM', () => shutdown(290_000));
