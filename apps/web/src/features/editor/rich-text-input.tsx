'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, Mark, Node, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { isRichTextColor, type Json } from '@storypane/core';
import { Button } from '@storypane/ui';
import { Moon } from 'lucide-react';

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

export default function RichTextInput({
  backgroundKey,
  value,
  onChange,
  disabled,
  label,
}: {
  backgroundKey: string;
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
  label: string;
}) {
  const [darkBackground, setDarkBackground] = useState(() => {
    try {
      return localStorage.getItem(backgroundKey) === 'dark';
    } catch {
      return false;
    }
  });
  function toggleBackground() {
    setDarkBackground(!darkBackground);
    try {
      if (darkBackground) localStorage.removeItem(backgroundKey);
      else localStorage.setItem(backgroundKey, 'dark');
    } catch {
      // The toggle still works for this visit when browser storage is unavailable.
    }
  }
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
        'aria-readonly': String(disabled),
      },
    },
    onUpdate: ({ editor }) => changeRef.current(editor.getJSON() as Json),
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);
  useEffect(() => {
    // Autosave can reorder JSON keys; replacing an unchanged document resets its selection.
    if (editor && value && !editor.state.doc.eq(editor.schema.nodeFromJSON(value)))
      editor.commands.setContent(value as JSONContent, { emitUpdate: false });
  }, [editor, value]);
  return (
    <div className="richtext-shell" data-dark-background={darkBackground || undefined}>
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
        <Button
          className="button--small richtext-background-toggle"
          aria-pressed={darkBackground}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleBackground}
        >
          <Moon aria-hidden="true" />
          Dark background
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
