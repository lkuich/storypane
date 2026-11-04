import { signInApi, signInPage, authState } from './auth'
import { expect, test, type Page } from '@playwright/test'
import type { BlockDefinition, Datasource, LocaleSnapshot, Publication, Story, StoryLocale, SchemaMigration, MigrationReview } from '@storypane/core'

const origin = 'http://127.0.0.1:3130'

async function deployPending(page:Page) {
  const migrations=await (await page.request.get('/api/cms/migrations')).json() as SchemaMigration[]
  const active=migrations.find(item=>item.status==='active')
  if(!active)return
  const review=await (await page.request.get(`/api/cms/migrations/${active.id}/review`)).json() as MigrationReview
  expect(review.blockers).toEqual([])
  const response=await page.request.post(`/api/cms/migrations/${active.id}/deploy`,{headers:{Origin:origin},data:{reviewToken:review.token,confirmation:review.confirmation ?? undefined}})
  expect(response.ok(),await response.text()).toBeTruthy()
}

async function addField(page: Page, label: string, type = 'text') {
  const drawer = page.locator('dialog.schema-drawer')
  await drawer.getByRole('tab', { name: 'Fields', exact: true }).click()
  await drawer.getByRole('textbox', { name: 'Name', exact: true }).fill(label.toLowerCase().replaceAll(' ', '_'))
  await drawer.getByRole('button', { name: /^Choose field type:/ }).click()
  const picker = drawer.getByRole('dialog', { name: 'Choose field type' })
  const names: Record<string, string> = { text: 'Text', textarea: 'Textarea', richtext: 'Richtext', markdown: 'Markdown', number: 'Number', datetime: 'Date / Time', boolean: 'Boolean', option: 'Single Option', options: 'Multi Options', link: 'Link', asset: 'Asset', blocks: 'Blocks' }
  await picker.getByRole('button', { name: names[type], exact: true }).click()
  await expect(picker).not.toBeVisible()
  await drawer.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(drawer.getByLabel('Label', { exact: true })).toHaveValue(label)
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
  await addField(page, 'Summary', 'textarea')
  await expect(page.getByLabel('Text format', { exact: true })).toHaveValue('textarea')
  await addField(page, 'Body', 'richtext')
  await expect(page.getByLabel('Text format', { exact: true })).toHaveValue('richtext')
  await addField(page, 'Notes', 'markdown')
  await expect(page.getByLabel('Text format', { exact: true })).toHaveValue('markdown')
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
  await expect(page.getByText('Saved to active migration', { exact: true })).toBeVisible()
  const definitions = await (await page.request.get('/api/cms/definitions')).json() as BlockDefinition[]
  const definition = definitions.find(item => item.displayName === schemaName)!
  expect(definition.kind).toBe('universal')
  expect(definition.fields.map(field => field.type)).toEqual(['text', 'text', 'text', 'text', 'number', 'datetime', 'boolean', 'option', 'options', 'link', 'asset', 'blocks'])

  await page.locator('dialog.schema-drawer').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button',{name:/^Review migration/}).click()
  await page.getByRole('button',{name:'Deploy migration',exact:true}).click()
  await expect(page.getByRole('dialog',{name:/^Review migration/})).not.toBeVisible()

  const editor = await playwright.request.newContext({ storageState:authState('editor'), baseURL: origin, extraHTTPHeaders: { Origin: origin } })
  try {
    await signInApi(editor, 'editor')
    const schema = { name: definition.name, displayName: schemaName, kind: definition.kind, fields: definition.fields }
    const baseVersion=(await (await page.request.get('/api/cms/migrations')).json() as SchemaMigration[]).filter(item=>item.status==='deployed').at(-1)!.version
    expect((await editor.post(`/api/cms/definitions/${definition.id}/versions`, { data: {schema,baseVersion,expectedVersionId:definition.versionId} })).status()).toBe(403)
    expect((await editor.post('/api/cms/definitions', { data: {schema:{...schema,name:`forbidden_${suffix}`},baseVersion} })).status()).toBe(403)
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

test('schema drawer supports the icon picker, keyboard editing, reordering, and safe dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInPage(page)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Blocks', exact: true }).click()
  await page.getByRole('button', { name: 'New block', exact: true }).click()
  const drawer = page.locator('dialog.schema-drawer')
  const name = `Drawer check ${Date.now()}`
  await drawer.getByLabel('Display name', { exact: true }).fill(name)
  await drawer.getByRole('tab', { name: 'Fields', exact: true }).click()
  await drawer.getByRole('button', { name: /^Choose field type:/ }).click()
  const picker = drawer.getByRole('dialog', { name: 'Choose field type' })
  await expect(picker.getByRole('searchbox', { name: 'Filter field types' })).toBeFocused()
  await expect(picker.locator('.field-type-grid button')).toHaveCount(12)
  await expect(picker.locator('.field-type-grid button svg')).toHaveCount(12)
  await page.screenshot({ path: '/tmp/storypane-schema-picker-desktop.png' })
  const bounds = (await drawer.boundingBox())!
  expect(bounds.x + bounds.width).toBe(1428)
  expect(bounds.height).toBe(976)
  await picker.getByRole('searchbox').fill('unknown')
  await expect(picker.getByRole('status')).toContainText('No field types match')
  await picker.getByRole('searchbox').fill('markdown')
  await page.keyboard.press('Enter')
  await expect(picker).not.toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Choose field type: Markdown', exact: true })).toBeFocused()
  await drawer.getByRole('button', { name: /^Choose field type:/ }).click()
  await page.keyboard.press('Escape')
  await expect(picker).not.toBeVisible()
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: /^Choose field type:/ })).toBeFocused()

  await addField(page, 'Title')
  await addField(page, 'Summary', 'textarea')
  await addField(page, 'Image', 'asset')
  await drawer.getByRole('button', { name: 'Edit image', exact: true }).click()
  await drawer.getByRole('textbox', { name: 'Name', exact: true }).fill('title')
  await expect(drawer.getByRole('alert')).toHaveText('A field with this name already exists.')
  await expect(drawer.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await drawer.getByRole('textbox', { name: 'Name', exact: true }).fill('')
  await drawer.getByRole('button', { name: 'Reorder summary', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  await expect(drawer.getByRole('button', { name: 'Reorder summary', exact: true })).toBeFocused()
  await expect(drawer.locator('.schema-field-toggle strong')).toHaveText(['summary', 'title', 'image'])
  await drawer.getByRole('button', { name: 'Reorder image', exact: true }).dragTo(drawer.locator('.schema-field-card').first(), { steps: 10, targetPosition: { x: 20, y: 4 } })
  await expect(drawer.locator('.schema-field-toggle strong')).toHaveText(['image', 'summary', 'title'])
  await page.screenshot({ path: '/tmp/storypane-schema-drawer-desktop.png' })
  page.once('dialog', dialog => void dialog.dismiss())
  await page.mouse.click(20, 200)
  await expect(drawer).toBeVisible()
  await drawer.getByRole('textbox', { name: 'Name', exact: true }).focus()
  await page.keyboard.press('Control+s')
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible()
  await page.mouse.click(20, 200)
  await expect(drawer).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'New block', exact: true })).toBeFocused()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(drawer.locator('.schema-field-toggle strong')).toHaveText(['image', 'summary', 'title'])
  await drawer.getByRole('button', { name: 'Edit title', exact: true }).click()
  await drawer.getByLabel('Label', { exact: true }).fill('Page title')
  await drawer.getByRole('button', { name: 'Save to migration', exact: true }).click()
  await expect(drawer.getByText('Version 2', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Edit title', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await drawer.getByRole('button', { name: /^Choose field type:/ }).click()
  await expect(picker.getByRole('searchbox')).toBeFocused()
  await page.screenshot({ path: '/tmp/storypane-schema-picker-mobile.png' })
  await page.keyboard.press('Escape')
  const footer = (await drawer.locator('.schema-drawer-footer').boundingBox())!
  expect(footer.y + footer.height).toBeLessThanOrEqual(844)
  await drawer.getByRole('button', { name: 'Edit title', exact: true }).click()
  await drawer.getByLabel('Label', { exact: true }).fill('Discard this change')
  page.once('dialog', dialog => void dialog.accept())
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await page.getByRole('button', { name, exact: true }).click()
  await drawer.getByRole('button', { name: 'Edit title', exact: true }).click()
  await expect(drawer.getByLabel('Label', { exact: true })).toHaveValue('Page title')
})

