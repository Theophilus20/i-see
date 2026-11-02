/** Starts the I SEE gateway. Configuration comes from the environment (see docs/SETTINGS.md). */
import net from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { log } from './log';
import { MODEL_SETTING, closestModels, listModels } from './meta/models';

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
  if (cfg.meta.apiKey) void checkModels();
});

/** Which models this key can use: written to the log, and any name it does not have switched to the closest it does. */
async function checkModels() {
  const r = await listModels(cfg.meta.baseUrl, cfg.meta.apiKey!);
  if (!('ids' in r)) {
    if (r.status === 401 || r.status === 403) log('error', 'The Meta Model API did not accept MODEL_API_KEY. Check that it is copied exactly, with no quotes or spaces.', { status: r.status });
    else log('warn', 'Could not list the models this key can use; using the configured names.', { status: r.status, error: r.error });
    return;
  }
  log('info', 'Models this key can use', { models: r.ids.slice(0, 60) });
  if (!r.ids.length) return;
  const { switched, unlisted } = closestModels(cfg.meta.models, r.ids);
  for (const s of switched) {
    cfg.meta.models[s.role] = s.to;
    log('warn', `${s.from} is not available to this key: using ${s.to} instead. Set ${MODEL_SETTING[s.role]} to choose another.`, { setting: MODEL_SETTING[s.role] });
  }
  for (const u of unlisted) log('warn', `${u.name} is not in this key's model list and has no close version there; calls to it may fail. Set ${MODEL_SETTING[u.role]} to a model from the list.`, { setting: MODEL_SETTING[u.role] });
}

const shutdown = () => {
  jobs.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
// A checked, labelled cutaway can take a few minutes; do not cut the request off at Node's 5-minute default.
(server as unknown as { requestTimeout: number; headersTimeout: number }).requestTimeout = 12 * 60_000;

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
