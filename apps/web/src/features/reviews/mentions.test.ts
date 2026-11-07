import { describe, expect, it } from 'vitest';
import { insertMention, mentionQuery, updateMentions, type Mention } from './mentions';
const bob = { id: 'bob', name: 'Bob Reviewer' };
const value = 'Ask @Bob Reviewer about this.';
const mention: Mention = { id: bob.id, start: 4, end: 17 };

describe('inline mentions', () => {
  it('finds a mention at the caret, including multiword names, without eating following text', () => {
    expect(mentionQuery('Ask @Bob Re about this.', 11, 11, [])).toEqual({
      start: 4,
      end: 11,
      text: 'Bob Re',
    });
    expect(mentionQuery('@', 1, 1, [])).toEqual({ start: 0, end: 1, text: '' });
    expect(mentionQuery('(@bo', 4, 4, [])).toEqual({ start: 1, end: 4, text: 'bo' });
  });
  it('ignores email addresses, selections, line breaks, committed mentions and a caret before @', () => {
    for (const [text, start, end, mentions] of [
      ['bob@example.test', 16, 16, []],
      ['@bob', 0, 0, []],
      ['@bob', 1, 4, []],
      ['@bob\nreply', 10, 10, []],
      ['@ bob', 5, 5, []],
      [value, 17, 17, [mention]],
    ] as [string, number, number, Mention[]][])
      expect(mentionQuery(text, start, end, mentions)).toBeNull();
  });
  it('inserts the selected person, keeps the suffix, and leaves the caret after one space', () => {
    expect(insertMention('Ask @bo about this.', [], { start: 4, end: 7, text: 'bo' }, bob)).toEqual(
      {
        value,
        mentions: [mention],
        caret: 18,
      },
    );
    expect(insertMention('Ask @bo', [], { start: 4, end: 7, text: 'bo' }, bob)?.value).toBe(
      'Ask @Bob Reviewer ',
    );
    expect(insertMention('@bo, thanks.', [], { start: 0, end: 3, text: 'bo' }, bob)?.value).toBe(
      '@Bob Reviewer, thanks.',
    );
  });
  it('shifts mentions after an edit while preserving edits elsewhere', () => {
    expect(updateMentions(value, 'Please ' + value, [mention], { start: 0, end: 0 })).toEqual([
      { ...mention, start: 11, end: 24 },
    ]);
    expect(updateMentions(value, value + ' Thanks!', [mention])).toEqual([mention]);
  });
  it('removes the recipient if a mention is edited, deleted, or made part of another word', () => {
    expect(updateMentions(value, value.replace('Bob', 'Bo'), [mention])).toEqual([]);
    expect(updateMentions(value, 'Ask about this.', [mention])).toEqual([]);
    expect(updateMentions(value, value.replace('Reviewer', 'ReviewerX'), [mention])).toEqual([]);
    expect(updateMentions(value, value.replace('@', 'x@'), [mention])).toEqual([]);
  });
  it('distinguishes people with identical names when one occurrence is deleted', () => {
    const text = '@Alex @Alex';
    const mentions = [
      { id: 'first', start: 0, end: 5 },
      { id: 'second', start: 6, end: 11 },
    ];
    expect(updateMentions(text, '@Alex', mentions, { start: 0, end: 6 })).toEqual([
      { id: 'second', start: 0, end: 5 },
    ]);
    expect(updateMentions(text, '@Alex', mentions, { start: 5, end: 11 })).toEqual([
      { id: 'first', start: 0, end: 5 },
    ]);
    expect(updateMentions(text, text, mentions, { start: 0, end: text.length })).toEqual([]);
  });
  it('keeps multiple occurrences and moves existing mentions when another is inserted before them', () => {
    const before = '@ca ' + value;
    const shifted = { ...mention, start: 8, end: 21 };
    const result = insertMention(
      before,
      [shifted],
      { start: 0, end: 3, text: 'ca' },
      { id: 'cara', name: 'Cara' },
    )!;
    expect(result.value).toBe('@Cara ' + value);
    expect(result.mentions).toEqual([
      { id: 'cara', start: 0, end: 5 },
      { ...mention, start: 10, end: 23 },
    ]);
  });
  it('uses browser caret offsets for names containing Unicode and does not exceed the message limit', () => {
    const result = insertMention(
      '@zo',
      [],
      { start: 0, end: 3, text: 'zo' },
      { id: 'zoe', name: 'Zoë 👩🏽‍💻' },
    )!;
    expect(result.caret).toBe(result.value.length);
    expect(
      updateMentions(result.value, 'Hi ' + result.value, result.mentions, { start: 0, end: 0 })[0]
        .start,
    ).toBe(3);
    const long = 'x'.repeat(9997) + ' @';
    expect(insertMention(long, [], { start: 9998, end: 9999, text: '' }, bob)).toBeNull();
  });
});
