/**
 * Stops everything `pnpm dev:up` started. The counterpart to dev-up.mjs; see its docblock.
 *
 * Kills by recorded pid first, then by what is actually holding the ports and the cloudflared
 * process name, so a stale or missing state file cannot leave anything running. PostgreSQL is
 * the exception: it detaches from the process that launched it, so it is asked to stop through
 * pg_ctl — a clean, fast shutdown — and the outcome is reported as it is, not as intended.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = join(ROOT, '.dev', 'state.json');

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};

for (const [name, pid] of [
  ['web', state.web],
  ['tunnel', state.tunnel],
]) {
  if (!pid) continue;
  kill(pid);
  console.log(`  ${name.padEnd(9)} stopped (pid ${pid})`);
}

if (process.platform === 'win32') {
  // Anything the state file did not know about: the web port, and cloudflared by name.
  const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? '';
  for (const line of netstat.split('\n')) {
    const match = /:3000\s+\S+\s+LISTENING\s+(\d+)/.exec(line);
    if (match) {
      kill(Number(match[1]));
      console.log(`  web       stopped stray listener on :3000 (pid ${match[1]})`);
    }
  }
  spawnSync('taskkill', ['/IM', 'cloudflared.exe', '/F'], { stdio: 'ignore', windowsHide: true });
}

if (await listening(5432)) {
  const pgCtl = findPgCtl();
  if (pgCtl) {
    spawnSync(pgCtl, ['-D', join(ROOT, '.pgdata'), 'stop', '-m', 'fast', '-t', '20'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
  // The launcher process goes after the server it launched, never before: killing it first
  // orphans postgres.exe, which then ignores everything but pg_ctl.
  if (state.db) kill(state.db);
  const stopped = !(await listening(5432));
  console.log(
    stopped
      ? '  database  stopped cleanly; its data in .pgdata/ is kept'
      : '  database  is STILL listening on :5432 — stop it by hand: pg_ctl -D .pgdata stop',
  );
} else {
  if (state.db) kill(state.db);
  console.log('  database  was not running; its data in .pgdata/ is kept');
}

if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);

function kill(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function findPgCtl() {
  const store = join(ROOT, 'node_modules', '.pnpm');
  try {
    const dir = readdirSync(store).find((name) =>
      name.startsWith('@embedded-postgres+windows-x64@'),
    );
    if (!dir) return null;
    const bin = join(
      store,
      dir,
      'node_modules',
      '@embedded-postgres',
      'windows-x64',
      'native',
      'bin',
      'pg_ctl.exe',
    );
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
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
