'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { EditorContent, Mark, Node, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type {
  AssetReference,
  FieldDefinition,
  Json,
  LinkValue,
  OptionRequestContext,
} from '@storypane/core';
import { isRichTextColor } from '@storypane/core';
import { AssetPicker } from '../assets/asset-picker';
import { OptionInput } from './option-input';
import { localDatetime, utcDatetime } from './draft-buffer';

const TextStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return { color: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[style]',
        getAttrs: (element) => {
          const color = (element as HTMLElement).style.color;
          return isRichTextColor(color) ? { color } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      isRichTextColor(HTMLAttributes.color) ? { style: `color: ${HTMLAttributes.color}` } : {},
      0,
    ];
  },
});

const RichTextImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: null },
      src: { default: null },
      alt: { default: '' },
      title: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-asset-id]',
        getAttrs: (element) => ({ assetId: element.getAttribute('data-asset-id') }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { assetId, src, alt, title } = HTMLAttributes;
    return [
      'img',
      {
        'data-asset-id': assetId,
        src: typeof src === 'string' && /^https?:/.test(src) ? src : undefined,
        alt,
        title,
      },
    ];
  },
});

function RichTextInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
  label: string;
}) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const editor = useEditor({
    extensions: [StarterKit.configure({ trailingNode: false }), TextStyle, RichTextImage],
    content:
      value && typeof value === 'object'
        ? (value as JSONContent)
        : { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => changeRef.current(editor.getJSON() as Json),
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);
  useEffect(() => {
    if (editor && value && JSON.stringify(value) !== JSON.stringify(editor.getJSON()))
      editor.commands.setContent(value as JSONContent, { emitUpdate: false });
  }, [editor, value]);
  return (
    <div className="richtext-shell">
      <div className="richtext-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={editor?.isActive('bold') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={editor?.isActive('italic') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="Heading"
          aria-pressed={editor?.isActive('heading') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          aria-label="Bullet list"
          aria-pressed={editor?.isActive('bulletList') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          aria-pressed={editor?.isActive('orderedList') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </button>
        <button
          type="button"
          aria-label="Block quote"
          aria-pressed={editor?.isActive('blockquote') ?? false}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          “ Quote
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

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
}: {
  field: Exclude<FieldDefinition, { type: 'blocks' }>;
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
  error?: string;
  referenceRefreshKey?: string;
  optionContext?: OptionRequestContext;
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
          <RichTextInput
            value={value}
            onChange={onChange}
            disabled={disabled}
            label={field.label}
          />
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
      <label htmlFor={id}>
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
