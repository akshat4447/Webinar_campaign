import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser } from '@playwright/test';

/** Capture evidence before finally closes a failing browser; the next run must not silently erase a failure. */
export async function captureBrowserFailure(browser: Browser | undefined, directory: string, error: unknown) {
  const out = `${directory}/failure-${Date.now()}`;
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/error.txt`, error instanceof Error ? error.stack || error.message : String(error));
  let index = 0;
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    const prefix = `${out}/page-${index++}`;
    await writeFile(`${prefix}.txt`, `URL: ${page.url()}\n\n${await page.locator('body').innerText().catch(() => '[page unavailable]')}`);
    await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => undefined);
  }
}
