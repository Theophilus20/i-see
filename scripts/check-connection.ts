/**
 * Can this computer reach the model service? Checks each step in turn and says, in plain
 * words, where it breaks: internet, name lookup, connection, secure connection, API key.
 *
 *   npm run check:connection
 *
 * Costs nothing: the last step only lists the available models.
 */
import { promises as dns } from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { loadConfig } from '../server/config';
import { networkCause } from '../server/meta/http';

const cfg = loadConfig();
const base = cfg.meta.baseUrl;
const host = new URL(base).hostname;
const ok = (s: string) => console.log(`  OK    ${s}`);
const bad = (s: string) => console.log(`  FAIL  ${s}`);
const note = (s: string) => console.log(`        ${s}`);
let failed = false;

const timed = async <T>(fn: () => Promise<T>): Promise<{ v: T; ms: number }> => {
  const t = Date.now();
  const v = await fn();
  return { v, ms: Date.now() - t };
};

function tcp(address: string, family: number, timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    const s = net.connect({ host: address, port: 443, family });
    const timer = setTimeout(() => {
      s.destroy();
      reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(timer);
      s.end();
      resolve(Date.now() - t);
    });
    s.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function tlsCheck(timeoutMs = 20_000): Promise<{ ms: number; issuer: string }> {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    const s = tls.connect({ host, port: 443, servername: host });
    const timer = setTimeout(() => {
      s.destroy();
      reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    s.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = s.getPeerCertificate();
      const issuer = [cert?.issuer?.O, cert?.issuer?.CN].filter(Boolean).join(' / ');
      s.end();
      resolve({ ms: Date.now() - t, issuer });
    });
    s.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const why = (e: unknown) => {
  const c = networkCause(e);
  return `${c.plain ?? (e as Error)?.message ?? String(e)}${c.code ? ` [${c.code}]` : ''}`;
};

async function main() {
  console.log(`\nChecking the connection from this computer to ${host}\n`);
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? null;
  if (proxy) note(`A proxy is set (${proxy.replace(/\/\/[^@]*@/, '//***@')}). Node does not use it by default, so requests go out directly.`);

  // 1. Internet at all?
  try {
    const { ms } = await timed(() => fetch('https://www.wikipedia.org/', { method: 'HEAD', signal: AbortSignal.timeout(20_000) }));
    ok(`Internet works (reached wikipedia.org in ${ms} ms).`);
  } catch (e) {
    bad(`This computer cannot reach the internet: ${why(e)}.`);
    note('Check Wi-Fi or mobile data first, then run this again.');
    failed = true;
  }

  // 2. Name lookup
  let addrs: Array<{ address: string; family: number }> = [];
  try {
    const { v, ms } = await timed(() => dns.lookup(host, { all: true }));
    addrs = v;
    ok(`Found ${host} (${v.map((a) => a.address).join(', ')}) in ${ms} ms.`);
  } catch (e) {
    const c = networkCause(e);
    bad(`Could not find ${host} by name${c.code ? ` [${c.code}]` : ''}.`);
    note('Your DNS may be blocking it. Try another network, or set DNS to 1.1.1.1 or 8.8.8.8.');
    failed = true;
  }

  // 3. Plain connection, one address of each kind
  const v4 = addrs.find((a) => a.family === 4);
  const v6 = addrs.find((a) => a.family === 6);
  for (const a of [v4, v6].filter(Boolean) as Array<{ address: string; family: number }>) {
    try {
      const ms = await tcp(a.address, a.family);
      ok(`Connected to ${a.address} (IPv${a.family}) in ${ms} ms.`);
    } catch (e) {
      (a.family === 6 && v4 ? note : bad)(`${a.family === 6 && v4 ? 'IPv6 does not work here (that is fine if IPv4 does): ' : `Could not connect to ${a.address}: `}${why(e)}.`);
      if (a.family === 4) {
        note('Something between this computer and the service is blocking it: a firewall, antivirus, VPN or the network itself.');
        failed = true;
      }
    }
  }

  // 4. Secure connection
  if (!addrs.length) {
    console.log(failed ? '\nFix the problem above first, then run this again.\n' : '');
    process.exit(1);
  }
  try {
    const { ms, issuer } = await tlsCheck();
    ok(`Secure connection made in ${ms} ms${issuer ? ` (certificate from ${issuer})` : ''}.`);
    if (issuer && /kaspersky|avast|avg|eset|bitdefender|norton|mcafee|sophos|fortinet|zscaler|netskope|bluecoat|proxy/i.test(issuer))
      note('That certificate comes from security software checking your traffic. If calls fail, turn off its HTTPS/web scanning for Node.js.');
  } catch (e) {
    bad(`Secure connection failed: ${why(e)}.`);
    note('Antivirus "web shield"/HTTPS scanning, a VPN or a school/work network often causes this.');
    failed = true;
  }

  // 5. The service itself, with your key
  if (!cfg.meta.apiKey) {
    bad('No MODEL_API_KEY in .env, so the service cannot be used.');
    failed = true;
  } else {
    try {
      const { v: res, ms } = await timed(() =>
        fetch(`${base}/models`, { headers: { Authorization: `Bearer ${cfg.meta.apiKey}` }, signal: AbortSignal.timeout(30_000) }),
      );
      if (res.ok) ok(`The service answered and accepted your key (${ms} ms).`);
      else if (res.status === 429) ok('The service answered but is limiting requests right now (429). Wait a minute.');
      else {
        failed = true;
        if (res.status === 401) bad('The service answered, but your key was not accepted (401). Check MODEL_API_KEY in .env.');
        else if (res.status === 403) bad('The service answered, but refused access (403). The key may not be allowed for this account or from this location.');
        else bad(`The service answered with an error (${res.status}). It may be having problems; try again later.`);
      }
    } catch (e) {
      bad(`Could not get an answer from the service: ${why(e)}.`);
      failed = true;
    }
  }

  console.log(failed ? '\nSomething above needs fixing before scans will work.\n' : '\nEverything works. If a scan still fails, start it again: the connection may have dropped for a moment.\n');
  process.exit(failed ? 1 : 0);
}

void main();
