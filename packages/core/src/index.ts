import { z } from 'zod'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Actor = { userId: string; sessionId: string; spaceId: string; role: 'admin' | 'editor' }
export const spaceInputSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).default('') }).strict()
export type Space = { id: string; name: string; description: string; role: Actor['role']; createdAt: string; storyCount: number; memberCount: number }
export type SpaceDetails = Space & { members: { id: string; name: string; email: string; role: Actor['role'] }[] }
export type SpaceLocale = { id: string; name: string; slug: string; storyCount: number }
export const spaceLocaleInputSchema = z.object({ name:z.string().trim().min(1).max(80), slug:z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/).max(30) }).strict()
export type DeliveredStory = { id: string; name: string; slug: string; locale: string; localeId: string; revision: number; content: Json; publishedAt: string | null }
export type PreviewSession = { token: string; expiresAt: string; spaceId: string; storyId: string; localeId: string; slug: string; locale: string }
export type DeliveryToken = { id: string; name: string; scope: 'published' | 'preview'; createdAt: string }
const previewUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  try { const url = new URL(value.replaceAll('{slug}', 'home').replaceAll('{locale}', 'en')); return url.origin === new URL(value).origin && !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) } catch { return false }
}, 'Use HTTPS, or HTTP on localhost, without credentials or a fragment. Placeholders belong in the path or query.')
export const deliverySettingsSchema = z.object({
  previewUrls: z.array(z.object({ id:z.uuid(), name:z.string().trim().min(1).max(80), url:previewUrlSchema }).strict()).max(20),
  defaultPreviewId: z.uuid().nullable(),
  previewParameter: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).default('blok_preview'),
}).strict().superRefine((value,ctx) => {
  if (new Set(value.previewUrls.map(item => item.id)).size !== value.previewUrls.length) ctx.addIssue({ code:'custom',path:['previewUrls'],message:'Preview IDs must be unique' })
  if (new Set(value.previewUrls.map(item => item.name.toLowerCase())).size !== value.previewUrls.length) ctx.addIssue({ code:'custom',path:['previewUrls'],message:'Preview names must be unique' })
  if (value.previewUrls.length ? !value.previewUrls.some(item => item.id === value.defaultPreviewId) : value.defaultPreviewId !== null) ctx.addIssue({ code:'custom',path:['defaultPreviewId'],message:'Choose a default from the configured preview URLs' })
})
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>
export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'locked' | 'stale_revision' | 'invalid' | 'unavailable'
export type FieldIssue = { path: string; message: string }
export class BlokError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: FieldIssue[]) { super(message); this.name = 'BlokError' }
}
export const jsonSchema = z.custom<Json>((value) => {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  let visited = 0
  while (pending.length) {
    const { value: current, depth } = pending.pop()!
    if (++visited > 20_000 || depth > 40) return false
    if (current === null || typeof current === 'boolean') continue
    if (typeof current === 'number') { if (!Number.isFinite(current)) return false; continue }
    if (typeof current === 'string') { if (current.length > 1_000_000) return false; continue }
    if (typeof current !== 'object') return false
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false
    const children = Object.values(current)
    if (children.length > 10_000) return false
    pending.push(...children.map(value => ({ value, depth: depth + 1 })))
  }
  return true
}, 'Expected bounded JSON content')
export const optionItemSchema = z.object({ value: z.string().max(500), label: z.string().max(500) }).strict()
export type OptionItem = z.infer<typeof optionItemSchema>
export type OptionPage = { items: OptionItem[]; nextCursor?: string }
export const optionSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inline'), items: z.array(optionItemSchema).max(1000) }).strict(),
  z.object({ type: z.literal('datasource'), datasourceId: z.uuid() }).strict(),
  z.object({ type: z.literal('external'), url: z.url().max(2000) }).strict(),
  z.object({ type: z.literal('stories'), contentTypeId: z.uuid().optional() }).strict(),
])
export type OptionSource = z.infer<typeof optionSourceSchema>
const base = { name: z.string().regex(/^[a-z][a-z0-9_]*$/).max(80).refine(v => !['_uid', 'component', '__proto__', 'constructor', 'prototype'].includes(v), 'Reserved field name'), label: z.string().min(1).max(120), description: z.string().max(2000).optional(), required: z.boolean().optional(), defaultValue: jsonSchema.optional() }
const tagsSchema = z.array(z.string().trim().min(1).max(64)).max(50).refine(tags => new Set(tags).size === tags.length, 'Tags must be unique')
export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('text'), format: z.enum(['singleline', 'textarea', 'richtext', 'markdown']).default('singleline'), maxLength: z.number().int().positive().max(1_000_000).optional() }).strict(),
  z.object({ ...base, type: z.literal('number'), min: z.number().optional(), max: z.number().optional(), decimals: z.number().int().min(0).max(15).optional() }).strict(),
  z.object({ ...base, type: z.literal('datetime'), mode: z.enum(['date', 'datetime']).default('datetime') }).strict(),
  z.object({ ...base, type: z.literal('boolean') }).strict(),
  z.object({ ...base, type: z.literal('option'), source: optionSourceSchema }).strict(),
  z.object({ ...base, type: z.literal('options'), source: optionSourceSchema, minItems: z.number().int().nonnegative().optional(), maxItems: z.number().int().positive().max(1000).optional() }).strict(),
  z.object({ ...base, type: z.literal('asset'), mimeTypes: z.array(z.string().max(100)).max(30).optional() }).strict(),
  z.object({ ...base, type: z.literal('link') }).strict(),
  z.object({ ...base, type: z.literal('blocks'), allowedDefinitionIds: z.array(z.uuid()).max(500).optional(), allowedTags: tagsSchema.optional(), minItems: z.number().int().nonnegative().optional(), maxItems: z.number().int().positive().max(1000).optional() }).strict().refine(field => !(field.allowedTags?.length && field.allowedDefinitionIds?.length), 'Restrict by blocks or tags, not both'),
])
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>
export const definitionInputSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9_]*$/).max(80), displayName: z.string().min(1).max(120), kind: z.enum(['nestable', 'content-type', 'universal']), tags: tagsSchema.optional(), fields: z.array(fieldDefinitionSchema).max(200) }).strict().superRefine((schema, ctx) => {
  const names = new Set<string>()
  schema.fields.forEach((field, i) => {
    if (names.has(field.name)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'name'], message: 'Field names must be unique' })
    names.add(field.name)
    if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) ctx.addIssue({ code: 'custom', path: ['fields', i], message: 'Minimum exceeds maximum' })
    if ((field.type === 'blocks' || field.type === 'options') && field.minItems !== undefined && field.maxItems !== undefined && field.minItems > field.maxItems) ctx.addIssue({ code: 'custom', path: ['fields', i], message: 'Minimum exceeds maximum' })
  })
})
export type DefinitionInput = z.infer<typeof definitionInputSchema>
export type BlockDefinition = DefinitionInput & { id: string; versionId: string; version: number; createdAt: string }
export function isBlockAllowed(field: Extract<FieldDefinition, { type: 'blocks' }>, definition: Pick<BlockDefinition, 'id' | 'kind' | 'tags'>): boolean {
  return definition.kind !== 'content-type' &&
    (!field.allowedDefinitionIds?.length || field.allowedDefinitionIds.includes(definition.id)) &&
    (!field.allowedTags?.length || field.allowedTags.some(tag => definition.tags?.includes(tag)))
}
export type AssetReference = { assetId: string; alt?: string }
export const assetReferenceSchema = z.object({ assetId: z.uuid(), alt: z.string().max(2000).optional() }).strict()
export const linkValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('story'), storyId: z.uuid() }).strict(),
  z.object({ type: z.literal('external'), url: z.url().refine(v => ['https:', 'http:'].includes(new URL(v).protocol), 'Use an HTTP or HTTPS URL') }).strict(),
  z.object({ type: z.literal('email'), email: z.email() }).strict(),
  z.object({ type: z.literal('asset'), assetId: z.uuid() }).strict(),
])
export type LinkValue = z.infer<typeof linkValueSchema>
export type Story = { id: string; name: string; slug: string; createdAt: string; updatedAt: string }
export type StoryLocale = { id: string; storyId: string; spaceLocaleId: string; slug: string; name: string; urlSlug: string; rootBlockId: string; revision: number; checkpointId: string | null; publishedVersionId: string | null }
export type BlockDraft = { id: string; definitionId: string; schemaVersionId: string; parentId: string | null; parentField: string | null; position: number; fields: Record<string, Json>; revision: number }
export type Lease = { blockId: string; userId: string; sessionId: string; expiresAt: string; token?: string }
export type LocaleSnapshot = { story: Story; locale: StoryLocale; blocks: BlockDraft[]; definitions: BlockDefinition[]; leases: Lease[]; revision: number; checkpointId: string | null }
export type Checkpoint = { id: string; revision: number; reason: string; actorId: string; createdAt: string }
export type CheckpointDetail = Checkpoint & { snapshot: LocaleSnapshot; content: Json }
export type Publication = { id: string; checkpointId: string; revision: number; createdAt: string; content: Json }
export type Datasource = { id: string; name: string; slug: string; items: OptionItem[] }
export type CommitResult = { mutationId: string; localeRevision: number; changedBlockIds: string[]; checkpointId: string; snapshot: LocaleSnapshot; publicationId?: string }

