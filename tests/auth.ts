import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dismissRecommendedSetup } from './fixtures/recommended-setup';

type Role = 'admin' | 'editor';
export const cmsOrigin = process.env.STORYPANE_LOCAL_AUTH_TEST_URL ?? 'http://127.0.0.1:3130';
export const cmsSpace =
  process.env.STORYPANE_TEST_SPACE_ID ?? '11111111-1111-4111-8111-111111111111';
async function state(role: Role) {
  const path = process.env[`STORYPANE_TEST_${role.toUpperCase()}_STATE`];
  if (!path)
    throw new Error(
      `Set STORYPANE_TEST_${role.toUpperCase()}_STATE to a private Playwright storage state from an authenticated ${role}.`,
    );
  return JSON.parse(await readFile(path, 'utf8')) as Awaited<
    ReturnType<APIRequestContext['storageState']>
  >;
}
export async function signInPage(page: Page, role: Role = 'admin') {
  await dismissRecommendedSetup(page);
  await page.context().addCookies((await state(role)).cookies);
  await page.goto(new URL(`/?space=${cmsSpace}`, cmsOrigin).href);
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
}
export function authState(role: Role = 'admin') {
  const path = process.env[`STORYPANE_TEST_${role.toUpperCase()}_STATE`];
  if (!path) throw new Error(`Missing storage state for ${role}. See README.md.`);
  return path;
}
export async function signInApi(client: APIRequestContext, role: Role = 'admin') {
  const response = await client.get('/api/session');
  expect(response.ok(), `${role} session is expired or unconfigured`).toBeTruthy();
}
