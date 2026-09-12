/**
 * Brings the whole local stack up, detached, and prints the public link.
 *
 *   pnpm dev:up            database → tunnel → web server, each as its own process
 *   pnpm dev:up --status   what is running and at which address
 *   pnpm dev:up --restart-web   restart only the server, e.g. after editing .env (env is read at boot)
 *   pnpm dev:down          stop everything this script started
 *
 * Why this exists. The three processes used to be children of whichever terminal or agent
 * session started them, and died with it — the public link went dead, every printed QR pointed
 * at a dead host, and nobody noticed until a phone showed nothing. Here each one is started
 * detached, with its own log under .dev/, and this script exits immediately. They keep running
 * until `dev:down`, a reboot, or the tunnel's remote end drops.
 *
 * Order matters: the tunnel is opened before the server, because the assigned URL is written
 * into .env as APP_BASE_URL and the server reads its environment once at boot. Start them the
 * other way round and every QR the server mints encodes the previous session's dead address.
 *
 * The last step warms the routes a customer or owner hits first. `next dev` compiles on first
 * request, and the first real generation after a start was measured at 8.4 s — past the 8 s
 * provider budget — for that reason alone. A warm route answers in the time the model takes.
 *
 * This runs the DEV server on purpose, not `next start`. A production build passes (and is
 * checked by `pnpm build`), but production mode also switches off the landing-page demo QR and
 * the console mail transport — the two things a local demo relies on. Deployment is E13.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.dev');
const STATE_FILE = join(STATE_DIR, 'state.json');
const ENV_FILE = join(ROOT, '.env');
const PORT = 3000;
/** Two independent public resolvers, alternated by nextResolver(); see the tunnel step. */
const RESOLVERS = ['https://1.1.1.1/dns-query', 'https://dns.google/resolve'];
let resolverIndex = 0;
const TUNNEL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const args = new Set(process.argv.slice(2));
mkdirSync(STATE_DIR, { recursive: true });

if (args.has('--status')) {
  await status();
  process.exit(0);
}

const state = readState();

// 1. Database — only if nothing is already listening; a surviving cluster is reused, not doubled.
if (await listening(5432)) {
  log('database', 'already listening on :5432');
} else {
  state.db = detach('database', process.execPath, [join(ROOT, 'scripts', 'dev-db.mjs'), 'start']);
  await waitFor(() => listening(5432), 60_000, 'PostgreSQL to listen on :5432');
  log('database', `started (pid ${state.db})`);
}

// 2. Tunnel.
//
// The trap here is DNS, and it cost a whole link once. cloudflared prints the hostname a few
// seconds before Cloudflare publishes its record. Ask the local resolver for it in that window
// and the answer is "no such host" — which the wifi router then caches for trycloudflare.com's
// negative TTL of thirty minutes. Every phone on that network is locked out of the link for half
// an hour, and nothing on this machine can tell, because nslookup goes around the cache.
//
// So no local lookup happens until Cloudflare's own DNS-over-HTTPS resolver (a fixed IP, no
// local resolver involved) says the record exists. Only then is the hostname resolved the way
// a phone would. If the resolver still says no — a leftover negative entry from before this
// guard existed — the tunnel is discarded for a fresh hostname rather than handed out broken.
// A recorded pid that is no longer running (a reboot, a crash) must be forgotten here, or the
// start loop below — guarded on there being no tunnel — never runs and the old dead address is
// handed out again.
if (state.tunnel && !alive(state.tunnel)) state.tunnel = undefined;
if (state.tunnel) {
  const current = envValue('APP_BASE_URL');
  if (current && (await routes(current))) {
    log('tunnel', `already up at ${current} (pid ${state.tunnel})`);
  } else {
    kill(state.tunnel);
    state.tunnel = undefined;
  }
}
for (let attempt = 1; !state.tunnel; attempt += 1) {
  const before = envValue('APP_BASE_URL');
  writeFileSync(join(STATE_DIR, 'tunnel.log'), '');
  writeFileSync(join(STATE_DIR, 'tunnel.err.log'), '');
  const pid = detach('tunnel', process.execPath, [join(ROOT, 'scripts', 'tunnel.mjs')]);
  await waitFor(
    () => {
      const now = envValue('APP_BASE_URL');
      return Promise.resolve(!!now && TUNNEL_PATTERN.test(now) && now !== before);
    },
    60_000,
    'cloudflared to assign a public URL',
  );
  const url = envValue('APP_BASE_URL');
  const host = new URL(url).hostname;

  // The edge has the tunnel once cloudflared says so; DNS follows a few seconds later. No
  // resolver anywhere is asked about the name until then — a question asked too early is a
  // "no" that every cache on the path remembers, the machine's for minutes, the router's and a
  // public resolver's for up to half an hour.
  const registered = await poll(() => tunnelRegistered(), 45_000);
  if (registered) await sleep(8_000);
  const published =
    registered && (await poll(() => publishedInDns(host, nextResolver()), 120_000, 2_500));
  // One more beat, then the machine's own resolver asks — and gets a yes to cache.
  if (published) await sleep(3_000);
  const routed =
    published &&
    (await poll(async () => (await routes(url)) || (flushLocalDns(), false), 45_000, 3_000));

  if (routed) {
    state.tunnel = pid;
    log('tunnel', `${url} (pid ${pid})`);
  } else {
    const why = !registered
      ? 'never registered with the edge'
      : !published
        ? 'was not published in DNS in time'
        : 'resolves at Cloudflare but not on this network — a cached negative answer';
    log('tunnel', `${host} ${why}. Discarding it for a fresh hostname.`);
    kill(pid);
    if (attempt >= 3) {
      console.error('\nThree hostnames in a row could not be brought up. See .dev/tunnel.log.');
      process.exit(1);
    }
  }
}

