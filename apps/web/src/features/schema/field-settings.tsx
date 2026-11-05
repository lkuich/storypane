'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  BlockDefinition,
  Datasource,
  FieldDefinition,
  Json,
  OptionSource,
} from '@storypane/core';
import { Button, Field } from '@storypane/ui';
import { FieldTypePicker, choiceForField } from './field-type-picker';
import { BlockRestrictions } from './block-restrictions';

export function newField(
  type: FieldDefinition['type'],
  name: string,
  label: string,
): FieldDefinition {
  const base = { name, label, required: false };
  switch (type) {
    case 'text':
      return { ...base, type, format: 'singleline' };
    case 'datetime':
      return { ...base, type, mode: 'datetime' };
    case 'boolean':
      return { ...base, type, defaultValue: false };
    case 'option':
    case 'options':
      return { ...base, type, source: { type: 'inline', items: [] } };
    default:
      return { ...base, type };
  }
}

function optionalNumber(value: string) {
  return value === '' ? undefined : Number(value);
}

export function SourceSettings({
  source,
  onChange,
  datasources,
  definitions,
  definitionId,
}: {
  source: OptionSource;
  onChange: (source: OptionSource) => void;
  datasources: Datasource[];
  definitions: BlockDefinition[];
  definitionId?: string;
}) {
  const [nestedFilter, setNestedFilter] = useState<boolean | null>(null);
  const contentTypes = definitions.filter((item) => item.kind !== 'nestable');
  const nested = contentTypes.filter(
    (item) => definitionId && item.parentDefinitionId === definitionId,
  );
  const selected = source.type === 'stories' ? source.contentTypeId : undefined;
  const selectedOutsideNested = contentTypes.find(
    (item) => item.id === selected && !nested.some((child) => child.id === item.id),
  );
  const onlyNested = nestedFilter ?? (nested.length > 0 && !selectedOutsideNested);
  function changeType(type: OptionSource['type']) {
    setNestedFilter(null);
    if (type === 'inline') onChange({ type, items: [] });
    if (type === 'datasource') onChange({ type, datasourceId: datasources[0]?.id ?? '' });
    if (type === 'external') onChange({ type, url: '' });
    if (type === 'stories') onChange({ type });
  }
  return (
    <div className="option-editor">
      <Field label="Option source" htmlFor="option-source">
        <select
          id="option-source"
          value={source.type}
          onChange={(event) => changeType(event.target.value as OptionSource['type'])}
        >
          <option value="inline">Defined here</option>
          <option value="datasource">Managed datasource</option>
          <option value="external">External JSON</option>
          <option value="stories">Stories</option>
        </select>
      </Field>
      {source.type === 'inline' && (
        <>
          <div className="field-label" style={{ marginBottom: 8 }}>
            Label / value
          </div>
          {source.items.map((item, index) => (
            <div className="key-value-grid" key={index}>
              <input
                aria-label={`Option ${index + 1} label`}
                placeholder="Label"
                value={item.label}
                onChange={(event) =>
                  onChange({
                    ...source,
                    items: source.items.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                aria-label={`Option ${index + 1} value`}
                placeholder="Value"
                value={item.value}
                onChange={(event) =>
                  onChange({
                    ...source,
                    items: source.items.map((item, i) =>
                      i === index ? { ...item, value: event.target.value } : item,
                    ),
                  })
                }
              />
              <Button
                variant="ghost"
                className="icon-button"
                aria-label={`Remove option ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...source,
                    items: source.items.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              onChange({
                ...source,
                items: [...source.items, { label: '', value: '' }],
              })
            }
          >
            <Plus /> Add option
          </Button>
        </>
      )}
      {source.type === 'datasource' && (
        <Field label="Datasource" htmlFor="source-datasource">
          <select
            id="source-datasource"
            value={source.datasourceId}
            onChange={(event) => onChange({ ...source, datasourceId: event.target.value })}
          >
            <option value="">Choose a datasource…</option>
            {datasources.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {!datasources.length && (
            <p className="field-hint">Create a datasource in the Datasources tab first.</p>
          )}
        </Field>
      )}
      {source.type === 'external' && (
        <>
          <Field
            label="JSON endpoint"
            htmlFor="source-url"
            description={
              'Expected response: {"items":[{"value":"key","label":"Label"}]}. Public HTTPS endpoints only.'
            }
          >
            <input
              id="source-url"
              type="url"
              placeholder="https://example.com/options.json"
              value={source.url}
              onChange={(event) => onChange({ ...source, url: event.target.value })}
            />
          </Field>
          <div className="field">
            <span className="field-label">Request headers</span>
            {(source.headers ?? []).map((header, index) => (
              <div className="key-value-grid" key={index}>
                <input
                  aria-label={`Header ${index + 1} name`}
                  placeholder="Header name"
                  maxLength={100}
                  value={header.name}
                  onChange={(event) =>
                    onChange({
                      ...source,
                      headers: source.headers!.map((item, i) =>
                        i === index ? { ...item, name: event.target.value } : item,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Header ${index + 1} value`}
                  placeholder="Value"
                  maxLength={2000}
                  value={header.value}
                  onChange={(event) =>
                    onChange({
                      ...source,
                      headers: source.headers!.map((item, i) =>
                        i === index ? { ...item, value: event.target.value } : item,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label={`Remove header ${index + 1}`}
                  onClick={() =>
                    onChange({ ...source, headers: source.headers!.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              className="button--small"
              disabled={(source.headers?.length ?? 0) >= 20}
              onClick={() =>
                onChange({
                  ...source,
                  headers: [...(source.headers ?? []), { name: '', value: '' }],
                })
              }
            >
              <Plus aria-hidden="true" /> Add header
            </Button>
            <p className="field-hint">
              Sent by the CMS server. Values are stored with the block schema and visible to users
              who can read it.
            </p>
          </div>
          <details className="external-option-context">
            <summary>Automatic context headers</summary>
            <p className="field-hint">
              Added when a story field requests options. These headers cannot be overridden. Slug
              values are percent-encoded; decode them at your endpoint.
            </p>
            <dl>
              {[
                ['Space-Id', 'Space ID'],
                ['Story-Id', 'Page ID'],
                ['Story-Slug', 'Localized page slug'],
                ['Locale-Id', 'Story locale ID'],
                ['Locale', 'Locale URL prefix (empty for root)'],
                ['Block-Id', 'Block instance ID'],
                ['Block-Type', 'Block technical name'],
                ['Field', 'Field technical name'],
              ].map(([name, description]) => (
                <div key={name}>
                  <dt>
                    <code>X-Storypane-{name}</code>
                  </dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
      {source.type === 'stories' && (
        <Field label="Restrict to a content type" htmlFor="source-content-type">
          <select
            id="source-content-type"
            value={source.contentTypeId ?? ''}
            onChange={(event) =>
              onChange({
                type: 'stories',
                ...(event.target.value ? { contentTypeId: event.target.value } : {}),
              })
            }
          >
            <option value="">All stories</option>
            {(onlyNested ? nested : contentTypes).map((item) => (
              <option value={item.id} key={item.id}>
                {item.displayName}
              </option>
            ))}
            {onlyNested && selectedOutsideNested && (
              <optgroup label="Current selection (outside nested blocks)">
                <option value={selectedOutsideNested.id}>
                  {selectedOutsideNested.displayName}
                </option>
              </optgroup>
            )}
          </select>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={onlyNested}
              onChange={(event) => setNestedFilter(event.target.checked)}
            />
            Show only directly nested blocks
          </label>
          {onlyNested && !nested.length && (
            <p className="field-hint" role="status">
              No directly nested content types. Uncheck to browse all content types.
            </p>
          )}
        </Field>
      )}
    </div>
  );
}

export function FieldSettings({
  field,
  definitionId,
  onChange,
  definitions,
  datasources,
}: {
  field: FieldDefinition;
  definitionId?: string;
  onChange: (field: FieldDefinition) => void;
  definitions: BlockDefinition[];
  datasources: Datasource[];
}) {
  const update = (patch: object) => onChange({ ...field, ...patch } as FieldDefinition);
  const defaultText = typeof field.defaultValue === 'string' ? field.defaultValue : '';
  return (
    <>
      <div className="field-row">
        <Field label="Label" htmlFor="field-label">
          <input
            id="field-label"
            value={field.label}
            onChange={(event) => update({ label: event.target.value })}
          />
        </Field>
        <Field label="Field name" htmlFor="field-name">
          <input
            id="field-name"
            aria-describedby="field-name-hint"
            autoCapitalize="none"
            spellCheck={false}
            value={field.name}
            onChange={(event) => update({ name: event.target.value })}
          />
          <p id="field-name-hint" className="field-hint">
            Lowercase letters, numbers and underscores only. Start with a letter, e.g. hero_image.
          </p>
        </Field>
      </div>
      <Field label="Description" htmlFor="field-description">
        <textarea
          id="field-description"
          style={{ minHeight: 75 }}
          placeholder="Help editors understand this field…"
          value={field.description ?? ''}
          onChange={(event) => update({ description: event.target.value })}
        />
      </Field>
      <Field label="Field type" htmlFor="field-type">
        <FieldTypePicker
          id="field-type"
          value={choiceForField(field)}
          onChange={(choice) => {
            if (choice.id === choiceForField(field).id) return;
            if (field.type === 'text' && choice.type === 'text') {
              const { defaultValue: _default, ...rest } = field;
              onChange({ ...rest, format: choice.format! });
              return;
            }
            const next = newField(choice.type, field.name, field.label);
            if (next.type === 'text') next.format = choice.format!;
            onChange({
              ...next,
              id: field.id,
              description: field.description,
              required: field.required,
            });
          }}
        />
      </Field>
      <div className="field">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={field.required ?? false}
            onChange={(event) => update({ required: event.target.checked })}
          />{' '}
          Required to publish
        </label>
      </div>
      {field.type === 'text' && (
        <>
          <Field label="Maximum characters" htmlFor="text-max">
            <input
              id="text-max"
              type="number"
              min={1}
              placeholder="No limit"
              value={field.maxLength ?? ''}
              onChange={(event) => update({ maxLength: optionalNumber(event.target.value) })}
            />
          </Field>
          {field.format !== 'richtext' && (
            <Field label="Default value" htmlFor="text-default">
              <textarea
                id="text-default"
                value={defaultText}
                onChange={(event) => update({ defaultValue: event.target.value })}
              />
            </Field>
          )}
        </>
      )}
      {field.type === 'number' && (
        <>
          <div className="field-row">
            <Field label="Minimum" htmlFor="number-min">
              <input
                id="number-min"
                type="number"
                step="any"
                value={field.min ?? ''}
                onChange={(event) => update({ min: optionalNumber(event.target.value) })}
              />
            </Field>
            <Field label="Maximum" htmlFor="number-max">
              <input
                id="number-max"
                type="number"
                step="any"
                value={field.max ?? ''}
                onChange={(event) => update({ max: optionalNumber(event.target.value) })}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Decimal places" htmlFor="number-decimals">
              <input
                id="number-decimals"
                type="number"
                min={0}
                max={15}
                placeholder="Any"
                value={field.decimals ?? ''}
                onChange={(event) => update({ decimals: optionalNumber(event.target.value) })}
              />
            </Field>
            <Field label="Default value" htmlFor="number-default">
              <input
                id="number-default"
                type="number"
                step="any"
                value={typeof field.defaultValue === 'number' ? field.defaultValue : ''}
                onChange={(event) => update({ defaultValue: optionalNumber(event.target.value) })}
              />
            </Field>
          </div>
        </>
      )}
      {field.type === 'datetime' && (
        <Field label="Selection" htmlFor="date-mode">
          <select
            id="date-mode"
            value={field.mode}
            onChange={(event) => update({ mode: event.target.value })}
          >
            <option value="datetime">Date and time</option>
            <option value="date">Date only</option>
          </select>
        </Field>
      )}
      {field.type === 'boolean' && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={field.defaultValue === true}
            onChange={(event) => update({ defaultValue: event.target.checked })}
          />{' '}
          Enabled by default
        </label>
      )}
      {(field.type === 'option' || field.type === 'options') && (
        <>
          <SourceSettings
            definitionId={definitionId}
            source={field.source}
            onChange={(source) => update({ source })}
            datasources={datasources}
            definitions={definitions}
          />
          <div style={{ marginTop: 18 }}>
            <Field
              label={field.type === 'option' ? 'Default value' : 'Default values'}
              htmlFor="option-default"
              description={
                field.type === 'options'
                  ? 'One stored value per line.'
                  : 'The stored value, not its display label.'
              }
            >
              {field.type === 'option' ? (
                <input
                  id="option-default"
                  value={defaultText}
                  onChange={(event) => update({ defaultValue: event.target.value })}
                />
              ) : (
                <textarea
                  id="option-default"
                  value={Array.isArray(field.defaultValue) ? field.defaultValue.join('\n') : ''}
                  onChange={(event) =>
                    update({
                      defaultValue: event.target.value
                        ? event.target.value.split('\n')
                        : ([] as Json[]),
                    })
                  }
                />
              )}
            </Field>
          </div>
        </>
      )}
      {(field.type === 'blocks' || field.type === 'options') && (
        <div className="field-row">
          <Field label="Minimum items" htmlFor="items-min">
            <input
              id="items-min"
              type="number"
              min={0}
              value={field.minItems ?? ''}
              onChange={(event) => update({ minItems: optionalNumber(event.target.value) })}
            />
          </Field>
          <Field label="Maximum items" htmlFor="items-max">
            <input
              id="items-max"
              type="number"
              min={1}
              value={field.maxItems ?? ''}
              onChange={(event) => update({ maxItems: optionalNumber(event.target.value) })}
            />
          </Field>
        </div>
      )}
      {field.type === 'blocks' && (
        <BlockRestrictions
          field={field}
          definitionId={definitionId}
          definitions={definitions}
          onChange={onChange}
        />
      )}
      {field.type === 'asset' && (
        <Field
          label="Allowed file types"
          htmlFor="asset-mime"
          description="One MIME type per line. Leave empty to allow all supported assets."
        >
          <textarea
            id="asset-mime"
            placeholder={'image/jpeg\nimage/png\napplication/pdf'}
            value={field.mimeTypes?.join('\n') ?? ''}
            onChange={(event) =>
              update({
                mimeTypes: event.target.value ? event.target.value.split('\n') : undefined,
              })
            }
          />
        </Field>
      )}
      {field.type === 'link' && (
        <p className="field-hint">
          Editors can link to a story, external URL, email address, or asset.
        </p>
      )}
    </>
  );
}
