/** Advisory only: an outdated application must still receive its content. */
export function migrationWarning(expected: number | undefined) {
  let last: string | undefined;
  return (actual: unknown) => {
    if (typeof actual === 'number' && actual === expected) return;
    const key = `${expected ?? 'untracked'}:${actual ?? 'unknown'}`;
    if (last === key) return;
    last = key;
    console.warn(
      `[Storypane] Schema migration mismatch: local ${expected ?? 'untracked'}, received ${actual ?? 'unknown'}. Content is still returned. Run storypane migrations pull and storypane generate-types, then rebuild your application.`,
    );
  };
}