const id = z.uuid()
const mutationBase = { mutationId: id, expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).default({}), leaseTokens: z.record(z.string(), z.string().min(1)).default({}) }
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...mutationBase, type: z.literal('saveBlock'), payload: z.object({ blockId: id, fields: z.record(z.string(), jsonSchema) }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('insertBlock'), payload: z.object({ parentId: id, parentField: z.string(), definitionId: id, position: z.number().int().nonnegative().optional() }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('moveBlock'), payload: z.object({ blockId: id, parentId: id, parentField: z.string(), position: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('deleteBlock'), payload: z.object({ blockId: id }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('importBlocks'), payload: z.object({ sourceLocaleId: id, blockIds: z.array(id).min(1).max(100), parentId: id, parentField: z.string() }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('restoreBlock'), payload: z.object({ blockId: id, checkpointId: id }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('restorePage'), payload: z.object({ checkpointId: id }).strict() }).strict(),
  z.object({ ...mutationBase, type: z.literal('publishCheckpoint'), payload: z.object({ checkpointId: id }).strict() }).strict(),
])
export type Command = z.infer<typeof commandSchema>
export const storyInputSchema = z.object({ name: z.string().trim().min(1).max(200), slug: z.string().regex(/^[a-z0-9][a-z0-9\-/]*$/).max(200), definitionId: id }).strict()
export const localeInputSchema = z.object({ spaceLocaleId:z.uuid(), urlSlug:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9\-/]*$/).max(200).optional() }).strict()
export const datasourceInputSchema = z.object({ name: z.string().trim().min(1).max(120), slug: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(80), items: z.array(optionItemSchema).max(1000) }).strict().refine(v => new Set(v.items.map(i => i.value)).size === v.items.length, 'Datasource values must be unique')
export const LEASE_SECONDS = 45
export const LEASE_RENEW_MS = 15_000

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new BlokError('invalid', 'Invalid request', parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })))
  return parsed.data
}
export function defaultFields(schema: DefinitionInput): Record<string, Json> {
  return Object.fromEntries(schema.fields.filter(f => f.type !== 'blocks' && f.defaultValue !== undefined).map(f => [f.name, structuredClone(f.defaultValue!)]))
}

