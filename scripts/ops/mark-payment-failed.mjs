/**
 * Operator tool (AMENDMENT-029): close abandoned checkouts (CREATED/AUTHORIZED) as FAILED
 * through `PaymentAdminService.markFailed`, as the SYSTEM actor, audited with the reason.
 *
 *   DATABASE_URL=<unpooled> node node_modules/tsx/dist/cli.mjs scripts/ops/mark-payment-failed.mjs \
 *     --reason '…' <payments.id> [<payments.id> …]
 */
import { createDatabase } from '@ai-review/db';
import { PaymentAdminService, SYSTEM_ACTOR } from '@ai-review/core';

const argv = process.argv.slice(2);
const at = argv.indexOf('--reason');
const reason = at >= 0 ? argv[at + 1] : undefined;
const ids = argv.filter((a, i) => i !== at && i !== at + 1);
if (!reason || ids.length === 0 || !process.env.DATABASE_URL) {
  console.error('Need DATABASE_URL, --reason, and at least one payment id.');
  process.exit(2);
}
const db = createDatabase({ connectionString: process.env.DATABASE_URL, poolMax: 2 });
try {
  const service = new PaymentAdminService(db);
  for (const id of ids) {
    const payment = await service.markFailed(id, { actor: SYSTEM_ACTOR, reason });
    console.log(id, '→', payment.status);
  }
} finally {
  await db.$client.end();
}
