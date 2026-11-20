import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import ClerkApp from './clerk-app';

const auth = vi.hoisted(() => ({
  isLoaded: false,
  isSignedIn: undefined as boolean | undefined,
  getToken: async () => null,
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => auth,
  UserButton: () => null,
  SignIn: ({ forceRedirectUrl }: { forceRedirectUrl: string }) =>
    createElement('button', { 'data-redirect': forceRedirectUrl }, 'Verify this device'),
}));

afterEach(() => {
  auth.isLoaded = false;
  auth.isSignedIn = undefined;
  vi.unstubAllGlobals();
});

function render(url: string) {
  vi.stubGlobal('window', { location: new URL(url) });
  return renderToStaticMarkup(createElement(ClerkApp, { publishableKey: 'pk_test_example' }));
}

it('shows the workspace loader while Clerk initializes after a space switch', () => {
  const html = render('https://cms.test/?space=training&view=content');
  expect(html).toContain('Opening your workspace');
  expect(html).not.toContain('login-shell');
});

it('keeps the Clerk verification form in the shell while Clerk updates its auth state', () => {
  const html = render('https://cms.test/#/client-trust');
  expect(html).toContain('Verify this device');
  expect(html).not.toContain('Opening your workspace');
});

it('keeps the workspace query when returning from verification and clears the Clerk route', () => {
  auth.isLoaded = true;
  auth.isSignedIn = false;
  const html = render('https://cms.test/?space=training#/client-trust');
  expect(html).toContain('data-redirect="https://cms.test/?space=training"');
});
