import { expect, test } from '@playwright/test';

const FLOW_ID = 'a'.repeat(32);

test.describe('Google vendor account completion', () => {
  test('asks a new vendor for mobile and terms before the usual business setup', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/google/pending', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'vendor@example.com',
          fullName: 'Example Vendor',
          flow: 'signup',
          flowId: FLOW_ID,
        }),
      });
    });

    let completionBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/auth/google/complete', async (route) => {
      completionBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Check the details.',
            details: { fields: ['mobile'] },
          },
        }),
      });
    });

    await page.goto('/signup/google');
    await expect(page.getByRole('heading', { name: 'Finish creating your account' })).toBeVisible();
    await expect(page.getByText('vendor@example.com')).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveValue('Example Vendor');

    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Continue to business setup' }).click();
    await expect(page.getByText('Please accept the terms to continue.')).toBeVisible();
    expect(completionBody).toBeNull();

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue to business setup' }).click();
    await expect(page.getByText('Check the details.')).toBeVisible();
    expect(completionBody).toEqual({
      flow_id: FLOW_ID,
      full_name: 'Example Vendor',
      mobile: '9876543210',
      accept_terms: true,
    });
  });

  test('requires the existing account password before linking Google', async ({ page }) => {
    await page.route('**/api/v1/auth/google/pending', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'existing@example.com',
          fullName: 'Existing Vendor',
          flow: 'link',
          flowId: FLOW_ID,
        }),
      });
    });

    await page.route('**/api/v1/auth/google/link', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: 'That password is not correct.',
            details: { fields: ['password'] },
          },
        }),
      });
    });

    await page.goto('/signup/google');
    await expect(
      page.getByRole('heading', { name: 'Connect your existing account' }),
    ).toBeVisible();
    await expect(page.getByText('existing@example.com')).toBeVisible();
    await expect(page.getByLabel('Existing account password')).toBeVisible();
    await expect(page.getByLabel('Mobile number')).toHaveCount(0);
    await page.getByLabel('Existing account password').fill('wrong-password');
    await page.getByRole('button', { name: 'Connect Google and sign in' }).click();
    await expect(page.getByText('That password is not correct.')).toBeVisible();
  });
});
