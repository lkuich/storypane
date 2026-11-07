'use client';
import { useState, type ComponentProps } from 'react';
import { Button, Field, Modal } from '@storypane/ui';
import { BlockNavigation, blockSummary, blockTitle, definitionFor } from './block-navigation';
import { FieldInput } from './field-input';
import { PreviewPanel } from './preview-panel';

export function ReleaseStoryView({
  previewOpen,
  ...preview
}: Omit<ComponentProps<typeof PreviewPanel>, 'selectedId' | 'onSelect'> & {
  previewOpen: boolean;
}) {
  const { snapshot } = preview;
  const [selectedId, setSelectedId] = useState(snapshot.locale.rootBlockId);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const block = snapshot.blocks.find((item) => item.id === selectedId) ?? snapshot.blocks[0];
  const definition = block && definitionFor(snapshot, block);
  async function select(id: string) {
    setSelectedId(id);
    setOutlineOpen(false);
  }
  return (
    <div
      className={
        previewOpen && !snapshot.story.formOnly && snapshot.access?.preview !== false
          ? 'visual-workspace'
          : undefined
      }
    >
      {previewOpen && !snapshot.story.formOnly && snapshot.access?.preview !== false && (
        <div className="story-preview-column">
          <PreviewPanel {...preview} selectedId={block?.id ?? null} onSelect={select} />
        </div>
      )}
      <div
        className="editor-layout"
        id="locale-editor"
        role="tabpanel"
        aria-labelledby={`locale-tab-${snapshot.locale.spaceLocaleId}`}
      >
        <section className="panel editor-panel" aria-label="Block editor">
          <BlockNavigation
            snapshot={snapshot}
            selectedId={block?.id ?? null}
            editors={[]}
            currentUserId=""
            onSelect={select}
            onOutline={() => setOutlineOpen(true)}
          />
          {block && definition && (
            <>
              <div className="editor-panel-heading">
                <div>
                  <h2>{definition.displayName}</h2>
                  <p>Approved release version · Read-only</p>
                </div>
              </div>
              <div className="panel-body">
                {definition.fields.map((field) =>
                  field.type === 'blocks' ? (
                    <Field key={field.name} label={field.label}>
                      <div className="block-list">
                        {snapshot.blocks
                          .filter(
                            (child) =>
                              child.parentId === block.id && child.parentField === field.name,
                          )
                          .sort((a, b) => a.position - b.position)
                          .map((child) => (
                            <Button
                              key={child.id}
                              variant="ghost"
                              onClick={() => void select(child.id)}
                            >
                              {blockTitle(snapshot, child)}
                              {blockSummary(child) ? ` · ${blockSummary(child)}` : ''}
                            </Button>
                          ))}
                      </div>
                    </Field>
                  ) : (
                    <FieldInput
                      key={`${block.id}:${field.name}`}
                      field={field}
                      value={block.fields[field.name]}
                      disabled
                      onChange={() => undefined}
                    />
                  ),
                )}
              </div>
              <div className="editor-footer">
                <span>Approved revision {snapshot.revision}</span>
                <span>Later draft edits are not included</span>
              </div>
            </>
          )}
        </section>
      </div>
      <Modal
        open={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        title="Story outline"
        description="Read-only release blocks"
      >
        <div className="block-list">
          {snapshot.blocks.map((item) => (
            <Button key={item.id} variant="ghost" onClick={() => void select(item.id)}>
              {blockTitle(snapshot, item)} · {blockSummary(item)}
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
