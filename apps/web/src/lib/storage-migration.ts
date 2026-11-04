// Historical keys are only used to recover data saved before the rename.
export function readMigratedStorage(storage: Storage, key: string): string | null {
  const legacyKey = key.replace(/^storypane:/, 'blok:');
  const value = storage.getItem(key) ?? storage.getItem(legacyKey);
  if (value !== null && storage.getItem(legacyKey) !== null) {
    try {
      storage.setItem(key, value);
      storage.removeItem(legacyKey);
    } catch {
      // Recovery still works when storage is full; retain the original backup.
    }
  }
  return value;
}

export function writeMigratedStorage(storage: Storage, key: string, value: string | null): void {
  if (value === null) {
    storage.removeItem(key);
  } else {
    storage.setItem(key, value);
  }
  storage.removeItem(key.replace(/^storypane:/, 'blok:'));
}