test('editors can inspect schema fields in the drawer without changing them', async ({ page }) => {
  await signInPage(page, 'editor')
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Blocks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New block', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'Hero', exact: true }).click()
  const drawer = page.locator('dialog.schema-drawer')
  await expect(drawer.getByText('Read only', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: /^Choose field type:/ })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Edit title', exact: true }).click()
  await expect(drawer.getByLabel('Label', { exact: true })).toBeDisabled()
  await expect(drawer.getByRole('button', { name: 'Field type', exact: true })).toBeDisabled()
  await expect(drawer.getByRole('button', { name: 'Remove field', exact: true })).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click()
  await expect(drawer.getByLabel('Display name', { exact: true })).toBeDisabled()
  await expect(drawer.getByRole('textbox', { name: 'Tags', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Hero', exact: true })).toBeFocused()
})

test('existing fields use the visual type picker without losing shared settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInPage(page)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Blocks', exact: true }).click()
  await page.getByRole('button', { name: 'New block', exact: true }).click()
  const drawer = page.locator('dialog.schema-drawer')
  const name = `Field picker ${Date.now()}`
  await drawer.getByLabel('Display name', { exact: true }).fill(name)
  await addField(page, 'Title')
  await drawer.getByLabel('Description', { exact: true }).fill('A useful headline')
  await drawer.getByLabel('Required to publish', { exact: true }).check()
  await drawer.getByLabel('Maximum characters', { exact: true }).fill('120')
  await drawer.getByLabel('Default value', { exact: true }).fill('Hello')
  await drawer.getByRole('button', { name: 'Create block', exact: true }).click()
  const save = drawer.getByRole('button', { name: 'Save to migration', exact: true })
  await expect(save).toBeDisabled()

  const trigger = drawer.getByRole('button', { name: 'Field type', exact: true })
  const picker = drawer.getByRole('dialog', { name: 'Choose field type' })
  await expect(trigger).toHaveText('Text')
  await trigger.click()
  await expect(picker.getByRole('searchbox')).toBeFocused()
  await expect(picker.locator('.field-type-grid button svg')).toHaveCount(12)
  await expect(picker.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await drawer.locator('.field-type-picker--full').scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/storypane-field-type-desktop.png' })
  await picker.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(trigger).toBeFocused()
  await expect(save).toBeDisabled()
  await expect(drawer.getByLabel('Default value', { exact: true })).toHaveValue('Hello')

  await trigger.click()
  await picker.getByRole('searchbox').fill('textarea')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveText('Textarea')
  await expect(drawer.getByLabel('Text format', { exact: true })).toHaveValue('textarea')
  await expect(drawer.getByLabel('Maximum characters', { exact: true })).toHaveValue('120')
  await expect(drawer.getByLabel('Default value', { exact: true })).toHaveValue('')

  await page.setViewportSize({ width: 390, height: 844 })
  await trigger.click()
  await drawer.locator('.field-type-picker--full').scrollIntoViewIfNeeded()
  await expect.poll(() => drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/storypane-field-type-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(picker).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(drawer).toBeVisible()
  await trigger.click()
  await picker.getByRole('button', { name: 'Number', exact: true }).click()
  await expect(drawer.getByLabel('Minimum', { exact: true })).toBeVisible()
  await drawer.getByLabel('Minimum', { exact: true }).fill('1')
  await trigger.click()
  await picker.getByRole('button', { name: 'Richtext', exact: true }).click()
  await expect(trigger).toHaveText('Richtext')
  await expect(drawer.getByLabel('Description', { exact: true })).toHaveValue('A useful headline')
  await expect(drawer.getByLabel('Required to publish', { exact: true })).toBeChecked()
  await save.click()
  await expect(save).toBeDisabled()
  const definitions = await (await page.request.get('/api/cms/definitions')).json() as BlockDefinition[]
  const field = definitions.find(definition => definition.displayName === name)!.fields[0]
  expect(field).toMatchObject({ name: 'title', label: 'Title', description: 'A useful headline', required: true, type: 'text', format: 'richtext' })
})

test('searches allowed blocks and persists tag rules through schema editing and story insertion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInPage(page)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Blocks', exact: true }).click()
  const suffix = crypto.randomUUID().slice(0, 8)
  const childName = `Tagged feature ${suffix}`, parentName = `Tagged page ${suffix}`, tag = `layout-${suffix}`
  const drawer = page.locator('dialog.schema-drawer')
  await page.getByRole('button', { name: 'New block', exact: true }).click()
  await drawer.getByLabel('Display name', { exact: true }).fill(childName)
  await drawer.getByRole('textbox', { name: 'Tags', exact: true }).fill(`${tag}, marketing`)
  await drawer.getByRole('button', { name: 'Create block', exact: true }).click()
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: childName, exact: true }).click()
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click()
  await expect(drawer.getByRole('textbox', { name: 'Tags', exact: true })).toHaveValue(`${tag}, marketing`)
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('button', { name: 'New block', exact: true }).click()
  await drawer.getByLabel('Display name', { exact: true }).fill(parentName)
  await drawer.getByRole('radio', { name: /^Content type/ }).check()
  await addField(page, 'Body', 'blocks')
  const restrictions = drawer.locator('.block-restrictions')
  const search = restrictions.getByRole('searchbox')
  await search.fill(tag)
  await expect(restrictions.getByRole('checkbox')).toHaveCount(1)
  await restrictions.getByRole('checkbox').check()
  await search.fill('no-such-block')
  await expect(restrictions.getByRole('status')).toContainText('No matches')
  await expect(restrictions).toContainText('1 selected')
  await search.fill(childName)
  await expect(restrictions.getByRole('checkbox')).toBeChecked()
  await drawer.getByRole('button', { name: 'Create block', exact: true }).click()
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: parentName, exact: true }).click()
  await drawer.getByRole('button', { name: 'Edit body', exact: true }).click()
  await expect(restrictions.getByRole('checkbox', { name: new RegExp(childName) })).toBeChecked()
  await restrictions.getByRole('button', { name: 'Tags', exact: true }).click()
  await search.fill(tag)
  await restrictions.getByRole('checkbox').check()
  await expect(restrictions.locator('.restriction-matches')).toContainText('1 matching block')
  await expect(restrictions.locator('.restriction-matches')).toContainText(childName)
  await restrictions.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/storypane-tag-restrictions-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await restrictions.scrollIntoViewIfNeeded()
  await expect.poll(() => drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/storypane-tag-restrictions-mobile.png' })
  await drawer.getByRole('button', { name: 'Save to migration', exact: true }).click()
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: parentName, exact: true }).click()
  await drawer.getByRole('button', { name: 'Edit body', exact: true }).click()
  await expect(restrictions.getByRole('button', { name: 'Tags', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(restrictions.getByRole('checkbox', { name: new RegExp(tag) })).toBeChecked()
  const definitions = await (await page.request.get('/api/cms/definitions')).json() as BlockDefinition[]
  const parent = definitions.find(item => item.displayName === parentName)!
  expect(parent.fields[0]).toMatchObject({ allowedTags:[tag] })
  expect(parent.fields[0]).not.toHaveProperty('allowedDefinitionIds')
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await deployPending(page)
  const response = await page.request.post('/api/cms/stories', { headers:{ Origin:origin },data:{ name:parentName,slug:`tag-test-${suffix}`,definitionId:parent.id } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const story = await response.json() as Story
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/?space=11111111-1111-4111-8111-111111111111&story=${story.id}`)
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  const insert = page.getByRole('dialog', { name: 'Add a block' })
  await expect(insert.locator('.block-picker-item')).toHaveCount(1)
  await insert.getByRole('searchbox', { name:'Search blocks' }).fill('no-matching-block')
  await expect(insert.getByText('No matching blocks', { exact:true })).toBeVisible()
  await insert.getByRole('searchbox', { name:'Search blocks' }).fill(childName)
  await insert.getByRole('button', { name:`Add ${childName}`,exact:true }).click()
  await expect(insert).not.toBeVisible()
})

test('opens the latest selected block schema from content without losing edits', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await signInPage(page)
  const suffix = crypto.randomUUID().slice(0, 8)
  const post = async (path: string, data: unknown) => {
    if(path.startsWith('/definitions')) {
      const migrations=await (await page.request.get('/api/cms/migrations')).json() as SchemaMigration[]
      const baseVersion=migrations.filter(item=>item.status==='deployed').at(-1)!.version
      const definitions=await (await page.request.get('/api/cms/definitions')).json() as BlockDefinition[]
      const existing=definitions.find(item=>item.id===path.split('/')[2])
      data={schema:data,baseVersion,...(existing?{expectedVersionId:existing.versionId}:{})}
    }
    const response = await page.request.post(`/api/cms${path}`, { headers: { Origin: origin }, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  const childInput = { name: `quick_feature_${suffix}`, displayName: 'Quick feature', kind: 'nestable', fields: [{ name: 'caption', label: 'Caption', type: 'text', format: 'singleline' }] }
  const child = await post('/definitions', childInput) as BlockDefinition
  const rootInput = { name: `quick_page_${suffix}`, displayName: 'Quick page', kind: 'content-type', fields: [
    { name: 'title', label: 'Title', type: 'text', format: 'singleline' },
    { name: 'body', label: 'Body', type: 'blocks', allowedDefinitionIds: [child.id] },
  ] }
  const root = await post('/definitions', rootInput) as BlockDefinition
  await deployPending(page)
  const story = await post('/stories', { name: `Schema shortcut ${suffix}`, slug: `shortcut-${suffix}`, definitionId: root.id }) as Story
  await post(`/definitions/${root.id}/versions`, { ...rootInput, fields: [...rootInput.fields, { name: 'eyebrow', label: 'Eyebrow', type: 'text', format: 'singleline' }] })
  const url = `/?space=11111111-1111-4111-8111-111111111111&story=${story.id}`
  await page.goto(url)
  const panel = page.getByRole('region', { name: 'Block editor' })
  const shortcut = panel.getByRole('button', { name: 'Edit schema', exact: true })
  const drawer = page.locator('dialog.schema-drawer:not(.block-picker-drawer)')
  const migrationLink=panel.getByRole('link',{name:/1 new field pending in migration .*eyebrow/})
  await expect(migrationLink).toBeVisible()
  await expect(migrationLink).toHaveText('+1')
  await panel.getByLabel('Title', { exact: true }).fill('Keep my page content')
  await shortcut.click()
  await expect(drawer.getByRole('heading', { name: `Edit '${root.name}'`, exact: true })).toBeVisible()
  await expect(drawer.getByText('Version 2', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Edit eyebrow', exact: true })).toBeVisible()
  await expect(drawer.getByRole('button',{name:'Edit eyebrow',exact:true})).toHaveAccessibleDescription(/added in migration .*not deployed yet/)
  await expect(drawer.getByRole('button',{name:'Edit title',exact:true})).not.toHaveAttribute('aria-describedby')
  await addField(page, 'Summary')
  await expect(drawer.getByRole('button',{name:'Edit summary',exact:true})).not.toHaveAttribute('aria-describedby')
  page.once('dialog', dialog => void dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: 'Save to migration', exact: true }).click()
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button',{name:'Edit summary',exact:true})).toHaveAccessibleDescription(/added in migration .*not deployed yet/)
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(drawer).not.toBeVisible()
  await expect(shortcut).toBeFocused()
  await expect(panel.getByLabel('Title', { exact: true })).toHaveValue('Keep my page content')
  await expect(panel.locator('.editor-panel-heading')).toContainText('schema v1')
  await expect(page).toHaveURL(new RegExp(`story=${story.id}`))
  const updatedLink=panel.getByRole('link',{name:/2 new fields pending in migration .*eyebrow, summary/})
  await expect(updatedLink).toHaveText('+2')
  const popupPromise=page.waitForEvent('popup')
  await updatedLink.click()
  const migrationPage=await popupPromise
  try {
    await expect(migrationPage).toHaveURL(/view=blocks&migration=/)
    await expect(migrationPage.getByRole('dialog',{name:/^Review migration/})).toContainText('eyebrow')
    await migrationPage.getByRole('dialog',{name:/^Review migration/}).getByRole('button',{name:'Close dialog',exact:true}).click()
    expect(new URL(migrationPage.url()).searchParams.has('migration')).toBe(false)
  } finally { await migrationPage.close() }

  await panel.getByRole('button', { name: 'Add block', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add a block', exact: true })
  await add.getByRole('button', { name:`Add ${child.displayName}`,exact:true }).click()
  await expect(add).not.toBeVisible()
  await panel.locator('.block-list-item').getByRole('button', { name: 'Quick feature', exact: true }).click()
  await expect(panel.locator('.pending-migration-link')).toHaveCount(0)
  await expect(page).toHaveURL(/block=/)
  const blockUrl=page.url()
  await page.reload()
  await expect(panel.getByRole('heading',{name:'Quick feature',exact:true})).toBeVisible()
  expect(page.url()).toBe(blockUrl)
  await panel.getByLabel('Caption', { exact: true }).fill('Keep my nested content')
  await shortcut.click()
  await expect(drawer.getByRole('heading', { name: `Edit '${child.name}'`, exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Edit caption', exact: true }).click()
  await drawer.getByLabel('Label', { exact: true }).fill('Feature caption')
  await drawer.getByRole('button', { name: 'Save to migration', exact: true }).click()
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/storypane-content-schema-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/storypane-content-schema-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(shortcut).toBeFocused()
  await expect(panel.getByLabel('Caption', { exact: true })).toHaveValue('Keep my nested content')
  await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await shortcut.click()
  await expect(drawer.getByText('Version 2', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: 'Edit caption', exact: true }).click()
  await expect(drawer.getByLabel('Label', { exact: true })).toHaveValue('Feature caption')
  await drawer.getByLabel('Label', { exact: true }).fill('Discard me')
  page.once('dialog', dialog => void dialog.accept())
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()

  const locales = await (await page.request.get(`/api/cms/stories/${story.id}/locales`)).json() as StoryLocale[]
  await expect.poll(async () => {
    const snapshot = await (await page.request.get(`/api/cms/stories/${story.id}/locales/${locales[0]!.id}`)).json() as LocaleSnapshot
    return snapshot.blocks.map(block => block.fields)
  }).toEqual(expect.arrayContaining([{ title: 'Keep my page content' }, { caption: 'Keep my nested content' }]))
  const definitions = await (await page.request.get('/api/cms/definitions')).json() as BlockDefinition[]
  expect(definitions.find(item => item.id === root.id)!.fields.map(field => field.name)).toEqual(['title', 'body', 'eyebrow', 'summary'])
  expect(definitions.find(item => item.id === child.id)!.fields[0]!.label).toBe('Feature caption')

  const editorContext = await browser.newContext()
  try {
    const editorPage = await editorContext.newPage()
    await signInPage(editorPage, 'editor')
    await editorPage.goto(url)
    await expect(editorPage.getByRole('region', { name: 'Block editor' }).getByRole('heading', { name: 'Quick page', exact: true })).toBeVisible()
    await expect(editorPage.getByRole('button', { name: 'Edit schema', exact: true })).toHaveCount(0)
    await expect(editorPage.getByRole('link',{name:/2 new fields pending in migration/})).toBeVisible()
  } finally { await editorContext.close() }
})

test('shared migration saves conflict safely and deployment updates existing blocks',async({page,browser})=>{
  await signInPage(page)
  const suffix=crypto.randomUUID().slice(0,8),name=`Migration ${suffix}`
  const migrations=await (await page.request.get('/api/cms/migrations')).json() as SchemaMigration[]
  const baseVersion=migrations.filter(item=>item.status==='deployed').at(-1)!.version
  const created=await page.request.post('/api/cms/definitions',{headers:{Origin:origin},data:{baseVersion,schema:{name:`migration_${suffix}`,displayName:name,kind:'content-type',fields:[{name:'title',label:'Title',type:'text',format:'singleline',defaultValue:'Preserved content'}]}}})
  expect(created.ok(),await created.text()).toBeTruthy()
  const definition=await created.json() as BlockDefinition
  await deployPending(page)
  const response=await page.request.post('/api/cms/stories',{headers:{Origin:origin},data:{name,slug:`migration-${suffix}`,definitionId:definition.id}})
  expect(response.ok(),await response.text()).toBeTruthy()
  const story=await response.json() as Story
  const context=await browser.newContext({storageState:authState()})
  try {
    const second=await context.newPage()
    for(const editor of [page,second]) {
      await editor.goto('/?space=11111111-1111-4111-8111-111111111111&view=blocks')
      await editor.getByRole('button',{name,exact:true}).click()
      await editor.getByRole('button',{name:'Edit title',exact:true}).click()
    }
    const firstDrawer=page.locator('dialog.schema-drawer'),secondDrawer=second.locator('dialog.schema-drawer')
    await secondDrawer.getByLabel('Label',{exact:true}).fill('My local change')
    await firstDrawer.getByLabel('Field name',{exact:true}).fill('headline')
    await firstDrawer.getByRole('button',{name:'Save to migration',exact:true}).click()
    await expect(firstDrawer.getByText('Saved to active migration',{exact:true})).toBeVisible()
    await expect(secondDrawer.getByRole('alert')).toContainText('shared schema changed',{timeout:12000})
    await expect(secondDrawer.getByLabel('Label',{exact:true})).toHaveValue('My local change')
    await firstDrawer.getByRole('button',{name:'Close dialog',exact:true}).click()
    await page.getByRole('button',{name:/^Review migration/}).click()
    const review=page.getByRole('dialog',{name:/^Review migration/})
    await expect(review).toContainText('renamed')
    await review.getByRole('button',{name:'Deploy migration',exact:true}).click()
    await expect(review).not.toBeVisible()
    await page.goto(`/?space=11111111-1111-4111-8111-111111111111&story=${story.id}`)
    await expect(page.getByRole('region',{name:'Block editor'}).getByLabel('Title',{exact:true})).toHaveValue('Preserved content')
    await expect(page.getByRole('region',{name:'Block editor'}).locator('.pending-migration-link')).toHaveCount(0)
    const locales=await (await page.request.get(`/api/cms/stories/${story.id}/locales`)).json() as StoryLocale[]
    const current=await (await page.request.get(`/api/cms/stories/${story.id}/locales/${locales[0]!.id}`)).json() as LocaleSnapshot
    expect(current.blocks[0]!.fields).toEqual({headline:'Preserved content'})
  }finally{await context.close()}
})
