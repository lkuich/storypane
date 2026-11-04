import { expect, type APIRequestContext, type Page } from '@playwright/test'

type Role = 'admin' | 'editor'
async function backoff(headers: Record<string, string>) {
  const seconds = Number(headers['x-retry-after'] ?? headers['retry-after'] ?? 10)
  await new Promise(resolve => setTimeout(resolve, Math.max(1, seconds) * 1000 + 100))
}

export async function signInPage(page: Page, role: Role = 'admin') {
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(`${role}@blok.local`)
  await page.getByLabel('Password', { exact: true }).fill(`blok-local-${role}`)
  for (let attempt = 0; attempt < 3; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/auth/sign-in/email')),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])
    if (response.status() !== 429) { expect(response.status()).toBe(200); break }
    // The suite shares one IP; preserve production throttling and honor its retry window.
    await backoff(response.headers())
  }
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible()
  await page.goto('/?space=11111111-1111-4111-8111-111111111111')
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible()
}

export async function signInApi(client: APIRequestContext, role: Role = 'admin') {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await client.post('/api/auth/sign-in/email', { data: { email: `${role}@blok.local`, password: `blok-local-${role}` } })
    if (response.status() !== 429) { expect(response.ok(), await response.text()).toBeTruthy(); return }
    await backoff(response.headers())
  }
  throw new Error('Sign-in remained rate-limited after honoring three retry windows.')
}
