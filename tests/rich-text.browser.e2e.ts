import { expect, test, type Page } from '@playwright/test';

async function selection(page: Page) {
  return page.evaluate(() => {
    const current = window.getSelection()!;
    return {
      anchorText: current.anchorNode?.textContent,
      anchorOffset: current.anchorOffset,
      focusText: current.focusNode?.textContent,
      focusOffset: current.focusOffset,
      text: current.toString(),
    };
  });
}

for (const width of [390, 1440]) {
  test(`rich text retains the caret, selection, formatting and undo through autosave at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/rich-text.html');
    const editor = page.getByRole('textbox', { name: 'Body', exact: true });
    await expect(editor).toBeEditable();
    await expect(editor).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(editor.locator('p')).toHaveCSS('color', 'rgb(11, 18, 32)');
    await expect(page.getByRole('toolbar', { name: 'Body formatting', exact: true })).toHaveCSS(
      'background-color',
      'rgb(29, 37, 49)',
    );
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await editor.focus();
    await editor.evaluate((element) =>
      window.getSelection()!.setPosition(element.firstChild!.firstChild, 6),
    );
    await page.keyboard.type('new ');
    const caret = await selection(page);
    expect(caret.anchorOffset).toBe(10);
    await page.clock.runFor(600);
    await expect(page.getByLabel('Completed saves')).toHaveText('1');
    await expect(editor).toBeFocused();
    expect(await selection(page)).toEqual(caret);

    await page.keyboard.type('draft ');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    const selected = await selection(page);
    expect(selected.text).toBe('ft ');
    await page.clock.runFor(600);
    await expect(page.getByLabel('Completed saves')).toHaveText('2');
    expect(await selection(page)).toEqual(selected);
    await expect(editor.locator('h2 strong')).toHaveText('Formatted heading');
    await expect(editor.locator('h2 span')).toHaveCSS('color', 'rgb(18, 52, 86)');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.locator('p')).toHaveText('Alpha new bravo charlie.');
    await page.clock.runFor(600);
    await expect(page.getByLabel('Completed saves')).toHaveText('3');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.locator('p')).toHaveText('Alpha bravo charlie.');
    await page.clock.runFor(600);
    await expect(page.getByLabel('Completed saves')).toHaveText('4');

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Restore saved version' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(editor).toHaveText('Restored version');
    expect(errors).toEqual([]);
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`rich text remembers each box's background in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: colorScheme === 'light' ? 390 : 1440, height: 900 });
    await page.goto('/rich-text.html');
    const banner = page.getByRole('textbox', { name: 'Banner body' });
    const body = page.getByRole('textbox', { name: 'Body', exact: true });
    const toggle = page
      .getByRole('toolbar', { name: 'Banner body formatting' })
      .getByRole('button', { name: 'Dark background' });
    await expect(toggle).toHaveCSS('border-top-width', '1px');
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveCSS(
      'background-color',
      colorScheme === 'light' ? 'rgb(230, 248, 253)' : 'rgb(19, 56, 73)',
    );
    await expect(banner).toHaveCSS('background-color', 'rgb(25, 31, 41)');
    await expect(banner.getByText('White lettering', { exact: true })).toHaveCSS(
      'color',
      'rgb(255, 255, 255)',
    );
    await page.reload();
    await expect(banner).toHaveCSS('background-color', 'rgb(25, 31, 41)');
    await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await toggle.press('Enter');
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(banner).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });
}
