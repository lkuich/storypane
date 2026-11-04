import { useStorypaneStory } from "@storypane/sdk/react";
import type { StorypaneStory } from "@storypane/sdk";
import {
  storypaneMigrationVersion,
  type StorypaneContentType,
} from "../types/storypane";
import { Content } from "./blocks";
import { storyReferences,type SiteReferences } from "../lib/content";

export default function Story({
  initial,
  cmsUrl,
  spaceId,
  references,
  previewParameter = 'blok_preview',
  previewEnabled,
  framework,
}: {
  initial: StorypaneStory<StorypaneContentType>;
  cmsUrl: string;
  spaceId: string;
  references: SiteReferences;
  previewParameter?: string;
  previewEnabled?: string;
  framework?: 'Astro' | 'Next.js';
}) {
  const { story, status, error } = useStorypaneStory(initial, {
    cmsUrl,
    spaceId,
    migrationVersion: storypaneMigrationVersion,
    mode: {
      query: {
        name: previewParameter,
        value: "1",
      },
      cookie: { name: "blok_preview", value: "1" },
      env: previewEnabled,
    },
  });
  return (
    <>
      {status !== "disabled" && (
        <div className="preview-status" role="status">
          {error?.message ||
            (status === "connected"
              ? "Live preview"
              : "Connecting to Storypane…")}
        </div>
      )}
      <Content block={story.content} references={storyReferences(story,references)} cmsUrl={cmsUrl} spaceId={spaceId} framework={framework} preview={status === "connected" || status === "reconnecting"} />
    </>
  );
}
