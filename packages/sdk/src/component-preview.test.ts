import { afterEach, expect, it, vi } from 'vitest';
import { connectPreview } from './preview.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('isolates nested blocks and defaults only through the authenticated editor bridge', () => {
  vi.useFakeTimers();
  const parent = { postMessage: vi.fn() };
  let receive: (event: Partial<MessageEvent>) => void;
  vi.stubGlobal('window', {
    parent,
    addEventListener: (_: string, callback: typeof receive) => {
      receive = callback;
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    head: { appendChild: vi.fn() },
    createElement: () => ({ remove: vi.fn() }),
    querySelectorAll: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const sockets: MockSocket[] = [];
  class MockSocket {
    onmessage?: (event: { data: string }) => void;
    onclose: unknown;
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal('WebSocket', MockSocket);
  const onChange = vi.fn(),
    onComponent = vi.fn();
  const stop = connectPreview({
    cmsUrl: 'https://cms.test',
    spaceId: 'space',
    story: { id: 'story' },
    mode: { draft: true },
    onChange,
    onComponent,
  });
  const message = (data: unknown, origin = 'https://cms.test', source = parent) =>
    receive({ data, origin, source: source as unknown as Window });
  const session = {
    token: 'bp_' + 'a'.repeat(43),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    spaceId: 'space',
    storyId: 'story',
    localeId: 'locale',
    slug: 'home',
    locale: '',
  };
  const hero = { _uid: 'hero', component: 'hero', title: 'Saved title' };
  const story = {
    id: 'story',
    localeId: 'locale',
    revision: 1,
    content: {
      _uid: 'page',
      component: 'page',
      body: [{ _uid: 'group', component: 'group', items: [hero] }],
    },
  };
  try {
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'storypane:ready', componentPreview: true }),
      'https://cms.test',
    );
    message({ type: 'storypane:component', blockId: 'hero' });
    message({ type: 'storypane:init', session }, 'https://evil.test');
    message({ type: 'storypane:init', session }, 'https://cms.test', { postMessage: vi.fn() });
    expect(sockets).toHaveLength(0);
    expect(onComponent).not.toHaveBeenCalled();
    message({ type: 'storypane:init', session });
    expect(sockets).toHaveLength(1);
    expect(onComponent).not.toHaveBeenCalled();
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'content', story }) });
    expect(onChange).toHaveBeenLastCalledWith(story);
    expect(onComponent).toHaveBeenLastCalledWith(hero);
    sockets[0].onmessage!({
      data: JSON.stringify({
        type: 'content',
        story: { ...story, revision: 2, content: { ...hero, title: 'Updated' } },
      }),
    });
    expect(onComponent).toHaveBeenLastCalledWith({ ...hero, title: 'Updated' });
    onComponent.mockClear();
    message({ type: 'storypane:component', block: hero }, 'https://evil.test');
    message({ type: 'storypane:component', block: { title: 'Malformed' } });
    expect(onComponent).not.toHaveBeenCalled();
    const defaults = { _uid: 'definition', component: 'hero', title: 'Default title', body: [] };
    message({ type: 'storypane:component', block: defaults });
    expect(onComponent).toHaveBeenLastCalledWith(defaults);
    message({ type: 'storypane:component', blockId: 'removed' });
    expect(onComponent).toHaveBeenLastCalledWith(undefined);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'storypane:component-rendered', found: false },
      'https://cms.test',
    );
    onComponent.mockClear();
    vi.setSystemTime(Date.parse(session.expiresAt) + 1);
    message({ type: 'storypane:component', block: defaults });
    expect(onComponent).not.toHaveBeenCalled();
  } finally {
    stop();
  }
  expect(sockets[0].close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
