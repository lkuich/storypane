'use client';

import { useState } from 'react';
import type { LocaleSnapshot, PageEditor } from '@storypane/core';

function Avatar({ editor, currentUserId }: { editor: PageEditor; currentUserId?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const description = `${editor.name}${editor.userId === currentUserId ? ' (you)' : ''} · Editing ${editor.locales.join(', ')}`;
  const initials = editor.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (
    <span className="editor-avatar" role="img" aria-label={description} title={description}>
      {editor.avatarUrl && failed !== editor.avatarUrl ? (
        <img
          src={editor.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(editor.avatarUrl)}
        />
      ) : (
        <span aria-hidden="true">{initials || '?'}</span>
      )}
    </span>
  );
}
export function EditorAvatars({
  editors,
  currentUserId,
}: {
  editors: PageEditor[];
  currentUserId?: string;
}) {
  if (!editors.length) return null;
  return (
    <span className="editor-avatars" role="group" aria-label="Currently editing">
      {editors.slice(0, 4).map((editor) => (
        <Avatar key={editor.userId} editor={editor} currentUserId={currentUserId} />
      ))}
      {editors.length > 4 && (
        <span
          className="editor-avatar editor-avatar-more"
          title={editors
            .slice(4)
            .map((editor) => `${editor.name} · ${editor.locales.join(', ')}`)
            .join('\n')}
          aria-label={`${editors.length - 4} more editors`}
        >
          +{editors.length - 4}
        </span>
      )}
    </span>
  );
}

export function BlockEditorAvatar({
  blockId,
  snapshot,
  editors,
  currentUserId,
}: {
  blockId: string;
  snapshot: LocaleSnapshot;
  editors: PageEditor[];
  currentUserId?: string;
}) {
  const lease = snapshot.leases.find(
    (item) => item.blockId === blockId && Date.parse(item.expiresAt) > Date.now(),
  );
  const editor = editors.find((item) => item.userId === lease?.userId);
  if (!editor) return null;
  return (
    <EditorAvatars
      editors={[{ ...editor, locales: [snapshot.locale.name] }]}
      currentUserId={currentUserId}
    />
  );
}