// 3. Web server — restarted whenever the tunnel URL changed, because env is read at boot.
if (state.web && !alive(state.web)) state.web = undefined;
if (!args.has('--restart-web') && state.web && state.webBaseUrl === envValue('APP_BASE_URL')) {
  log('web', `already running for ${state.webBaseUrl} (pid ${state.web})`);
} else {
  if (state.web) kill(state.web);
  await waitFor(async () => !(await listening(PORT)), 15_000, `port ${PORT} to free`);
  const nextBin = join(ROOT, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next');
  state.web = detach('web', process.execPath, [nextBin, 'dev'], join(ROOT, 'apps', 'web'));
  state.webBaseUrl = envValue('APP_BASE_URL');
  await waitFor(() => httpOk(`http://localhost:${PORT}/`), 120_000, 'the web server to answer');
  log('web', `started (pid ${state.web})`);
}
writeState(state);

// 4. Warm the routes a first visitor hits, so the first customer never pays a cold compile.
const base = `http://localhost:${PORT}`;
const demoCode = await demoQrCode();
const warm = [
  ['GET', '/'],
  ['GET', '/login'],
  ['GET', '/signup'],
  demoCode ? ['GET', `/r/${demoCode}`] : null,
  // An empty body is rejected before any model call, which compiles the route for free.
  ['POST', '/api/v1/public/review/generate'],
  ['POST', '/api/v1/public/events'],
  ['GET', '/app'],
].filter(Boolean);
for (const [method, path] of warm) {
  const started = Date.now();
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
    redirect: 'manual',
  }).catch(() => null);
  log('warm', `${method} ${path} → ${res?.status ?? 'no response'} in ${Date.now() - started}ms`);
}

// 5. "Live" means reachable from outside, not merely assigned. A fresh quick tunnel's hostname
// takes a few seconds to route at Cloudflare's edge; the first request through it used to be
// swallowed, and the customer who sent it saw nothing. Wait until the public address answers.
const publicUrl = envValue('APP_BASE_URL');
await waitFor(() => reachable(publicUrl), 90_000, `${publicUrl} to route from the public internet`);
log('public', `${publicUrl} answers`);

console.log(`\n${'='.repeat(72)}`);
console.log(`  Live at   ${envValue('APP_BASE_URL')}`);
console.log(`  Logs      ${STATE_DIR}\\{database,tunnel,web}.log and .err.log`);
console.log(`  Stop      pnpm dev:down`);
console.log(`${'='.repeat(72)}\n`);
console.log('  These processes keep running after this terminal closes.');
console.log('  The link changes each time the tunnel restarts; codes printed under an old');
console.log('  link stop resolving. That is the situation a dynamic QR exists for — a real');
console.log('  deployment pins the host once.\n');

// ---------------------------------------------------------------------------------------------

