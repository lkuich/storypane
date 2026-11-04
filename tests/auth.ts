import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Role = 'admin' | 'editor';
async function state(role: Role) {
  const path = process.env[`STORYPANE_TEST_${role.toUpperCase()}_STATE`];
  if (!path)
    throw new Error(
      `Set STORYPANE_TEST_${role.toUpperCase()}_STATE to a private Playwright storage state from an authenticated Clerk ${role}.`,
    );
  return JSON.parse(await readFile(path, 'utf8')) as Awaited<
    ReturnType<APIRequestContext['storageState']>
  >;
}
export async function signInPage(page: Page, role: Role = 'admin') {
  await page.context().addCookies((await state(role)).cookies);
  await page.goto('/?space=11111111-1111-4111-8111-111111111111');
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
}
export function authState(role: Role = 'admin') {
  const path = process.env[`STORYPANE_TEST_${role.toUpperCase()}_STATE`];
  if (!path) throw new Error(`Missing Clerk storage state for ${role}. See README.md.`);
  return path;
}
export async function signInApi(client: APIRequestContext, role: Role = 'admin') {
  const response = await client.get('/api/session');
  expect(response.ok(), `Clerk ${role} session is expired or unconfigured`).toBeTruthy();
}
