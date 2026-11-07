'use client';

import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react';
import type {
  AssetReference,
  FieldDefinition,
  Json,
  LinkValue,
  OptionRequestContext,
} from '@storypane/core';
import { Loading } from '@storypane/ui';
import { AssetPicker } from '../assets/asset-picker';
import { OptionInput } from './option-input';
import { localDatetime, utcDatetime } from './draft-buffer';

const RichTextInput = lazy(() => import('./rich-text-input'));

function LinkInput({
  value,
  onChange,
  disabled,
  id,
  referenceRefreshKey,
}: {
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
  id: string;
  referenceRefreshKey?: string;
}) {
  const link =
    value && typeof value === 'object' && !Array.isArray(value) && 'type' in value
      ? (value as LinkValue)
      : null;
  const [type, setType] = useState<LinkValue['type']>(link?.type ?? 'external');
  useEffect(() => {
    if (link?.type) setType(link.type);
  }, [link?.type]);
  return (
    <div>
      <select
        id={id}
        aria-label="Link type"
        value={type}
        disabled={disabled}
        onChange={(event) => {
          setType(event.target.value as LinkValue['type']);
          onChange(null);
        }}
        style={{ marginBottom: 9 }}
      >
        <option value="external">External URL</option>
        <option value="story">Story</option>
        <option value="email">Email address</option>
        <option value="asset">Asset</option>
      </select>
      {type === 'external' && (
        <input
          aria-label="External URL"
          type="url"
          disabled={disabled}
          placeholder="https://example.com"
          value={link?.type === 'external' ? link.url : ''}
          onChange={(event) =>
            onChange(event.target.value ? { type, url: event.target.value } : null)
          }
        />
      )}
      {type === 'email' && (
        <input
          aria-label="Email address"
          type="email"
          disabled={disabled}
          placeholder="hello@example.com"
          value={link?.type === 'email' ? link.email : ''}
          onChange={(event) =>
            onChange(event.target.value ? { type, email: event.target.value } : null)
          }
        />
      )}
      {type === 'story' && (
        <OptionInput
          source={{ type: 'stories' }}
          label="Linked story"
          refreshKey={referenceRefreshKey}
          value={link?.type === 'story' ? link.storyId : null}
          disabled={disabled}
          onChange={(value) =>
            onChange(typeof value === 'string' ? { type, storyId: value } : null)
          }
        />
      )}
      {type === 'asset' && (
        <AssetPicker
          value={link?.type === 'asset' ? { assetId: link.assetId } : null}
          disabled={disabled}
          onChange={(asset) => onChange(asset ? { type, assetId: asset.assetId } : null)}
        />
      )}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  disabled,
  error,
  referenceRefreshKey,
  optionContext,
  labelAction,
}: {
  field: Exclude<FieldDefinition, { type: 'blocks' }>;
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
  error?: string;
  referenceRefreshKey?: string;
  optionContext?: OptionRequestContext;
  labelAction?: ReactNode;
}) {
  const id = useId();
  const common = {
    id,
    disabled,
    'aria-invalid': !!error,
    'aria-describedby':
      [
        error || field.description ? `${id}-description` : '',
        field.required ? `${id}-required` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  };
  let input;
  switch (field.type) {
    case 'text':
      input =
        field.format === 'richtext' ? (
          <Suspense fallback={<Loading label="Loading text editor…" />}>
            <RichTextInput
              value={value}
              onChange={onChange}
              disabled={disabled}
              label={field.label}
            />
          </Suspense>
        ) : field.format === 'singleline' ? (
          <input
            {...common}
            type="text"
            value={typeof value === 'string' ? value : ''}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <textarea
            {...common}
            className={field.format === 'markdown' ? 'mono' : undefined}
            value={typeof value === 'string' ? value : ''}
            maxLength={field.maxLength}
            rows={field.format === 'markdown' ? 9 : 4}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      break;
    case 'number':
      input = (
        <input
          {...common}
          type="number"
          min={field.min}
          max={field.max}
          step={field.decimals === undefined ? 'any' : 10 ** -field.decimals}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) =>
            onChange(
              Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : null,
            )
          }
        />
      );
      break;
    case 'datetime':
      input = (
        <>
          <input
            {...common}
            type={field.mode === 'date' ? 'date' : 'datetime-local'}
            value={
              typeof value === 'string'
                ? field.mode === 'date'
                  ? value
                  : localDatetime(value)
                : ''
            }
            onChange={(event) =>
              onChange(
                field.mode === 'date'
                  ? event.target.value || null
                  : utcDatetime(event.target.value),
              )
            }
          />
          {field.mode === 'datetime' && (
            <p className="field-hint">Displayed in your local timezone; saved in UTC.</p>
          )}
        </>
      );
      break;
    case 'boolean':
      input = (
        <div className="checkbox-field">
          <input
            {...common}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span aria-hidden="true">{value === true ? 'Enabled' : 'Disabled'}</span>
        </div>
      );
      break;
    case 'option':
    case 'options':
      input = (
        <OptionInput
          id={id}
          source={field.source}
          context={field.source.type === 'external' ? optionContext : undefined}
          refreshKey={field.source.type === 'stories' ? referenceRefreshKey : undefined}
          label={field.label}
          value={value}
          multiple={field.type === 'options'}
          onChange={onChange}
          disabled={disabled}
        />
      );
      break;
    case 'asset':
      input = (
        <AssetPicker
          value={
            value && typeof value === 'object' && !Array.isArray(value) && 'assetId' in value
              ? (value as AssetReference)
              : null
          }
          onChange={(asset) => onChange(asset as Json)}
          disabled={disabled}
        />
      );
      break;
    case 'link':
      input = (
        <LinkInput
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          referenceRefreshKey={referenceRefreshKey}
        />
      );
      break;
  }
  return (
    <div className="field">
      <div className="field-heading">
        <label className="field-label" htmlFor={id}>
          {field.label}
          {field.required && (
            <span
              aria-hidden="true"
              title="Required to publish"
              style={{ color: 'var(--danger)', marginLeft: 3 }}
            >
              *
            </span>
          )}
        </label>
        {labelAction}
      </div>
      {input}
      {field.required && (
        <span id={`${id}-required`} className="sr-only">
          Required when publishing.
        </span>
      )}
      {(field.description || error) && (
        <p
          id={`${id}-description`}
          className={error ? 'field-error' : 'field-hint'}
          role={error ? 'alert' : undefined}
        >
          {error ?? field.description}
        </p>
      )}
    </div>
  );
}
