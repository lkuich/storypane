import { Fragment, type ReactNode } from 'react';
import type { StorypaneRichText } from './types.js';

function safeHref(value: unknown) {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (
      ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Incomplete draft links remain plain text. */
  }
}

// Render only the nodes/marks supported by the editor; never turn CMS text into HTML.
export function RichText({
  value,
  depth = 0,
}: {
  value: StorypaneRichText | string | null | undefined;
  depth?: number;
}): ReactNode {
  if (typeof value === 'string') return value ? <p>{value}</p> : null;
  if (!value || typeof value !== 'object' || depth > 50) return null;
  if (value.type === 'text') {
    let text: ReactNode = typeof value.text === 'string' ? value.text : '';
    for (const mark of Array.isArray(value.marks) ? value.marks : []) {
      if (!mark || typeof mark !== 'object') continue;
      switch (mark.type) {
        case 'bold':
          text = <strong>{text}</strong>;
          break;
        case 'italic':
          text = <em>{text}</em>;
          break;
        case 'strike':
          text = <s>{text}</s>;
          break;
        case 'underline':
          text = <u>{text}</u>;
          break;
        case 'code':
          text = <code>{text}</code>;
          break;
        case 'link': {
          const href = safeHref(mark.attrs?.href);
          if (href) text = <a href={href}>{text}</a>;
          break;
        }
      }
    }
    return text;
  }
  const children = (Array.isArray(value.content) ? value.content : []).map((child, index) => (
    <RichText key={index} value={child} depth={depth + 1} />
  ));
  switch (value.type) {
    case 'paragraph':
      return <p>{children}</p>;
    case 'heading': {
      const level = value.attrs?.level;
      const Heading =
        typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6
          ? (`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6')
          : 'h2';
      return <Heading>{children}</Heading>;
    }
    case 'bulletList':
      return <ul>{children}</ul>;
    case 'orderedList':
      return (
        <ol start={typeof value.attrs?.start === 'number' ? value.attrs.start : undefined}>
          {children}
        </ol>
      );
    case 'listItem':
      return <li>{children}</li>;
    case 'blockquote':
      return <blockquote>{children}</blockquote>;
    case 'codeBlock':
      return (
        <pre>
          <code>{children}</code>
        </pre>
      );
    case 'hardBreak':
      return <br />;
    case 'horizontalRule':
      return <hr />;
    default:
      return <Fragment>{children}</Fragment>;
  }
}
