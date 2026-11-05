import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RichText } from '@storypane/sdk/rich-text';

it('renders formatted rich text safely and accepts legacy text and empty drafts', () => {
  const html = renderToStaticMarkup(
    createElement(RichText, {
      value: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: '<script>unsafe</script>',
                        marks: [
                          { type: 'italic' },
                          { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Contact',
                marks: [{ type: 'link', attrs: { href: 'mailto:hello@example.com' } }],
              },
              { type: 'hardBreak' },
              {
                type: 'text',
                text: 'Website',
                marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
              },
            ],
          },
        ],
      },
    }),
  );
  expect(html).toContain('<h2>Hello</h2>');
  expect(html).toContain('<ul><li><p><em>&lt;script&gt;unsafe&lt;/script&gt;</em></p></li></ul>');
  expect(html).toContain('href="mailto:hello@example.com"');
  expect(html).toContain('<br/>');
  expect(html).toContain('href="https://example.com/"');
  expect(html).not.toContain('javascript:');
  expect(renderToStaticMarkup(createElement(RichText, { value: 'Legacy text' }))).toBe(
    '<p>Legacy text</p>',
  );
  expect(renderToStaticMarkup(createElement(RichText, { value: null }))).toBe('');
  expect(
    renderToStaticMarkup(
      createElement(RichText, {
        value: JSON.parse('{"type":"text","text":"Draft","marks":[null]}'),
      }),
    ),
  ).toBe('Draft');
});

it('preserves imported text color', () => {
  expect(
    renderToStaticMarkup(
      createElement(RichText, {
        value: {
          type: 'text',
          text: 'Color',
          marks: [{ type: 'textStyle', attrs: { color: '#171F5D' } }],
        },
      }),
    ),
  ).toBe('<span style="color:#171F5D">Color</span>');
});

it('renders safe rich-text images and rejects executable sources', () => {
  const render = (src: string) =>
    renderToStaticMarkup(
      createElement(RichText, { value: { type: 'image', attrs: { src, alt: 'A photo' } } }),
    );
  expect(render('https://example.com/photo.jpg')).toContain(
    '<img src="https://example.com/photo.jpg" alt="A photo"',
  );
  expect(render('javascript:alert(1)')).toBe('');
});
