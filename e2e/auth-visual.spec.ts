import { expect, test } from '@playwright/test';

const AUTH_ROUTES = [
  { path: '/login', heading: 'Welcome back', title: 'Sign in | Ai Review' },
  { path: '/signup', heading: 'Create your account', title: 'Create your account | Ai Review' },
] as const;

test.describe('signed-out account screens', () => {
  test('uses the colorful split-screen story on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    for (const route of AUTH_ROUTES) {
      await page.goto(route.path);

      const heading = page.getByRole('heading', { level: 1, name: route.heading });
      const image = page.getByRole('img', {
        name: 'A friendly Ai robot holding a phone at a café table',
      });
      const story = page.getByRole('complementary', { name: 'Ai robot review story' });

      await expect(page).toHaveTitle(route.title);
      await expect(page.getByRole('link', { name: 'Ai Review home' })).toBeVisible();
      await expect(heading).toBeVisible();
      await expect(image).toBeVisible();
      await expect(page.getByText('Make every visit easier to put into words.')).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) =>
              element instanceof HTMLImageElement &&
              element.complete &&
              element.naturalWidth > 300 &&
              element.naturalHeight > 300,
          ),
        )
        .toBe(true);
      expect(
        decodeURIComponent(
          await image.evaluate((element) => (element as HTMLImageElement).currentSrc),
        ),
      ).toContain('/marketing/robot-reviewing-auth-v1.png');

      const positions = await Promise.all([image.boundingBox(), heading.boundingBox()]);
      expect(positions[0]).not.toBeNull();
      expect(positions[1]).not.toBeNull();
      expect(positions[0]!.x).toBeLessThan(positions[1]!.x);

      const desktopPanels = await page.evaluate(() => {
        const formPanel = document.querySelector('form')?.closest('section');
        const mediaPanel = document.querySelector('aside');
        const callout = document.querySelector<HTMLElement>(
          '[data-motion-accent="auth-review-card"]',
        );
        if (!formPanel || !mediaPanel || !callout) return null;
        const form = formPanel.getBoundingClientRect();
        const media = mediaPanel.getBoundingClientRect();
        const card = callout.getBoundingClientRect();
        return {
          form: { left: form.left },
          media: { left: media.left, right: media.right, bottom: media.bottom },
          card: { left: card.left, right: card.right, bottom: card.bottom },
        };
      });
      expect(desktopPanels).not.toBeNull();
      expect(desktopPanels!.media.right).toBeLessThanOrEqual(desktopPanels!.form.left + 1);
      expect(desktopPanels!.card.left).toBeGreaterThanOrEqual(desktopPanels!.media.left);
      expect(desktopPanels!.card.right).toBeLessThanOrEqual(desktopPanels!.media.right);
      expect(desktopPanels!.card.bottom).toBeLessThanOrEqual(desktopPanels!.media.bottom);

      const rail = await story
        .locator('[data-auth-color-rail]')
        .evaluate((element) => window.getComputedStyle(element, '::after').backgroundImage);
      expect(rail).toMatch(/rgb\(66, 133, 244\)/);
      expect(rail).toMatch(/rgb\(234, 67, 53\)/);
      expect(rail).toMatch(/rgb\(251, 188, 5\)/);
      expect(rail).toMatch(/rgb\(52, 168, 83\)/);
    }

    const loadedCss = await page.evaluate(() =>
      Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
        .join('\n'),
    );
    expect(loadedCss).not.toMatch(/#(?:5145ee|7c3aed|b14ce5|5546f2|8b48f6|6b3df1)/i);
  });

  test('puts the form first and keeps every control usable on phones', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 760 });

      for (const route of AUTH_ROUTES) {
        await page.goto(route.path);

        // The illustration is desktop-only: AuthShell.module.css drops `.mediaPanel` to
        // `display: none` at 1050px and again at 768px, and the four Google colours it carried
        // move onto the form panel's ::before rail. e2e/auth-responsive.spec.ts asserts the
        // same rule. The assertions this replaces waited for an image that is deliberately
        // not rendered at phone widths.
        const heading = page.getByRole('heading', { level: 1, name: route.heading });
        await expect(heading).toBeVisible();
        await expect(page.locator('aside[aria-label="Ai robot review story"]')).toBeHidden();

        const email = page.getByLabel('Email');
        const submit = page.getByRole('button', {
          name: route.path === '/login' ? 'Sign in' : 'Create account',
        });
        await expect(email).toBeVisible();
        await expect(submit).toBeVisible();
        expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);

        const geometry = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controls: Array.from(document.querySelectorAll<HTMLElement>('input, button, a')).map(
            (element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right };
            },
          ),
        }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
        for (const control of geometry.controls) {
          expect(control.left).toBeGreaterThanOrEqual(0);
          expect(control.right).toBeLessThanOrEqual(geometry.clientWidth);
        }

        // Nothing here asserted the form's order against the media panel any more: the panel is
        // hidden at these widths, so it returns an all-zero rect and the comparison was
        // meaningless. The 44px touch-target and no-horizontal-overflow checks below are the
        // part of this test that still proves something about the phone layout.
      }
    }
  });

  test('styles the forms as first-class product screens', async ({ page }) => {
    await page.goto('/login');

    const email = page.getByLabel('Email');
    const submit = page.getByRole('button', { name: 'Sign in' });
    await expect(email).toBeVisible();
    await expect(submit).toBeVisible();
    await email.focus();
    await expect(email).toBeFocused();
    const focusStyle = await email.evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: getComputedStyle(element).outlineWidth,
      color: getComputedStyle(element).outlineColor,
    }));
    expect(focusStyle.style).toBe('solid');
    expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);
    expect(focusStyle.color).toBe('rgb(25, 103, 210)');
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    );

    const dimensions = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[name="email"]');
      const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!input || !button) return null;
      return {
        inputHeight: input.getBoundingClientRect().height,
        inputRadius: getComputedStyle(input).borderRadius,
        buttonHeight: button.getBoundingClientRect().height,
        buttonRadius: getComputedStyle(button).borderRadius,
      };
    });
    expect(dimensions).not.toBeNull();
    expect(dimensions!.inputHeight).toBeGreaterThanOrEqual(56);
    expect(dimensions!.buttonHeight).toBeGreaterThanOrEqual(58);
    expect(Number.parseFloat(dimensions!.inputRadius)).toBeGreaterThanOrEqual(10);
    expect(Number.parseFloat(dimensions!.buttonRadius)).toBeGreaterThanOrEqual(10);

    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    await expect(page.getByText('I accept the terms of service and privacy policy')).toBeVisible();
  });

  test('disables the decorative auth motion for reduced-motion visitors', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/login');

    const motion = page.locator('[data-motion-accent]');
    const normalNames = await motion.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).animationName),
    );
    expect(normalNames.length).toBeGreaterThan(0);
    expect(normalNames.every((name) => name !== 'none')).toBe(true);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedNames = await motion.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).animationName),
    );
    expect(reducedNames.every((name) => name === 'none')).toBe(true);
  });

  test('keeps password recovery screens inside the same responsive shell', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });

    for (const route of [
      { path: '/forgot-password', heading: 'Reset your password' },
      { path: '/reset-password', heading: 'This link is incomplete' },
    ]) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      // Same shell, minus the desktop-only illustration: the brand links stay reachable and the
      // form panel carries the four-colour Google rail that the media canvas carries on desktop.
      await expect(page.locator('aside[aria-label="Ai robot review story"]')).toBeHidden();
      await expect(page.getByRole('link', { name: 'Ai Review home' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to website' })).toBeVisible();
      const rail = await page
        .locator('main > section')
        .first()
        .evaluate((element) => getComputedStyle(element, '::before').backgroundImage);
      expect(rail).toMatch(/rgb\(66, 133, 244\)/);
      expect(rail).toMatch(/rgb\(52, 168, 83\)/);
      const width = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
  });
});
