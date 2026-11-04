import { expect, it, vi } from 'vitest';
import { readMigratedStorage, writeMigratedStorage } from './storage-migration';
import { themeInitialization } from './theme';

function storageFor(values: Record<string, string>): Storage {
  return {
    get length() {
      return Object.keys(values).length;
    },
    key: (index) => Object.keys(values)[index] ?? null,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    },
    clear: () => {
      for (const key of Object.keys(values)) {
        delete values[key];
      }
    },
  };
}

it.each(['theme', 'drafts:user:space:story:locale', 'drafts:user:space:story:locale:command'])(
  'moves %s to the new key without losing its value',
  (suffix) => {
    const storage = storageFor({ [`blok:${suffix}`]: 'saved data' });
    expect(readMigratedStorage(storage, `storypane:${suffix}`)).toBe('saved data');
    expect(storage.getItem(`storypane:${suffix}`)).toBe('saved data');
    expect(storage.getItem(`blok:${suffix}`)).toBeNull();
    writeMigratedStorage(storage, `storypane:${suffix}`, null);
    expect(readMigratedStorage(storage, `storypane:${suffix}`)).toBeNull();
  },
);

it('keeps the newer value when both keys exist', () => {
  const storage = storageFor({ 'blok:theme': 'dark', 'storypane:theme': 'light' });
  expect(readMigratedStorage(storage, 'storypane:theme')).toBe('light');
  expect(storage.getItem('blok:theme')).toBeNull();
});

it('recovers drafts even when a full storage prevents copying, and clears them after saving', () => {
  const storage = storageFor({ 'blok:drafts:user:space:story:locale': 'unsent changes' });
  const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  const key = 'storypane:drafts:user:space:story:locale';
  expect(readMigratedStorage(storage, key)).toBe('unsent changes');
  expect(storage.getItem('blok:drafts:user:space:story:locale')).toBe('unsent changes');
  expect(() => writeMigratedStorage(storage, key, 'new unsent changes')).toThrow('Quota');
  write.mockRestore();
  writeMigratedStorage(storage, key, null);
  expect(readMigratedStorage(storage, key)).toBeNull();
});

it('applies and migrates the saved theme before hydration', () => {
  const localStorage = storageFor({ 'blok:theme': 'dark' });
  const document = { documentElement: { dataset: { theme: '' } } };
  new Function('localStorage', 'document', themeInitialization)(localStorage, document);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('storypane:theme')).toBe('dark');
});
