"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Boxes, Building2, ChevronsUpDown, ChevronRight, Database, FileText, ImageIcon, LogOut, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Settings2 } from "lucide-react";
import { Button, ErrorNotice, Loading } from "@blok/ui";
import { api, errorMessage } from "../features/editor/api";
import { setStoryLocation } from "../lib/space-url";
import type { Story } from "@blok/core";
import { ContentList } from "../features/content/content-list";
import { SchemaLibrary } from "../features/schema/schema-library";
import { DatasourceList } from "../features/datasources/datasource-list";
import { AssetLibrary } from "../features/assets/asset-library";
import { StoryWorkspace } from "../features/editor/story-workspace";
import { SpaceSettings } from "../features/spaces/space-settings";
import { ThemePicker } from "./theme-picker";
import type {
  NavigationGuard,
  RegisterGuard,
} from "../features/editor/navigation";

export type CMSSession = {
  sessionId: string;
  user: { id: string; name: string; email: string };
  space: { id: string; name: string; role: "admin" | "editor" };
};
type Tab = "content" | "blocks" | "datasources" | "assets" | "settings";
const tabs = [
  { id: "content", label: "Content", icon: FileText },
  { id: "blocks", label: "Blocks", icon: Box },
  { id: "datasources", label: "Datasources", icon: Database },
  { id: "assets", label: "Assets", icon: ImageIcon },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

export function CMSApp({ session: initialSession }: { session: CMSSession }) {
  const [session, setSession] = useState(initialSession);
  const [tab, setTab] = useState<Tab>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'settings' ? 'settings' : 'content');
  const [story, setStory] = useState<Story | null>(null);
  const [storyId, setStoryId] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('story'));
  const [storyError, setStoryError] = useState<string | null>(null);
  const [storyAttempt, setStoryAttempt] = useState(0);
  useEffect(() => {
    if (!storyId || story?.id === storyId) return;
    let stopped = false;
    setStoryError(null);
    void api<Story>(`/stories/${encodeURIComponent(storyId)}`).then(result => {
      if (!stopped) setStory(result);
    }).catch(error => { if (!stopped) setStoryError(errorMessage(error)); });
    return () => { stopped = true; };
  }, [storyId, story?.id, storyAttempt]);
  function openStory(next: Story) {
    setStoryLocation(next.id);
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
  const editingStory = tab === "content" && !!storyId;
  const sidebarExpanded = !editingStory || sidebarPinned || sidebarOpen;
  useEffect(() => {
    setSidebarOpen(false);
    // Story selection leaves focus on a removed content-list button.
    if (editingStory) document.getElementById("main-content")?.focus();
  }, [editingStory]);
  useEffect(() => {
    if (!editingStory || !sidebarOpen || sidebarPinned) return;
    function outside(event: PointerEvent) {
      if (!sidebar.current?.contains(event.target as Node)) setSidebarOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editingStory, sidebarOpen, sidebarPinned]);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const guard = useRef<NavigationGuard | null>(null);
  const registerGuard = useCallback<RegisterGuard>((next) => {
    guard.current = next;
  }, []);
  async function navigate(next: Tab) {
    if (next === tab && !storyId) return;
    if (guard.current && !(await guard.current())) return;
    guard.current = null;
    closeStory();
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'settings') url.searchParams.set('view', 'settings');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }
  async function allSpaces() {
    if (guard.current && !(await guard.current())) return;
    window.location.assign('/');
  }
  async function signOut() {
    if (guard.current && !(await guard.current())) return;
    try {
      const result = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!result.ok) throw new Error("Sign out failed. Please try again.");
      window.location.reload();
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    }
  }
  return (
    <div className={`app-shell${editingStory ? " app-shell--editing" : ""}`} data-sidebar-pinned={sidebarPinned || undefined}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside ref={sidebar} className="app-sidebar" aria-label="Workspace" data-expanded={sidebarExpanded}
        onPointerEnter={event => { if (editingStory && event.pointerType === "mouse") setSidebarOpen(true); }}
        onPointerLeave={() => { if (!sidebar.current?.contains(document.activeElement)) setSidebarOpen(false); }}
        onFocus={event => { if (editingStory && event.target !== sidebarToggle.current) setSidebarOpen(true); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSidebarOpen(false); }}
        onKeyDown={event => {
          if (event.key === "Escape" && editingStory && !sidebarPinned) {
            setSidebarOpen(false);
            sidebarToggle.current?.focus();
          }
        }}
      >
        <button className="sidebar-brand brand-lockup" onClick={() => void allSpaces()} aria-label="Blok home">
          <span className="brand-mark" aria-hidden="true"><Boxes /></span>
          <span className="brand-name">blok<span className="brand-period">.</span></span>
        </button>
        {editingStory && <div className="sidebar-controls">
          <button ref={sidebarToggle} className="button button--ghost icon-button sidebar-toggle" aria-label="Toggle navigation" aria-expanded={sidebarExpanded} aria-controls="workspace-navigation" onClick={() => { setSidebarPinned(false); setSidebarOpen(!sidebarExpanded); }} title={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}>
            {sidebarExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}
          </button>
          {sidebarExpanded && <Button variant="ghost" className="icon-button sidebar-pin" aria-label={sidebarPinned ? "Unpin navigation" : "Pin navigation"} aria-pressed={sidebarPinned} title={sidebarPinned ? "Unpin navigation" : "Pin navigation"} onClick={() => { setSidebarPinned(pinned => !pinned); setSidebarOpen(false); sidebarToggle.current?.focus(); }}>
            {sidebarPinned ? <PinOff /> : <Pin />}
          </Button>}
        </div>}
        <button className="workspace-card" onClick={() => void allSpaces()} aria-label="Switch space">
          <span className="workspace-icon"><Building2 aria-hidden="true" /></span>
          <div><strong>{session.space.name}</strong><span>Switch space</span></div><ChevronsUpDown aria-hidden="true" />
        </button>
        <div className="nav-section-label">Workspace</div>
        <nav id="workspace-navigation" className="workspace-nav" aria-label="Main navigation">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-label={label} aria-current={tab === id ? "page" : undefined} title={label} onClick={() => void navigate(id)}>
              <Icon aria-hidden="true" /><span>{label}</span>
              {tab === id && <span className="nav-active-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-profile">
            <span className="avatar" aria-hidden="true">
              {session.user.name
                .split(" ")
                .map((word) => word[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div><strong>{session.user.name}</strong><span>{session.user.email}</span></div>
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut()}
          >
            <LogOut />
          </Button>
        </div>
      </aside>
      <div className="workspace-body">
      <header className="app-header">
        <div className="header-breadcrumb"><button onClick={() => void allSpaces()} aria-label="All spaces">Spaces</button><ChevronRight aria-hidden="true" /><span className="header-space-name">{session.space.name}</span><ChevronRight aria-hidden="true" /><strong>{tabs.find(item => item.id === tab)?.label}</strong>{story && <><ChevronRight aria-hidden="true" /><span className="header-story">{story.name}</span></>}</div>
        <div className="header-actions"><ThemePicker /><span className="pill pill--outline">{session.space.role === "admin" ? "Admin" : "Editor"}</span></div>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {signOutError && (
          <div className="notice notice--error" role="alert">
            {signOutError}
          </div>
        )}
        {tab === "content" &&
          (storyId ? story ? (
            <StoryWorkspace
              key={story.id}
              story={story}
              session={session}
              registerGuard={registerGuard}
              onBack={closeStory}
            />
          ) : storyError ? (
            <><ErrorNotice message={storyError} retry={() => setStoryAttempt(value => value + 1)} /><Button onClick={closeStory}>Back to content</Button></>
          ) : <Loading label="Opening story…" /> : (
            <ContentList
              onOpen={openStory}
              onBlocks={() => void navigate("blocks")}
            />
          ))}
        {tab === "blocks" && (
          <SchemaLibrary
            canManage={session.space.role === "admin"}
            registerGuard={registerGuard}
          />
        )}
        {tab === "datasources" && (
          <DatasourceList canManage={session.space.role === "admin"} />
        )}
        {tab === "assets" && <AssetLibrary />}
        {tab === "settings" && <SpaceSettings registerGuard={registerGuard} onUpdate={space => setSession(current => ({ ...current, space }))} />}
      </main>
      </div>
    </div>
  );
}