function detach(name, command, argv, cwd = ROOT) {
  const log = join(STATE_DIR, `${name}.log`);

  if (process.platform === 'win32') {
    // Node's `detached` gives the child its own process group but NOT its own console. Any
    // Ctrl+C or Ctrl+Break delivered to this terminal's console — which is what an agent
    // session or a closing terminal sends on the way out — reached the tunnel, the server and
    // postgres alike; cloudflared's exit code 0xC000013A (STATUS_CONTROL_C_EXIT) said so. A
    // process started through Start-Process gets a console of its own, hidden, that nobody
    // else writes to. The pid comes back through -PassThru.
    const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
    // Start-Process joins ArgumentList with spaces and quotes nothing; a path with a space in
    // it (this project lives under "digital hammerr") arrives as two arguments unless each
    // one is wrapped in its own double quotes first.
    const quoteArg = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
    // The pid travels through a file, and PowerShell gets no pipes at all. Handed a pipe,
    // Start-Process's child inherits it, and spawnSync then waits for an end-of-file that never
    // comes — the launcher was gone, the child was holding the pipe open, and this script hung.
    const pidFile = join(STATE_DIR, `${name}.pid`);
    try {
      unlinkSync(pidFile);
    } catch {
      // nothing to clear
    }
    const script =
      `$p = Start-Process -FilePath ${q(command)} -ArgumentList @(${argv.map(quoteArg).map(q).join(', ')}) ` +
      `-WorkingDirectory ${q(cwd)} -WindowStyle Hidden ` +
      `-RedirectStandardOutput ${q(log)} -RedirectStandardError ${q(log.replace(/.log$/, '.err.log'))} ` +
      `-PassThru; Set-Content -Path ${q(pidFile)} -Value $p.Id`;
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    let pid = NaN;
    for (let i = 0; i < 20 && !Number.isInteger(pid); i += 1) {
      try {
        pid = Number(readFileSync(pidFile, 'utf8').trim());
      } catch {
        spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},250)']);
      }
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      console.error(`
Could not start ${name} (powershell exit ${result.status}). See ${log}.`);
      process.exit(1);
    }
    return pid;
  }

  const out = openSync(log, 'a');
  const child = spawn(command, argv, {
    cwd,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  return child.pid;
}

function kill(pid) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function httpOk(url) {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

/** The public page answers 200 through the edge — the check a customer's phone performs. */
async function reachable(url) {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    return res.status > 0 && res.status < 500 && res.status !== 404;
  } catch {
    return false;
  }
}

/**
 * Any HTTP answer at all through the edge, even a 502 with no server behind it yet: DNS resolved
 * locally, TLS completed, Cloudflare routed the hostname. Used before the web server is up.
 */
async function routes(url) {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

/**
 * Asks Cloudflare's resolver directly, over HTTPS to a fixed address, whether the record exists.
 * Nothing here touches the machine's resolver or the router, so it cannot poison either.
 */
async function publishedInDns(host, resolver) {
  try {
    const res = await fetch(`${resolver}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body.Status === 0 && Array.isArray(body.Answer) && body.Answer.length > 0;
  } catch {
    return false;
  }
}

/** Clears Windows' own resolver cache. The router's cache is beyond reach; see the tunnel step. */
function flushLocalDns() {
  if (process.platform !== 'win32') return;
  spawn('ipconfig', ['/flushdns'], { stdio: 'ignore', windowsHide: true });
}

/** Like waitFor, but reports rather than exits — for steps that have a fallback. */
async function poll(check, timeoutMs, everyMs = 750) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(everyMs);
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** cloudflared logs one of these per connection once the edge has the tunnel. */
function tunnelRegistered() {
  // cloudflared writes its progress to stderr, which lands in the .err.log; both are read.
  return ['tunnel.log', 'tunnel.err.log'].some((file) => {
    try {
      return /Registered tunnel connection/.test(
        readFileSync(join(STATE_DIR, file), 'utf8').slice(-20_000),
      );
    } catch {
      return false;
    }
  });
}

/**
 * Two independent public resolvers, alternated. A negative answer cached by one while the
 * record was still propagating does not block the check; the other one gets asked next.
 */
function nextResolver() {
  resolverIndex = (resolverIndex + 1) % RESOLVERS.length;
  return RESOLVERS[resolverIndex];
}

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 750));
  }
  console.error(`\nTimed out waiting for ${what}. See ${STATE_DIR} for logs.`);
  process.exit(1);
}

function envValue(key) {
  if (!existsSync(ENV_FILE)) return undefined;
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(ENV_FILE, 'utf8'));
  return match?.[1]?.trim() || undefined;
}

async function demoQrCode() {
  // The demo tenant's first QR, read from the database so the warm-up compiles the real page.
  // Best effort: no database access here means no warm-up for that route, nothing worse.
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: envValue('DATABASE_URL') });
    await client.connect();
    const { rows } = await client.query(
      `SELECT q.code FROM qr_codes q JOIN businesses b ON b.id = q.business_id
       WHERE b.name = 'Demo South Cafe' AND q.status = 'ACTIVE' ORDER BY q.created_at LIMIT 1`,
    );
    await client.end();
    return rows[0]?.code ?? null;
  } catch {
    return null;
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(next) {
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + '\n');
}

function log(name, message) {
  console.log(`  ${name.padEnd(9)} ${message}`);
}

async function status() {
  const s = readState();
  const row = (name, pid, extra = '') =>
    console.log(
      `  ${name.padEnd(9)} ${pid && alive(pid) ? `running (pid ${pid})` : 'not running'} ${extra}`,
    );
  row('database', s.db, (await listening(5432)) ? ':5432 listening' : ':5432 closed');
  row('tunnel', s.tunnel, envValue('APP_BASE_URL') ?? '');
  row('web', s.web, (await listening(PORT)) ? `:${PORT} listening` : `:${PORT} closed`);
}
