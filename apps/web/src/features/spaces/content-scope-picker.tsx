'use client';

import { useState } from 'react';
import {
  type BlockDefinition,
  type ContentFolder,
  type ContentScope,
  type ContentScopes,
  type SpaceLocale,
  type Story,
  folderPath,
} from '@storypane/core';

type Choice = { value: string; label: string };
function Selection({
  label,
  choices,
  selected,
  onChange,
}: {
  label: string;
  choices: Choice[];
  selected: string[] | null;
  onChange: (value: string[] | null) => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <fieldset className="role-permissions">
      <legend>{label}</legend>
      <label>
        <input
          type="checkbox"
          checked={selected === null}
          onChange={(event) => onChange(event.target.checked ? null : [])}
        />
        All {label.toLowerCase()}
      </label>
      {selected !== null && (
        <>
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {choices
              .filter((choice) => choice.label.toLowerCase().includes(query.toLowerCase()))
              .map((choice) => (
                <label key={choice.value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(choice.value)}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selected, choice.value]
                          : selected.filter((value) => value !== choice.value),
                      )
                    }
                  />
                  {choice.label}
                </label>
              ))}
          </div>
          <p className="field-hint">
            {selected.length
              ? `${selected.length} selected`
              : 'Nothing selected: access is denied in this dimension.'}
          </p>
        </>
      )}
    </fieldset>
  );
}

export function ContentScopePicker({
  value,
  onChange,
  folders,
  stories,
  locales,
  definitions,
  enabled,
}: {
  value: ContentScopes;
  onChange: (value: ContentScopes) => void;
  folders: ContentFolder[];
  stories: Story[];
  locales: SpaceLocale[];
  definitions: BlockDefinition[];
  enabled: string[];
}) {
  const [action, setAction] = useState<'read' | 'edit' | 'publish'>('read');
  const scope = value[action];
  const update = (patch: Partial<ContentScope>) =>
    onChange({ ...value, [action]: { ...scope, ...patch } });
  return (
    <section aria-label="Content access scopes">
      <label className="field">
        Configure access for
        <select value={action} onChange={(event) => setAction(event.target.value as typeof action)}>
          <option value="read">Reading</option>
          <option value="edit">Editing</option>
          <option value="publish">Publishing</option>
        </select>
      </label>
      {!enabled.includes(`content:${action}`) && (
        <p className="notice">
          This capability is disabled above. Its scope grants no access until enabled.
        </p>
      )}
      {!enabled.includes('content:read') && (
        <p className="notice">
          Content read is disabled. Editing and publishing grants are ineffective until read access
          is enabled.
        </p>
      )}
      <p className="field-hint">
        Locations match any selected folder subtree or story. Locale, block, and field restrictions
        must also match. Editing and publishing also require read access.
      </p>
      <Selection
        label="Locations"
        choices={[
          { value: 'folder:root', label: 'Space root and all descendants' },
          ...folders.map((folder) => ({
            value: `folder:${folder.id}`,
            label: `Folder: /${folderPath(folders, folder.id)}`,
          })),
          ...stories.map((story) => ({
            value: `story:${story.id}`,
            label: `Story: ${story.name} /${story.slug}`,
          })),
        ]}
        selected={
          scope.locations === null
            ? null
            : [
                ...scope.locations.folderIds.map((id) => `folder:${id ?? 'root'}`),
                ...scope.locations.storyIds.map((id) => `story:${id}`),
              ]
        }
        onChange={(selection) =>
          update({
            locations:
              selection === null
                ? null
                : {
                    folderIds: selection
                      .filter((id) => id.startsWith('folder:'))
                      .map((id) => (id.slice(7) === 'root' ? null : id.slice(7))),
                    storyIds: selection
                      .filter((id) => id.startsWith('story:'))
                      .map((id) => id.slice(6)),
                  },
          })
        }
      />
      <Selection
        label="Locales"
        choices={locales.map((locale) => ({ value: locale.id, label: locale.name }))}
        selected={scope.localeIds}
        onChange={(localeIds) => update({ localeIds })}
      />
      <Selection
        label="Block types"
        choices={definitions.map((definition) => ({
          value: definition.id,
          label: definition.displayName,
        }))}
        selected={scope.definitionIds}
        onChange={(definitionIds) => update({ definitionIds })}
      />
      <Selection
        label="Fields"
        choices={definitions.flatMap((definition) =>
          definition.fields
            .filter((field) => !!field.id)
            .map((field) => ({
              value: field.id!,
              label: `${definition.displayName} → ${field.label}`,
            })),
        )}
        selected={scope.fieldIds}
        onChange={(fieldIds) => update({ fieldIds })}
      />
      <p className="field-hint">
        Publishing applies to the entire locale. Restricting publish fields can prevent publication
        until another authorized role publishes it.
      </p>
    </section>
  );
}
