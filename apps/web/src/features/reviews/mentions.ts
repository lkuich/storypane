export type Mention = { id: string; start: number; end: number };
export type MentionQuery = { start: number; end: number; text: string };
const boundary = (character: string | undefined) => !character || /[\s([{,;:]/u.test(character);

export function mentionQuery(
  value: string,
  start: number,
  end: number,
  mentions: Mention[],
): MentionQuery | null {
  if (start !== end || start === 0) return null;
  const at = value.lastIndexOf('@', start - 1);
  if (at < 0 || !boundary(value[at - 1]) || mentions.some((mention) => mention.start === at))
    return null;
  const text = value.slice(at + 1, start);
  if (/^\s|[\r\n]/u.test(text) || text.length > 120) return null;
  return { start: at, end: start, text };
}

export function updateMentions(
  previous: string,
  value: string,
  mentions: Mention[],
  selection?: { start: number; end: number },
): Mention[] {
  let start = 0,
    suffix = 0;
  while (
    start < (selection?.start ?? previous.length) &&
    start < value.length &&
    previous[start] === value[start]
  )
    start++;
  while (
    suffix < Math.min(previous.length - start, previous.length - (selection?.end ?? start)) &&
    suffix < value.length - start &&
    previous[previous.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix++;
  const end = previous.length - suffix;
  const delta = value.length - previous.length;
  return mentions.flatMap((mention) => {
    const next =
      mention.end <= start
        ? mention
        : mention.start >= end
          ? { ...mention, start: mention.start + delta, end: mention.end + delta }
          : null;
    return next &&
      boundary(value[next.start - 1]) &&
      (!value[next.end] || !/^[\p{L}\p{N}_@-]/u.test(value.slice(next.end)))
      ? [next]
      : [];
  });
}

export function insertMention(
  value: string,
  mentions: Mention[],
  query: MentionQuery,
  member: { id: string; name: string },
) {
  const token = `@${member.name}`;
  const following = value[query.end];
  const space =
    !following || (!/\s/u.test(following) && !'.,!?;:)]}'.includes(following)) ? ' ' : '';
  const next = value.slice(0, query.start) + token + space + value.slice(query.end);
  if (next.length > 10000) return null;
  const mention = { id: member.id, start: query.start, end: query.start + token.length };
  return {
    value: next,
    mentions: [...updateMentions(value, next, mentions, query), mention].sort(
      (a, b) => a.start - b.start,
    ),
    caret: mention.end + (space || following === ' ' ? 1 : 0),
  };
}