const richNodes = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule'])
const richMarks = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'link'])
function validRichText(value: Json, depth = 0): boolean {
  if (depth > 30 || !value || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.type !== 'string' || !richNodes.has(value.type)) return false
  if (value.text !== undefined && typeof value.text !== 'string') return false
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every(mark => {
    if (!mark || typeof mark !== 'object' || Array.isArray(mark) || typeof mark.type !== 'string' || !richMarks.has(mark.type)) return false
    if (mark.type === 'link') { const attrs = mark.attrs; if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) || typeof attrs.href !== 'string' || !/^(https?:|mailto:)/i.test(attrs.href)) return false }
    return true
  }))) return false
  return value.content === undefined || (Array.isArray(value.content) && value.content.length <= 10000 && value.content.every(child => validRichText(child, depth + 1)))
}
export function validateFields(schema: DefinitionInput, fields: Record<string, Json>, publish = false): FieldIssue[] {
  const issues: FieldIssue[] = []
  const known = new Map(schema.fields.map(f => [f.name, f]))
  for (const name of Object.keys(fields)) if (!known.has(name) || known.get(name)?.type === 'blocks') issues.push({ path: name, message: 'Unknown field or nested content must be edited structurally' })
  for (const field of schema.fields) {
    if (field.type === 'blocks') continue
    const value = fields[field.name]
    const fail = (message: string) => issues.push({ path: field.name, message })
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
    if (empty) { if (publish && field.required) fail('Required'); else if (publish && field.type === 'options' && field.minItems) fail(`Choose at least ${field.minItems}`); continue }
    switch (field.type) {
      case 'text':
        if (field.format === 'richtext') {
          if (!validRichText(value) || typeof value !== 'object' || Array.isArray(value) || value.type !== 'doc') fail('Expected a rich text document')
          else {
            const text = (node: Json): string => node && typeof node === 'object' && !Array.isArray(node) ? (typeof node.text === 'string' ? node.text : '') + (Array.isArray(node.content) ? node.content.map(text).join('') : '') : ''
            const content = text(value)
            if (publish && field.required && !content.trim()) fail('Required')
            if (field.maxLength && content.length > field.maxLength) fail(`Maximum ${field.maxLength} characters`)
          }
        }
        else if (typeof value !== 'string') fail('Expected text')
        else if (field.maxLength && value.length > field.maxLength) fail(`Maximum ${field.maxLength} characters`)
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('Expected a finite number')
        else { if (field.min !== undefined && value < field.min) fail(`Minimum ${field.min}`); if (field.max !== undefined && value > field.max) fail(`Maximum ${field.max}`); if (field.decimals !== undefined && Math.abs(value * 10 ** field.decimals - Math.round(value * 10 ** field.decimals)) > 1e-7) fail(`Maximum ${field.decimals} decimals`) }
        break
      case 'datetime': {
        const pattern = field.mode === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
        if (typeof value !== 'string' || !pattern.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) fail(field.mode === 'date' ? 'Expected YYYY-MM-DD date' : 'Expected a UTC ISO timestamp')
        break
      }
      case 'boolean': if (typeof value !== 'boolean') fail('Expected true or false'); break
      case 'option': if (typeof value !== 'string') fail('Expected one option value'); break
      case 'options':
        if (!Array.isArray(value) || !value.every(v => typeof v === 'string') || new Set(value).size !== value.length) fail('Expected distinct option values')
        else { if (publish && field.minItems !== undefined && value.length < field.minItems) fail(`Choose at least ${field.minItems}`); if (field.maxItems !== undefined && value.length > field.maxItems) fail(`Choose at most ${field.maxItems}`) }
        break
      case 'asset': if (!assetReferenceSchema.safeParse(value).success) fail('Expected an asset reference'); break
      case 'link': if (!linkValueSchema.safeParse(value).success) fail('Expected a valid link'); break
    }
  }
  return issues
}
