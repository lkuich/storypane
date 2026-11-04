import { signInApi, signInPage } from './auth'
import { expect, test, type Page } from '@playwright/test'
import type { BlockDefinition, Datasource, Publication } from '@blok/core'

const origin = 'http://127.0.0.1:3130'

async function addField(page: Page, label: string, type = 'text') {
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a field' })
  await dialog.getByLabel('Label', { exact: true }).fill(label)
  await dialog.getByLabel('Type', { exact: true }).selectOption(type)
  await dialog.getByRole('button', { name: 'Add field', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

test('admin builds a schema and datasource, then authors and publishes typed content', async ({ page, playwright }) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID().slice(0, 8)
  const sourceName = `Palette ${suffix}`
  const schemaName = `Campaign ${suffix}`
  const storyName = `Schema browser check ${suffix}`
  await signInPage(page)
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await navigation.getByRole('button', { name: 'Datasources', exact: true }).click()
  await page.getByRole('button', { name: 'New datasource', exact: true }).click()
  const datasourceDialog = page.getByRole('dialog', { name: 'New datasource' })
  await datasourceDialog.getByLabel('Name', { exact: true }).fill(sourceName)
  await datasourceDialog.getByLabel('Choice 1 label', { exact: true }).fill('Azure')
  await datasourceDialog.getByLabel('Choice 1 value', { exact: true }).fill('azure')
  await datasourceDialog.getByRole('button', { name: 'Add choice', exact: true }).click()
  await datasourceDialog.getByLabel('Choice 2 label', { exact: true }).fill('Amber')
  await datasourceDialog.getByLabel('Choice 2 value', { exact: true }).fill('amber')
  await datasourceDialog.getByRole('button', { name: 'Save datasource', exact: true }).click()
  await expect(datasourceDialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: sourceName, exact: true })).toBeVisible()
  const sources = await (await page.request.get('/api/cms/datasources')).json() as Datasource[]
  const source = sources.find(item => item.name === sourceName)!
  const resolved = await page.request.post('/api/cms/options', { headers: { Origin: origin }, data: { source: { type: 'datasource', datasourceId: source.id }, query: 'az' } })
  expect(resolved.status()).toBe(200)
  expect(await resolved.json()).toEqual({ items: [{ value: 'azure', label: 'Azure' }] })

  await navigation.getByRole('button', { name: 'Blocks', exact: true }).click()
  await page.getByRole('button', { name: 'New block', exact: true }).click()
  await page.getByLabel('Display name', { exact: true }).fill(schemaName)
  await page.getByRole('radio', { name: /^Universal/ }).check()
  await addField(page, 'Heading')
  await page.getByRole('checkbox', { name: 'Required to publish', exact: true }).check()
  await addField(page, 'Summary')
  await page.getByLabel('Text format', { exact: true }).selectOption('textarea')
  await addField(page, 'Body')
  await page.getByLabel('Text format', { exact: true }).selectOption('richtext')
  await addField(page, 'Notes')
  await page.getByLabel('Text format', { exact: true }).selectOption('markdown')
  await addField(page, 'Count', 'number')
  await page.getByLabel('Minimum', { exact: true }).fill('0')
  await page.getByLabel('Decimal places', { exact: true }).fill('0')
  await addField(page, 'Release', 'datetime')
  await page.getByLabel('Selection', { exact: true }).selectOption('date')
  await addField(page, 'Featured', 'boolean')
  for (const [label, type] of [['Palette', 'option'], ['Tags', 'options']]) {
    await addField(page, label, type)
    await page.getByLabel('Option source', { exact: true }).selectOption('datasource')
    await page.getByLabel('Datasource', { exact: true }).selectOption(source.id)
  }
  await addField(page, 'Destination', 'link')
  await addField(page, 'Image', 'asset')
  await addField(page, 'Sections', 'blocks')
  await page.getByRole('button', { name: 'Create block', exact: true }).click()
  await expect(page.getByText('Version saved', { exact: true })).toBeVisible()
  const definitions = await (await page.request.get('/api/cms/definitions')).json() as BlockDefinition[]
  const definition = definitions.find(item => item.displayName === schemaName)!
  expect(definition.kind).toBe('universal')
  expect(definition.fields.map(field => field.type)).toEqual(['text', 'text', 'text', 'text', 'number', 'datetime', 'boolean', 'option', 'options', 'link', 'asset', 'blocks'])

  const editor = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } })
  try {
    await signInApi(editor, 'editor')
    const schema = { name: definition.name, displayName: schemaName, kind: definition.kind, fields: definition.fields }
    expect((await editor.post(`/api/cms/definitions/${definition.id}/versions`, { data: schema })).status()).toBe(403)
    expect((await editor.post('/api/cms/definitions', { data: { ...schema, name: `forbidden_${suffix}` } })).status()).toBe(403)
  } finally { await editor.dispose() }

  await navigation.getByRole('button', { name: 'Content', exact: true }).click()
  await page.getByRole('button', { name: 'New story', exact: true }).click()
  const storyDialog = page.getByRole('dialog', { name: 'Create a story' })
  await storyDialog.getByLabel('Name', { exact: true }).fill(storyName)
  await storyDialog.getByLabel('Content type', { exact: true }).selectOption(definition.id)
  await storyDialog.getByRole('button', { name: 'Create story', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /^Heading/ })).toBeEditable()
  await page.getByRole('textbox', { name: /^Heading/ }).fill('Typed content, saved live')
  await page.getByLabel('Summary', { exact: true }).fill('First line\nSecond line')
  await page.getByRole('textbox', { name: 'Body', exact: true }).fill('Rich content stays structured')
  await page.getByLabel('Notes', { exact: true }).fill('## Markdown notes\n\nA simple paragraph.')
  await page.getByLabel('Count', { exact: true }).fill('42')
  await page.getByLabel('Release', { exact: true }).fill('2026-11-03')
  await page.getByLabel('Featured', { exact: true }).check()
  await page.getByRole('combobox', { name: 'Palette', exact: true }).selectOption('azure')
  await page.getByRole('checkbox', { name: 'Amber', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Azure', exact: true }).check()
  await page.getByRole('combobox', { name: 'Link type', exact: true }).selectOption('external')
  await page.getByLabel('External URL', { exact: true }).fill('https://example.com/campaign')
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Review & publish', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review before publishing' })
  await expect(review.locator('pre')).toContainText('Typed content, saved live')
  await review.getByRole('button', { name: /Publish revision/ }).click()
  await expect(review).not.toBeVisible()
  const publishedLink = page.getByRole('link', { name: 'Published JSON', exact: true })
  await expect(publishedLink).toBeVisible()
  const response = await page.request.get((await publishedLink.getAttribute('href'))!)
  expect(response.status()).toBe(200)
  const published = await response.json() as Publication
  expect(published.content).toMatchObject({
    component: definition.name,
    heading: 'Typed content, saved live',
    summary: 'First line\nSecond line',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich content stays structured' }] }] },
    notes: '## Markdown notes\n\nA simple paragraph.',
    count: 42,
    release: '2026-11-03',
    featured: true,
    palette: 'azure',
    tags: ['amber', 'azure'],
    destination: { type: 'external', url: 'https://example.com/campaign' },
    sections: [],
  })
})
