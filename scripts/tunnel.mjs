/**
 * Puts the dev server behind a public HTTPS URL, and points the app at it.
 *
 *   node scripts/tunnel.mjs          # tunnels http://localhost:3000
 *   node scripts/tunnel.mjs 3001     # or another port
 *
 * Why a tunnel rather than a LAN address. Every QR this product mints encodes
 * `APP_BASE_URL` (packages/core/src/qr/code.ts), so with the default `http://localhost:3000` a
 * scanned code resolves to the *phone's* own localhost and shows nothing. The LAN address is no
 * better on this machine: the wifi is classified Public and Windows Firewall blocks inbound
 * node.exe there, so nothing outside reaches port 3000 at all. A tunnel dials outward, needs no
 * firewall change, and survives the laptop's IP changing.
 *
 * Setting APP_BASE_URL does two jobs at once: it fixes every QR producer, and it is also the
 * CSRF origin allowlist (apps/web/lib/csrf.ts), so the dashboard keeps working at the new host.
 *
 * The URL changes each run — this is a quick tunnel, with no Cloudflare account. Codes printed
 * from an earlier session stop resolving, which is exactly the situation a dynamic QR exists for:
 * a real deployment pins the host once and never moves it.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = process.argv[2] ?? '3000';
const ORIGIN = `http://localhost:${PORT}`;
const ENV_FILE = '.env';

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

console.log(`Opening a public tunnel to ${ORIGIN} ...\n`);

const child = spawn('cloudflared', ['tunnel', '--url', ORIGIN], {
  shell: process.platform === 'win32',
});

let claimed = false;

/**
 * cloudflared prints its progress, including the assigned hostname, on stderr. Both streams are
 * watched anyway: which one carries the banner is an implementation detail of a tool that is
 * upgraded independently of this repo.
 */
function watch(stream) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    process.stderr.write(chunk);
    if (claimed) return;

    const match = chunk.match(URL_PATTERN);
    if (match) {
      claimed = true;
      adopt(match[0]);
    }
  });
}

watch(child.stderr);
watch(child.stdout);

function adopt(url) {
  const updates = {
    APP_BASE_URL: url,
    API_BASE_URL: `${url}/api/v1`,
  };

  let env = readFileSync(ENV_FILE, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    // Rewrite in place when the key exists, so comments and ordering survive; append otherwise.
    env = new RegExp(`^${key}=.*$`, 'm').test(env)
      ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${env.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV_FILE, env);

  console.log('\n' + '='.repeat(72));
  console.log(`  Public URL   ${url}`);
  console.log(`  Written to   .env (APP_BASE_URL, API_BASE_URL)`);
  console.log('='.repeat(72));
  console.log('\n  Restart the dev server so it picks these up — env is read once at boot:');
  console.log('     pnpm --filter @ai-review/web dev\n');
  console.log('  Then every QR the dashboard shows or downloads points at this URL, and a');
  console.log('  phone anywhere can scan it. Leave this process running; closing it closes');
  console.log('  the tunnel and the URL is not reissued.\n');
  console.log('  This is a public address. Anyone with the link reaches the app.\n');
}

child.on('exit', (code) => {
  console.log(`\ncloudflared exited (${code}). The public URL is no longer served.`);
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill());
}
