/**
 * Creates or updates a platform admin (SUPER_ADMIN) account.
 *
 *   node --env-file=.env scripts/create-admin.mjs --email you@example.com --password 'a strong one'
 *   node --env-file=.env scripts/create-admin.mjs --email you@example.com --password '...' --name "Your Name"
 *
 * Until this existed there was no way to get an admin login at all: the seed creates
 * demo-admin@example.com with an unusable password unless SEED_ADMIN_PASSWORD is set, and it
 * refuses to run in production. This is the operator's tool, and it is deliberately narrow — it
 * sets the role, the name and the password of one account and writes an audit row saying so
 * (`user.role.change`, a high-risk action, so it requires a reason). It creates no business.
 *
 * The password is hashed the way the application hashes it — same algorithm, same pepper from
 * HASH_PEPPER — so the login form accepts it. Run it with the same .env the app runs with.
 *
 * MFA is mandatory for admin accounts in 19_Admin_Panel_Spec and is not built yet (E13). Until
 * it is, do not create an admin account on a deployment reachable from the public internet.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { PasswordHasher, validatePasswordStrength } from '@ai-review/core';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const email = opt('email')?.trim().toLowerCase();
const password = opt('password');
const fullName = opt('name')?.trim() || 'Platform admin';
const reason =
  opt('reason')?.trim() || 'Platform admin account created with scripts/create-admin.mjs';

if (!email || !password) {
  console.error(
    'Usage: node --env-file=.env scripts/create-admin.mjs --email <email> --password <password> [--name <name>]',
  );
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('That does not look like an email address.');
  process.exit(1);
}
const strength = validatePasswordStrength(password);
if (!strength.ok) {
  console.error(`Password rejected by the product's own rules: ${strength.reason}`);
  process.exit(1);
}
const { DATABASE_URL, HASH_PEPPER, NODE_ENV } = process.env;
if (!DATABASE_URL || !HASH_PEPPER) {
  console.error('DATABASE_URL and HASH_PEPPER are required — run with --env-file=.env.');
  process.exit(1);
}
if (NODE_ENV === 'production') {
  console.error(
    'Refusing in production: admin MFA (19_Admin_Panel_Spec) is not built yet, and an admin\n' +
      'account without it must not exist on a public deployment. Set NODE_ENV to something else\n' +
      'only if this database is not reachable from the internet.',
  );
  process.exit(2);
}

const passwordHash = await new PasswordHasher({ pepper: HASH_PEPPER }).hash(password);
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const { rows: existing } = await client.query(
    'SELECT id, role FROM users WHERE email = $1 FOR UPDATE',
    [email],
  );
  let userId;
  let before = null;
  if (existing[0]) {
    userId = existing[0].id;
    before = { role: existing[0].role };
    await client.query(
      `UPDATE users SET role = 'SUPER_ADMIN', full_name = $2, password_hash = $3,
              email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
        WHERE id = $1`,
      [userId, fullName, passwordHash],
    );
  } else {
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, 'SUPER_ADMIN', now()) RETURNING id`,
      [email, fullName, passwordHash],
    );
    userId = rows[0].id;
  }
  // Self-attributed: there is no other admin to attribute a first admin to, and an unattributed
  // role change is worse than a self-attributed one. The row still says what happened and why.
  await client.query(
    `INSERT INTO admin_audit_logs (actor_user_id, action, reason, target_type, target_id, before_state, after_state)
     VALUES ($1, 'user.role.change', $2, 'user', $3, $4, $5)`,
    [
      userId,
      reason,
      userId,
      before ? JSON.stringify(before) : null,
      JSON.stringify({ role: 'SUPER_ADMIN' }),
    ],
  );
  await client.query('COMMIT');
  console.log(`\n  ${existing[0] ? 'Updated' : 'Created'} admin ${email}`);
  console.log('  Sign in at /login — an admin lands on /admin.');
  console.log(
    `  Password fingerprint (not the password): ${createHash('sha256').update(password).digest('hex').slice(0, 8)}\n`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
