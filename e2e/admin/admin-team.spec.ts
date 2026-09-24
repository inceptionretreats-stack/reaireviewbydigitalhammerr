import { expect, test } from '@playwright/test';
import { closeDb, deleteUsersByEmailPrefix, demoBusinessId } from '../support/db';
import { E2E_ADMIN_TOTP_SECRET, freshTotpCode, signInAdmin } from '../support/totp';

/**
 * AMENDMENT-027 — the admin team, end to end: an admin invites a support viewer from the
 * screen (reason required), the invitation link sets a password and forces authenticator
 * enrolment, and the viewer then sees only what 05_RBAC allows — no settings, no prompts, no
 * team, and every mutation refused at the API.
 */

const RUN = Date.now().toString(36);
const VIEWER = { email: `team-viewer-${RUN}@example.test`, password: 'viewer-Password-12345' };

test.describe('admin team', () => {
  test.afterAll(async () => {
    await deleteUsersByEmailPrefix('team-viewer-');
    await closeDb();
  });

  test('invite a support viewer, accept, enrol, and be limited to read-only', async ({
    page,
    browser,
  }) => {
    await signInAdmin(page, {
      email: 'demo-admin@example.com',
      password: 'demo-admin-Password1!',
      totpSecret: E2E_ADMIN_TOTP_SECRET,
    });
    await page.goto('/admin/team');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Team');
    await expect(page.getByText('demo-admin@example.com')).toBeVisible();

    await page.getByRole('button', { name: /invite admin/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^email/i).fill(VIEWER.email);
    await dialog.getByLabel(/^name/i).fill('Support Viewer');
    await dialog.getByLabel(/^role/i).selectOption('BUSINESS_SUPPORT_VIEWER');
    const send = dialog.getByRole('button', { name: /send invitation/i });
    await expect(send).toBeDisabled();
    await dialog.getByLabel(/^reason/i).fill('New support hire — E2E');
    await send.click();

    // No mail provider locally: the link is shown to the admin to pass on.
    const linkUrl = new URL((await dialog.locator('code').innerText()).trim());
    expect(linkUrl.pathname).toBe('/invite');
    expect(linkUrl.searchParams.get('token')).toBeTruthy();
    // The link carries APP_BASE_URL (the tunnel); the suite drives the same server at its own
    // base URL, so only the path and token are kept.
    const link = linkUrl.pathname + linkUrl.search;
    await dialog.getByRole('button', { name: /^done$/i }).click();
    await expect(page.getByText(VIEWER.email)).toBeVisible();

    // The invitee, in their own browser.
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await viewer.goto(link);
    await expect(viewer.getByRole('heading', { name: /join the admin team/i })).toBeVisible();
    await viewer.waitForLoadState('networkidle');
    await viewer.getByLabel(/password/i).fill(VIEWER.password);
    await viewer.getByRole('button', { name: /^continue$/i }).click();
    await expect(viewer).toHaveURL(/\/login\/mfa\/enrol$/);

    const manualKey = (await viewer.getByTestId('mfa-manual-key').innerText()).replace(/\s/g, '');
    await viewer.getByLabel(/code from the app/i).fill(await freshTotpCode(manualKey));
    await viewer.getByRole('button', { name: /turn on/i }).click();
    await viewer.getByRole('checkbox', { name: /stored these/i }).check();
    await viewer.getByRole('button', { name: /continue to admin/i }).click();
    await expect(viewer).toHaveURL(/\/admin$/);

    // Read-only: the nav offers no settings/prompts/team, the pages redirect, the API refuses.
    const nav = viewer.getByRole('navigation', { name: 'Admin' });
    await expect(nav.getByRole('link', { name: 'Businesses' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Platform settings' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Ai prompts' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
    await viewer.goto('/admin/settings');
    await expect(viewer).toHaveURL(/\/admin$/);
    await viewer.goto('/admin/businesses');
    await expect(viewer.getByRole('heading', { level: 1 })).toContainText(/businesses/i);

    const origin = new URL(viewer.url()).origin;
    const businessId = await demoBusinessId();
    const read = await viewer.request.get(`/api/v1/admin/businesses/${businessId}`);
    expect(read.status()).toBe(200);
    const write = await viewer.request.patch(`/api/v1/admin/businesses/${businessId}`, {
      headers: { origin },
      data: { action: 'reset_free_usage', reason: 'viewer should not be able to' },
    });
    expect(write.status()).toBe(403);
    const team = await viewer.request.get('/api/v1/admin/team');
    expect(team.status()).toBe(403);

    // The invitation is single-use: the same link answers with the expired message.
    const again = await viewerContext.newPage();
    await again.goto(link);
    // Wait for hydration: a click before it would submit the form natively.
    await again.waitForLoadState('networkidle');
    await again.getByLabel(/password/i).fill(VIEWER.password);
    await again.getByRole('button', { name: /^continue$/i }).click();
    await expect(again.getByText(/expired or was already used/i)).toBeVisible();
    await viewerContext.close();

    // Back as the admin: the member is listed, and disabling them (with a reason) signs them out.
    await page.goto('/admin/team');
    const row = page.getByRole('row').filter({ hasText: VIEWER.email });
    await expect(row.getByText(/enrolled/i)).toBeVisible();
    await row.getByRole('button', { name: /^disable$/i }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/^reason/i)
      .fill('Contract ended — E2E');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /disable account/i })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await expect(row.getByText('Disabled')).toBeVisible();
  });
});
