'use client';

import { lazy, Suspense, useState } from 'react';
import { ChevronRight, Network } from 'lucide-react';
import { Loading } from '@storypane/ui';
import type { Story } from '@storypane/core';

const PageMap = lazy(() => import('./page-map'));

export function PageMapPanel({
  storyId,
  locale,
  onOpen,
}: {
  storyId: string;
  locale: string;
  onOpen: (story: Story, locale?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="panel page-map-panel"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>
          <Network aria-hidden="true" /> Page map
        </span>
        <ChevronRight aria-hidden="true" />
      </summary>
      {expanded && (
        <Suspense fallback={<Loading label="Loading page map…" />}>
          <PageMap root={storyId} locale={locale} onOpen={onOpen} />
        </Suspense>
      )}
    </details>
  );
}
