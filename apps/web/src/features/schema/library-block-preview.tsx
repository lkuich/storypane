'use client';

import { useEffect, useState } from 'react';
import type {
  BlockDefinition,
  LocaleSnapshot,
  StoryLocale,
  StorySummary,
  UserDeliverySettings,
} from '@storypane/core';
import { ErrorNotice } from '@storypane/ui';
import { api, errorMessage } from '../editor/api';
import { BlockPreview } from '../editor/block-preview';

export function LibraryBlockPreview({
  definitions,
  spaceId,
}: {
  definitions: BlockDefinition[];
  spaceId: string;
}) {
  const [settings, setSettings] = useState<UserDeliverySettings | null>(null);
  const [snapshot, setSnapshot] = useState<LocaleSnapshot | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    async function load() {
      const value = await api<UserDeliverySettings>('/delivery-settings');
      if (stopped) return;
      setSettings(value);
      if (!value.blockLibraryPreviews || !value.previewUrls.length) return;
      // Reuse an authorized story context so preview sessions retain content scopes.
      const stories = await api<StorySummary[]>('/stories');
      for (const story of stories.filter((item) => !item.formOnly)) {
        const locales = await api<StoryLocale[]>(`/stories/${story.id}/locales`);
        for (const locale of locales) {
          if (stopped) return;
          const candidate = await api<LocaleSnapshot>(`/stories/${story.id}/locales/${locale.id}`);
          if (candidate.access?.preview === false) continue;
          if (!stopped) setSnapshot(candidate);
          return;
        }
      }
    }
    void load().catch((cause) => {
      if (!stopped) setError(`Block previews unavailable: ${errorMessage(cause)}`);
    });
    return () => {
      stopped = true;
    };
  }, [spaceId]);
  return (
    <>
      <ErrorNotice message={error} />
      {snapshot && settings?.blockLibraryPreviews && (
        <BlockPreview
          definitions={definitions}
          editorEnabled={false}
          settings={settings}
          onSettings={setSettings}
          previewId={previewId}
          onPreviewId={setPreviewId}
          snapshot={snapshot}
          spaceId={spaceId}
        />
      )}
    </>
  );
}
