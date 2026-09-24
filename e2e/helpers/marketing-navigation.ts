import { expect, type Page } from '@playwright/test';

export async function revealMarketingNavigation(page: Page) {
  const toggle = page.getByRole('banner').getByRole('button', { name: /navigation menu$/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  const navigation = page.locator('#marketing-navigation');
  await expect(navigation).toBeVisible();
  return navigation;
}
