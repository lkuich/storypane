import { describe, expect, it } from "vitest";
import {
  acknowledgeBuffer,
  editBuffer,
  localDatetime,
  readBuffers,
  readPendingCommand,
  utcDatetime,
} from "./draft-buffer";
import type { BlockDraft } from "@storypane/core";

const block: BlockDraft = {
  id: "hero",
  definitionId: "hero-definition",
  schemaVersionId: "v1",
  parentId: "root",
  parentField: "body",
  position: 0,
  revision: 4,
  fields: { title: "Original", subtitle: "Keep me" },
};

describe("pending editor input", () => {
  it("recovers the exact structural mutation so retries cannot duplicate an import", () => {
    const command = {
      type: "importBlocks",
      mutationId: "9baf367c-084d-4d42-984e-9cec25e7e822",
      expectedRevisions: { "01234567-89ab-4def-8012-3456789abcde": 7 },
      leaseTokens: { "01234567-89ab-4def-8012-3456789abcde": "lease-token" },
      payload: {
        sourceLocaleId: "31234567-89ab-4def-8012-3456789abcde",
        blockIds: ["11234567-89ab-4def-8012-3456789abcde"],
        parentId: "01234567-89ab-4def-8012-3456789abcde",
        parentField: "body",
      },
    };
    expect(readPendingCommand(JSON.stringify(command))).toEqual(command);
    expect(readPendingCommand('{"type":"unknown"}')).toBeNull();
  });
  it("keeps input typed during a save and rebases it on the committed revision", () => {
    const sent = editBuffer(undefined, block, "title", "First");
    const later = editBuffer(sent, block, "title", "Second");
    const pending = acknowledgeBuffer(later, sent.generation, 5);
    expect(pending).toEqual({
      baseRevision: 5,
      generation: 2,
      fields: { title: "Second", subtitle: "Keep me" },
    });
    expect(acknowledgeBuffer(pending!, 2, 6)).toBeNull();
  });
  it("does not silently change the base revision when unrelated snapshots arrive", () => {
    const pending = editBuffer(undefined, block, "title", "Mine");
    expect(
      editBuffer(pending, { ...block, revision: 9 }, "subtitle", "Also mine")
        .baseRevision,
    ).toBe(4);
  });
  it("recovers valid buffers and rejects corrupt storage", () => {
    const pending = editBuffer(undefined, block, "title", "Recovered");
    expect(
      readBuffers(
        JSON.stringify({ hero: pending, malformed: { fields: null } }),
      ),
    ).toEqual({ hero: pending });
    expect(readBuffers("{broken")).toEqual({});
    expect(readBuffers("[]")).toEqual({});
  });
  it("round trips displayed local timestamps without changing their instant", () => {
    const iso = "2026-07-04T16:25:00.000Z";
    expect(utcDatetime(localDatetime(iso))).toBe(iso);
    expect(utcDatetime("")).toBeNull();
    expect(localDatetime("invalid")).toBe("");
  });
});
