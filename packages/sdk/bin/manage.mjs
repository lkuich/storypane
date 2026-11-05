import { readFile, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { createManagementClient } from '../dist/management.js';

const actions = {
  stories: ['list', 'get', 'create', 'update', 'delete'],
  folders: ['list', 'create', 'update', 'delete'],
  locales: ['list', 'create', 'update', 'delete'],
  datasources: ['list', 'create', 'update'],
  roles: ['list', 'create', 'update', 'delete'],
  invitations: ['list', 'create', 'delete'],
  webhooks: ['list', 'create', 'update', 'delete'],
  assets: ['list', 'get', 'update', 'delete'],
  space: ['get', 'update'],
};
const resources = new Set(Object.keys(actions));
export const managementCommands = new Set([
  ...resources,
  'space',
  'schemas',
  'content',
  'assets',
  'api',
]);
export const managementHelp = `storypane stories list|get|create|update|delete [id] [--input file|-]
storypane folders|locales|roles|webhooks list|create|update|delete [id] [--input file|-]
storypane datasources list|create|update [id] [--input file|-]
storypane invitations list|create|delete [id] [--input file|-]
storypane space get|update [--input file|-]
storypane schemas list
storypane content get|save|publish|command <storyId> <localeId> [blockId] [--input file|-]
storypane assets list|get|update|delete [id] [--input file|-]
storypane assets upload <file> --mime <content-type>
storypane assets download <id> --out <file>
storypane api <GET|POST|PUT|PATCH|DELETE|HEAD> </resource/path> [--input file|-] [--out file]

Management commands use STORYPANE_URL, STORYPANE_SPACE_ID, STORYPANE_MANAGEMENT_TOKEN.
Use --json for compact JSON, --offset/--limit for lists (--cursor for assets), and --yes for deletes,
publishing, raw commands, and generic API writes. JSON input may come from stdin (-).
Story updates change name/location using the existing location contract.
Create scoped tokens in Settings → API & preview → Management API.`;

async function inputFile(file) {
  if (!file) {
    throw new Error('Provide --input <file> or --input - for JSON from stdin');
  }
  let text = '';
  if (file === '-') {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      text += chunk;
      if (Buffer.byteLength(text) > 2 * 1024 * 1024) {
        throw new Error('JSON input exceeds 2 MiB');
      }
    }
  } else {
    text = await readFile(file, 'utf8');
  }
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) {
    throw new Error('JSON input exceeds 2 MiB');
  }
  return JSON.parse(text);
}
function confirmed(values) {
  if (!values.yes) {
    throw new Error('Review the action and pass --yes to apply it');
  }
}
function requireId(id) {
  if (!id) {
    throw new Error('An ID is required');
  }
  return encodeURIComponent(id);
}
async function download(response, output) {
  if (!output || !response.body) {
    throw new Error('Provide --out <file> to save the response');
  }
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return { file: output };
}

export async function runManagement(args, values, setting) {
  const api = createManagementClient({
    url: setting('URL'),
    spaceId: setting('SPACE_ID'),
    token: setting('MANAGEMENT_TOKEN'),
    timeoutMs: 120000,
  });
  const [resource, action, id, localeId, blockId, extra] = args;
  if (extra || (resource !== 'content' && localeId)) {
    throw new Error('Unexpected arguments; use storypane --help');
  }
  const flags = new Set(['json', 'yes']);
  if (resource === 'api') {
    flags.add('out');
    flags.add('input');
  }
  if (['create', 'update', 'delete', 'save', 'publish', 'command', 'upload'].includes(action)) {
    flags.add('input');
  }
  if (action === 'list') {
    if (resource === 'assets') {
      flags.add('cursor');
    } else {
      flags.add('offset');
      flags.add('limit');
    }
  }
  if (resource === 'assets' && action === 'upload') {
    flags.add('mime');
  }
  if (resource === 'assets' && action === 'download') {
    flags.add('out');
  }
  for (const flag of Object.keys(values)) {
    if (!flags.has(flag)) {
      throw new Error(`--${flag} is not supported for this command`);
    }
  }
  if (resource === 'content' && blockId && action !== 'save') {
    throw new Error('Only content save accepts a block ID');
  }
  if (resource === 'api') {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(action) || !id) {
      throw new Error('Use storypane api METHOD /resource/path');
    }
    if (!['GET', 'HEAD'].includes(action)) {
      confirmed(values);
    }
    if (['GET', 'HEAD'].includes(action) && values.input) {
      throw new Error('Read requests do not accept --input');
    }
    const init = {
      method: action,
      ...(values.input ? { body: await inputFile(values.input) } : {}),
    };
    if (values.out) {
      return download(await api.requestRaw(id, init), values.out);
    }
    return api.request(id, init);
  }
  if (resource === 'assets' && action === 'upload') {
    if (!id || !values.mime) {
      throw new Error('Use storypane assets upload <file> --mime <content-type>');
    }
    const { openAsBlob } = await import('node:fs');
    if (!openAsBlob) {
      throw new Error('Asset uploads require Node.js 22 or later');
    }
    return api.assets.upload(
      await openAsBlob(id, { type: values.mime }),
      basename(id),
      values.input ? await inputFile(values.input) : {},
    );
  }
  if (resource === 'assets' && action === 'download') {
    if (!values.out) {
      throw new Error('Provide --out <file>');
    }
    requireId(id);
    return download(await api.assets.download(id), values.out);
  }
  if (resource === 'content') {
    requireId(id);
    requireId(localeId);
    if (action === 'get') {
      return api.content.get(id, localeId);
    }
    if (action === 'save') {
      requireId(blockId);
      return api.content.saveBlock(id, localeId, blockId, await inputFile(values.input));
    }
    if (action === 'publish' || action === 'command') {
      confirmed(values);
      const input = await inputFile(values.input);
      return action === 'publish'
        ? api.content.publish(id, localeId, input)
        : api.content.command(id, localeId, input);
    }
    throw new Error('Use content get, save, publish, or command');
  }
  if (resource === 'schemas' && action === 'list' && !id) {
    return api.request(
      `/definitions?${new URLSearchParams(Object.entries(values).filter(([key]) => ['offset', 'limit'].includes(key)))}`,
    );
  }
  if (resources.has(resource)) {
    if (!actions[resource].includes(action)) {
      throw new Error(`Supported actions for ${resource}: ${actions[resource].join(', ')}`);
    }
    const singleton = resource === 'space';
    if ((singleton && id) || (['list', 'create'].includes(action) && id)) {
      throw new Error('This action does not accept an ID');
    }
    let path = `/${resource}`;
    if (!singleton && !['list', 'create'].includes(action)) {
      path += `/${requireId(id)}`;
      if (resource === 'stories' && action === 'update') {
        path += '/location';
      }
    }
    if (action === 'list' || action === 'get') {
      const query = new URLSearchParams();
      if (values.offset !== undefined) {
        query.set('offset', values.offset);
      }
      if (values.cursor !== undefined) {
        query.set('cursor', values.cursor);
      }
      if (values.limit !== undefined) {
        query.set('limit', values.limit);
      }
      return api.request(`${path}?${query}`);
    }
    if (action === 'create' || action === 'update') {
      return api.request(path, {
        method: action === 'create' ? 'POST' : resource === 'assets' ? 'PATCH' : 'PUT',
        body: await inputFile(values.input),
      });
    }
    if (action === 'delete') {
      confirmed(values);
      return api.request(path, {
        method: 'DELETE',
        body: values.input ? await inputFile(values.input) : {},
      });
    }
  }
  throw new Error('Unsupported action; use storypane --help or storypane api for other operations');
}
