import { signInPage } from './auth'
import { expect, test, type APIRequestContext } from '@playwright/test'
import type { BlockDefinition, Command, CommitResult, Lease, LocaleSnapshot, Story, StoryLocale, SpaceLocale } from '@storypane/core'

const origin = 'http://127.0.0.1:3130'
async function json<T>(request: APIRequestContext, path: string, body?: unknown): Promise<T> {
  const response = body === undefined ? await request.get(`/api/cms${path}`) : await request.post(`/api/cms${path}`, { headers: { Origin: origin }, data: body })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as T
}

test('uncertain imports retry once and inserted blocks recover across reload without duplication', async ({ page }) => {
  test.setTimeout(90_000)
  await signInPage(page)
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible()

  const definitions = await json<BlockDefinition[]>(page.request, '/definitions')
  const story = await json<Story>(page.request, '/stories', { name: `Recovery check ${Date.now()}`, slug: `recovery-${Date.now()}`, definitionId: definitions.find(item => item.name === 'page')!.id })
  const [defaultLocale] = await json<StoryLocale[]>(page.request, `/stories/${story.id}/locales`)
  const defaultBase = `/stories/${story.id}/locales/${defaultLocale.id}`
  const initial = await json<LocaleSnapshot>(page.request, defaultBase)
  const lease = await json<Lease>(page.request, `${defaultBase}/leases`, { blockId: initial.locale.rootBlockId })
  await json<CommitResult>(page.request, `${defaultBase}/commands`, {
    type: 'insertBlock', mutationId: crypto.randomUUID(),
    expectedRevisions: { [lease.blockId]: initial.blocks.find(item => item.id === lease.blockId)!.revision },
    leaseTokens: { [lease.blockId]: lease.token },
    payload: { parentId: lease.blockId, parentField: 'body', definitionId: definitions.find(item => item.name === 'hero')!.id },
  })
  expect((await page.request.delete(`/api/cms${defaultBase}/leases`, { headers: { Origin: origin }, data: { blockId: lease.blockId, token: lease.token } })).ok()).toBeTruthy()
  const configured = (await json<SpaceLocale[]>(page.request, '/locales')).find(locale => locale.slug === 'fr') ?? await json<SpaceLocale>(page.request, '/locales', { name:'French',slug:'fr' });
  const french = await json<StoryLocale>(page.request, `/stories/${story.id}/locales`, { spaceLocaleId:configured.id })
  const base = `/stories/${story.id}/locales/${french.id}`
  const requests: Command[] = []
  const dropped = new Set<string>()
  await page.route(`**/api/cms${base}/commands`, async route => {
    const command = route.request().postDataJSON() as Command
    requests.push(command)
    if (!dropped.has(command.type)) {
      dropped.add(command.type)
      // Commit to Postgres, then lose only the response as can happen on a dropped connection.
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBeTruthy()
      await route.abort('failed')
    } else await route.continue()
  })

  await page.reload()
  await page.getByRole('button', { name: story.name, exact: true }).click()
  await page.getByRole('tab', { name:`${configured.name} ${configured.slug}`,exact:true }).click()
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeEditable()
  await page.getByRole('button', { name: 'Import from Default', exact: true }).click()
  const imports = page.getByRole('dialog', { name: 'Import from Default' })
  await imports.getByRole('checkbox').check()
  await imports.getByRole('button', { name: 'Import 1 selected', exact: true }).click()
  await expect(imports.getByText('Connection interrupted. Your unsaved edits are kept on this device.', { exact: true })).toBeVisible()
  expect((await json<LocaleSnapshot>(page.request, base)).blocks).toHaveLength(2)
  await imports.getByRole('button', { name: 'Import 1 selected', exact: true }).click()
  await expect(imports).not.toBeVisible()
  const importRequests = requests.filter(command => command.type === 'importBlocks')
  expect(importRequests).toHaveLength(2)
  expect(importRequests[1]).toEqual(importRequests[0])
  expect((await json<LocaleSnapshot>(page.request, base)).blocks).toHaveLength(2)

  await page.getByRole('region', { name: 'Block editor' }).getByRole('button', { name: 'Add block', exact: true }).click()
  const insert = page.getByRole('dialog', { name: 'Add a block' })
  await insert.getByLabel('Block type', { exact: true }).selectOption(definitions.find(item => item.name === 'footer')!.id)
  await insert.getByRole('button', { name: 'Add block', exact: true }).click()
  await expect(insert.getByText('Connection interrupted. Your unsaved edits are kept on this device.', { exact: true })).toBeVisible()
  expect((await json<LocaleSnapshot>(page.request, base)).blocks).toHaveLength(3)
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('blok:drafts:') && key.endsWith(':command')))).toBeTruthy()

  page.once('dialog', dialog => void dialog.accept())
  await page.reload()
  await expect(page.getByRole('heading', { name: story.name, exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name:`${configured.name} ${configured.slug}`,exact:true })).toHaveAttribute('aria-selected','true')
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
  await expect.poll(() => requests.filter(command => command.type === 'insertBlock').length).toBe(2)
  const insertRequests = requests.filter(command => command.type === 'insertBlock')
  expect(insertRequests[1]).toEqual(insertRequests[0])
  expect((await json<LocaleSnapshot>(page.request, base)).blocks).toHaveLength(3)
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('blok:drafts:') && key.endsWith(':command')))).toBeFalsy()
})
