"use client";

import { useCallback, useRef, useState } from "react";
import { Box, Boxes, Building2, ChevronsUpDown, ChevronRight, Database, FileText, ImageIcon, LogOut, Settings2 } from "lucide-react";
import { Button } from "@blok/ui";
import type { Story } from "@blok/core";
import { ContentList } from "../features/content/content-list";
import { SchemaLibrary } from "../features/schema/schema-library";
import { DatasourceList } from "../features/datasources/datasource-list";
import { AssetLibrary } from "../features/assets/asset-library";
import { StoryWorkspace } from "../features/editor/story-workspace";
import { SpaceSettings } from "../features/spaces/space-settings";
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
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const guard = useRef<NavigationGuard | null>(null);
  const registerGuard = useCallback<RegisterGuard>((next) => {
    guard.current = next;
  }, []);
  async function navigate(next: Tab) {
    if (next === tab && !story) return;
    if (guard.current && !(await guard.current())) return;
    guard.current = null;
    setStory(null);
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
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="app-sidebar" aria-label="Workspace">
        <button className="sidebar-brand brand-lockup" onClick={() => void allSpaces()} aria-label="Blok home">
          <span className="brand-mark" aria-hidden="true"><Boxes /></span>
          <span className="brand-name">blok<span className="brand-period">.</span></span>
        </button>
        <button className="workspace-card" onClick={() => void allSpaces()} aria-label="Switch space">
          <span className="workspace-icon"><Building2 aria-hidden="true" /></span>
          <div><strong>{session.space.name}</strong><span>Switch space</span></div><ChevronsUpDown aria-hidden="true" />
        </button>
        <div className="nav-section-label">Workspace</div>
        <nav className="workspace-nav" aria-label="Main navigation">
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
        <span className="pill pill--outline">{session.space.role === "admin" ? "Admin" : "Editor"}</span>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {signOutError && (
          <div className="notice notice--error" role="alert">
            {signOutError}
          </div>
        )}
        {tab === "content" &&
          (story ? (
            <StoryWorkspace
              story={story}
              session={session}
              registerGuard={registerGuard}
              onBack={() => setStory(null)}
            />
          ) : (
            <ContentList
              onOpen={setStory}
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
