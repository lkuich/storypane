import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { Json, OptionSource } from '@storypane/core';
import { OptionInput } from './option-input';

afterEach(() => vi.unstubAllGlobals());
function render(value: Json, source: OptionSource = { type: 'stories' }) {
  vi.stubGlobal('window', {
    location: { search: '?space=space&story=current&locale=fr&block=selected' },
  });
  return renderToStaticMarkup(
    createElement(OptionInput, {
      source,
      value,
      multiple: Array.isArray(value),
      onChange: () => {},
      disabled: true,
      label: 'Footer',
    }),
  );
}
it('opens a selected story in its space and default locale, even when editing is disabled', () => {
  const html = render('footer');
  expect(html).toContain('href="/?space=space&amp;story=footer"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('aria-label="Open footer story (new tab)"');
  expect(html).not.toContain('block=selected');
  expect(html).not.toContain('locale=fr');
});
it('links each selected story in a multi-select and does not link ordinary or empty options', () => {
  const html = render(['one', 'two']);
  expect(html.match(/target="_blank"/g)).toHaveLength(2);
  expect(html).toContain('story=one');
  expect(html).toContain('story=two');
  expect(render(null)).not.toContain('<a ');
  expect(render('one', { type: 'inline', items: [{ value: 'one', label: 'One' }] })).not.toContain(
    '<a ',
  );
});
