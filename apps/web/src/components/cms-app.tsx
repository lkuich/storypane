'use client';

import { AccountControl } from './account-control';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Boxes,
  Building2,
  ChevronsUpDown,
  ChevronRight,
  Database,
  FileText,
  ImageIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Settings2,
} from 'lucide-react';
import { Button, ErrorNotice, Loading } from '@storypane/ui';
import { api, errorMessage } from '../features/editor/api';
import { setStoryLocation } from '../lib/space-url';
import { can, type Space, type Story } from '@storypane/core';
import { ContentList } from '../features/content/content-list';
import { SchemaLibrary } from '../features/schema/schema-library';
import { DatasourceList } from '../features/datasources/datasource-list';
import { AssetLibrary } from '../features/assets/asset-library';
import { StoryWorkspace } from '../features/editor/story-workspace';
import { SpaceSettings } from '../features/spaces/space-settings';
import { ThemePicker } from './theme-picker';
import { EnvironmentBadge } from './environment-badge';
import { SpaceSwitcher } from './space-switcher';
import type { NavigationGuard, RegisterGuard } from '../features/editor/navigation';

export type CMSSession = {
  installationAdmin?: boolean;
  sessionId: string;
  user: { id: string; name: string; email: string };
  space: Pick<
    Space,
    | 'id'
    | 'name'
    | 'role'
    | 'roleName'
    | 'permissions'
    | 'contentScopes'
    | 'environment'
    | 'productionSpaceId'
    | 'schemaReadOnly'
  >;
};
type Tab = 'content' | 'blocks' | 'datasources' | 'assets' | 'settings';
const tabs = [
  { id: 'content', label: 'Content', icon: FileText },
  { id: 'blocks', label: 'Blocks', icon: Box },
  { id: 'datasources', label: 'Datasources', icon: Database },
  { id: 'assets', label: 'Assets', icon: ImageIcon },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const;

function tabFromUrl(url: URL): Tab {
  const view = url.searchParams.get('view');
  return tabs.find((tab) => tab.id === view)?.id ?? 'content';
}

export function CMSApp({ session: initialSession }: { session: CMSSession }) {
  const [session, setSession] = useState(initialSession);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== 'undefined' ? tabFromUrl(new URL(window.location.href)) : 'content',
  );
  const historyIndex = useRef(0);
  const [story, setStory] = useState<Story | null>(null);
  const [storyId, setStoryId] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('story'),
  );
  const [storyError, setStoryError] = useState<string | null>(null);
  const [storyAttempt, setStoryAttempt] = useState(0);
  useEffect(() => {
    if (!storyId || story?.id === storyId) return;
    let stopped = false;
    setStoryError(null);
    void api<Story>(`/stories/${encodeURIComponent(storyId)}`)
      .then((result) => {
        if (!stopped) setStory(result);
      })
      .catch((error) => {
        if (!stopped) setStoryError(errorMessage(error));
      });
    return () => {
      stopped = true;
    };
  }, [storyId, story?.id, storyAttempt]);
  function openStory(next: Story, locale?: string) {
    setStoryLocation(next.id, locale, undefined, 'push');
    historyIndex.current = window.history.state.storypaneIndex;
    setStory(next);
    setStoryId(next.id);
    setStoryError(null);
  }
  function closeStory() {
    setStoryLocation(null);
    setStoryId(null);
    setStory(null);
    setStoryError(null);
  }
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const editingStory = tab === 'content' && !!storyId;
  const sidebarExpanded = !editingStory || sidebarPinned || sidebarOpen;
  useEffect(() => {
    setSidebarOpen(false);
    // Story selection leaves focus on a removed content-list button.
    if (editingStory) document.getElementById('main-content')?.focus();
  }, [editingStory]);
  useEffect(() => {
    if (!editingStory || !sidebarOpen || sidebarPinned) return;
    function outside(event: PointerEvent) {
      if (!sidebar.current?.contains(event.target as Node)) setSidebarOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [editingStory, sidebarOpen, sidebarPinned]);
  const guard = useRef<NavigationGuard | null>(null);
  const registerGuard = useCallback<RegisterGuard>((next) => {
    guard.current = next;
  }, []);
  useEffect(() => {
    historyIndex.current = window.history.state?.storypaneIndex ?? 0;
    window.history.replaceState(
      { ...window.history.state, storypaneIndex: historyIndex.current },
      '',
      window.location.href,
    );
    let attempt = 0;
    async function restoreLocation(event: PopStateEvent) {
      const currentAttempt = ++attempt,
        target = new URL(window.location.href),
        targetIndex = event.state?.storypaneIndex ?? 0;
      if (targetIndex === historyIndex.current) return;
      let allowed = false;
      try {
        allowed = !guard.current || (await guard.current());
      } catch {
        /* A failed save must keep the current editor open. */
      }
      if (currentAttempt !== attempt) return;
      // Saving while Back is pending can update the selected block URL; restore the requested entry first.
      window.history.replaceState(event.state, '', target);
      if (!allowed) {
        window.history.go(historyIndex.current - targetIndex);
        return;
      }
      historyIndex.current = targetIndex;
      guard.current = null;
      const nextStoryId = target.searchParams.get('story');
      setTab(nextStoryId ? 'content' : tabFromUrl(target));
      setStory(null);
      setStoryId(nextStoryId);
      setStoryError(null);
    }
    window.addEventListener('popstate', restoreLocation);
    return () => {
      attempt++;
      window.removeEventListener('popstate', restoreLocation);
    };
  }, []);
  async function navigate(next: Tab) {
    if (next === tab && !storyId) return;
    if (guard.current && !(await guard.current())) return;
    guard.current = null;
    closeStory();
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('section');
    if (next !== 'content') url.searchParams.set('view', next);
    else url.searchParams.delete('view');
    window.history.replaceState(window.history.state, '', url);
  }
  async function allSpaces() {
    if (guard.current && !(await guard.current())) return;
    window.location.assign('/');
  }
  return (
    <div
      className={`app-shell${editingStory ? ' app-shell--editing' : ''}`}
      data-sidebar-pinned={sidebarPinned || undefined}
      data-environment={session.space.environment === 'dev' ? 'dev' : 'prod'}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        ref={sidebar}
        className="app-sidebar"
        aria-label="Workspace"
        data-expanded={sidebarExpanded}
        onPointerEnter={(event) => {
          if (editingStory && event.pointerType === 'mouse') setSidebarOpen(true);
        }}
        onPointerLeave={() => {
          if (!sidebar.current?.contains(document.activeElement)) setSidebarOpen(false);
        }}
        onFocus={(event) => {
          if (editingStory && event.target !== sidebarToggle.current) setSidebarOpen(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setSidebarOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && editingStory && !sidebarPinned) {
            setSidebarOpen(false);
            sidebarToggle.current?.focus();
          }
        }}
      >
        <button
          className="sidebar-brand brand-lockup"
          onClick={() => void allSpaces()}
          aria-label="Storypane home"
        >
          <span className="brand-mark" aria-hidden="true">
            <Boxes />
          </span>
          <span className="brand-name">
            storypane<span className="brand-period">.</span>
          </span>
        </button>
        {editingStory && (
          <div className="sidebar-controls">
            <button
              ref={sidebarToggle}
              className="button button--ghost icon-button sidebar-toggle"
              aria-label="Toggle navigation"
              aria-expanded={sidebarExpanded}
              aria-controls="workspace-navigation"
              onClick={() => {
                setSidebarPinned(false);
                setSidebarOpen(!sidebarExpanded);
              }}
              title={sidebarExpanded ? 'Collapse navigation' : 'Expand navigation'}
            >
              {sidebarExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}
            </button>
            {sidebarExpanded && (
              <Button
                variant="ghost"
                className="icon-button sidebar-pin"
                aria-label={sidebarPinned ? 'Unpin navigation' : 'Pin navigation'}
                aria-pressed={sidebarPinned}
                title={sidebarPinned ? 'Unpin navigation' : 'Pin navigation'}
                onClick={() => {
                  setSidebarPinned((pinned) => !pinned);
                  setSidebarOpen(false);
                  sidebarToggle.current?.focus();
                }}
              >
                {sidebarPinned ? <PinOff /> : <Pin />}
              </Button>
            )}
          </div>
        )}
        <button
          className="workspace-card"
          onClick={() => setSwitcherOpen(true)}
          aria-label="Switch space"
          aria-haspopup="dialog"
        >
          <span className="workspace-icon">
            <Building2 aria-hidden="true" />
          </span>
          <div>
            <strong>{session.space.name}</strong>
            <span>
              {session.space.environment === 'dev' ? 'Development' : 'Production'} · Switch space
            </span>
          </div>
          <ChevronsUpDown aria-hidden="true" />
        </button>
        <div className="nav-section-label">Workspace</div>
        <nav id="workspace-navigation" className="workspace-nav" aria-label="Main navigation">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              aria-current={tab === id ? 'page' : undefined}
              title={label}
              onClick={() => void navigate(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {tab === id && <span className="nav-active-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
      </aside>
      <div className="workspace-body">
        <header className="app-header">
          <div className="header-breadcrumb">
            <button onClick={() => void allSpaces()} aria-label="All spaces">
              Spaces
            </button>
            <ChevronRight aria-hidden="true" />
            <button
              className="header-space-switch"
              onClick={() => setSwitcherOpen(true)}
              aria-label={`Switch space: ${session.space.name} (${session.space.environment === 'dev' ? 'Development' : 'Production'})`}
              aria-haspopup="dialog"
            >
              <EnvironmentBadge environment={session.space.environment} />
              <span className="header-space-name">{session.space.name}</span>
              <ChevronsUpDown aria-hidden="true" />
            </button>
            <ChevronRight aria-hidden="true" />
            <strong>{tabs.find((item) => item.id === tab)?.label}</strong>
            {story && (
              <>
                <ChevronRight aria-hidden="true" />
                <span className="header-story">{story.name}</span>
              </>
            )}
          </div>
          <div className="header-actions">
            <ThemePicker />
            <span className="pill pill--outline">{session.space.roleName}</span>
            <AccountControl />
          </div>
        </header>
        <main className="app-main" id="main-content" tabIndex={-1}>
          {tab === 'content' &&
            (storyId ? (
              story ? (
                <StoryWorkspace
                  key={story.id}
                  story={story}
                  session={session}
                  registerGuard={registerGuard}
                  onBack={closeStory}
                />
              ) : storyError ? (
                <>
                  <ErrorNotice
                    message={storyError}
                    retry={() => setStoryAttempt((value) => value + 1)}
                  />
                  <Button onClick={closeStory}>Back to content</Button>
                </>
              ) : (
                <Loading label="Opening story…" />
              )
            ) : (
              <ContentList
                canCreate={can(session.space, 'content:edit')}
                canPublish={can(session.space, 'content:publish')}
                onOpen={openStory}
                onBlocks={() => void navigate('blocks')}
              />
            ))}
          {tab === 'blocks' && (
            <SchemaLibrary
              spaceName={session.space.name}
              canDeploy={session.space.role === 'admin'}
              canManage={can(session.space, 'schemas:write')}
              registerGuard={registerGuard}
            />
          )}
          {tab === 'datasources' && (
            <DatasourceList canManage={can(session.space, 'datasources:write')} />
          )}
          {tab === 'assets' && <AssetLibrary />}
          {tab === 'settings' && (
            <SpaceSettings
              installationAdmin={session.installationAdmin}
              access={session.space}
              registerGuard={registerGuard}
              onUpdate={(space) => setSession((current) => ({ ...current, space }))}
            />
          )}
        </main>
      </div>
      {switcherOpen && (
        <SpaceSwitcher
          current={session.space}
          onClose={() => setSwitcherOpen(false)}
          onAllSpaces={allSpaces}
          onSelect={async (id) => {
            if (guard.current && !(await guard.current())) return;
            window.location.assign(`/?${new URLSearchParams({ space: id, view: tab })}`);
          }}
        />
      )}
    </div>
  );
}
