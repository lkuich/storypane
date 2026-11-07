import { describe, expect, it } from 'vitest';
import { rowDigest, assertDisposableRailway } from './fixtures/recovery-data';
const context = {
  createdBy: 'storypane-operational-tests',
  projectId: 'fixture',
  origin: 'https://fixture.up.railway.app',
  serviceId: '11111111-1111-4111-8111-111111111111',
  environmentId: '22222222-2222-4222-8222-222222222222',
};
const project = { id: 'fixture', name: 'storypane-regression-2026-11-07' };
describe('recovery evidence and destructive-test boundaries', () => {
  it('compares rows independently of database collation and JSON property order', () => {
    expect(rowDigest([{ b: 2, a: 1 }, { name: 'Z' }, { name: 'a' }])).toBe(
      rowDigest([{ name: 'a' }, { a: 1, b: 2 }, { name: 'Z' }]),
    );
  });
  it('detects missing, duplicated and changed rows', () => {
    const original = rowDigest([{ id: 1 }, { id: 2 }]);
    for (const rows of [[{ id: 1 }], [{ id: 1 }, { id: 2 }, { id: 2 }], [{ id: 1 }, { id: 3 }]])
      expect(rowDigest(rows)).not.toBe(original);
  });
  it('preserves nested content order and scalar types', () => {
    expect(rowDigest([{ content: [1, 2] }])).not.toBe(rowDigest([{ content: [2, 1] }]));
    expect(rowDigest([{ value: 1 }])).not.toBe(rowDigest([{ value: '1' }]));
  });
  it('accepts only the explicitly identified disposable Railway project', () =>
    expect(() => assertDisposableRailway(context, project)).not.toThrow());
  it.each([
    [{ ...context, createdBy: 'other' }, project],
    [context, { ...project, id: 'other' }],
    [context, { ...project, name: 'production' }],
    [{ ...context, origin: 'https://production.example.com' }, project],
    [{ ...context, origin: 'http://fixture.up.railway.app' }, project],
    [{ ...context, origin: 'https://fixture.up.railway.app/extra' }, project],
  ])('rejects an unrelated target', (target, selected) =>
    expect(() => assertDisposableRailway(target, selected)).toThrow(),
  );
});
