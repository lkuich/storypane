import { describe, expect, it } from 'vitest';
import { can, contentScopesSchema, locationAllowed, type ContentAccess } from './index.js';

function editor(): ContentAccess {
  return {
    admin: false,
    permissions: ['content:read', 'content:edit', 'content:publish'],
    scopes: contentScopesSchema.parse({}),
    folders: [
      { id: 'blog', parentId: null },
      { id: 'child', parentId: 'blog' },
      { id: 'private', parentId: null },
    ],
  };
}

describe('content scope policy', () => {
  it('unions explicit stories with real folder ancestry, then intersects locales', () => {
    const access = editor();
    access.scopes.edit.locations = { folderIds: ['blog'], storyIds: ['exception'] };
    access.scopes.edit.localeIds = ['fr'];
    expect(
      locationAllowed(
        access,
        { storyId: 'post', folderId: 'child', spaceLocaleId: 'fr' },
        'content:edit',
      ),
    ).toBe(true);
    expect(
      locationAllowed(
        access,
        { storyId: 'exception', folderId: 'private', spaceLocaleId: 'fr' },
        'content:edit',
      ),
    ).toBe(true);
    expect(
      locationAllowed(
        access,
        { storyId: 'exception', folderId: 'private', spaceLocaleId: 'en' },
        'content:edit',
      ),
    ).toBe(false);
    expect(
      locationAllowed(
        access,
        { storyId: 'post', folderId: 'private', spaceLocaleId: 'fr' },
        'content:edit',
      ),
    ).toBe(false);
    access.scopes.read.locations = { folderIds: ['blog'], storyIds: [] };
    expect(
      locationAllowed(
        access,
        { storyId: 'exception', folderId: 'private', spaceLocaleId: 'fr' },
        'content:edit',
      ),
    ).toBe(false);
  });
  it('fails closed for empty dimensions and removed or cyclic folders', () => {
    const access = editor(),
      target = { storyId: 'post', folderId: 'child', spaceLocaleId: 'fr' };
    access.scopes.read.locations = { folderIds: ['blog'], storyIds: [] };
    access.folders = access.folders.filter((folder) => folder.id !== 'blog');
    expect(locationAllowed(access, target, 'content:read')).toBe(false);
    access.folders = [{ id: 'child', parentId: 'child' }];
    expect(locationAllowed(access, target, 'content:read')).toBe(false);
    access.scopes.read.locations = null;
    for (const dimension of ['localeIds', 'definitionIds', 'fieldIds'] as const) {
      access.scopes.read[dimension] = [];
      expect(locationAllowed(access, target, 'content:read')).toBe(false);
      access.scopes.read[dimension] = null;
    }
  });
  it('hides credential and schema controls when scoped reading cannot support them', () => {
    const contentScopes = contentScopesSchema.parse({});
    const space = {
      permissions: ['content:read', 'content:edit', 'settings:write', 'schemas:write'] as const,
      contentScopes,
    };
    expect(can(space, 'settings:write')).toBe(true);
    contentScopes.read.fieldIds = ['allowed'];
    expect(can(space, 'content:edit')).toBe(true);
    expect(can(space, 'settings:write')).toBe(false);
    expect(can(space, 'schemas:write')).toBe(false);
    expect(can({ permissions: ['content:edit'], contentScopes }, 'content:edit')).toBe(false);
  });
});
