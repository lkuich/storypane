'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, Folder } from 'lucide-react';
import type { BlockDefinition } from '@storypane/core';
import { Button, ErrorNotice, Field, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

export function blockFolderPaths(definitions: BlockDefinition[], savedPaths: string[]) {
  const paths = new Set<string>();
  for (let path of [...savedPaths, ...definitions.map((item) => item.folderPath)]) {
    while (path && !paths.has(path)) {
      paths.add(path);
      path = path.substring(0, path.lastIndexOf('/'));
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function useBlockFolders(definitions: BlockDefinition[], savedPaths: string[]) {
  const [history, setHistory] = useState({ entries: [''], index: 0 });
  const [flat, setFlat] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const paths = blockFolderPaths(definitions, savedPaths);
  // Refreshes can remove the last block in the current folder.
  const entries = history.entries.filter((path) => !path || paths.includes(path));
  const index = Math.min(history.index, entries.length - 1);
  const folder = entries[index];
  const prefix = folder ? folder + '/' : '';
  const query = search.trim().toLowerCase();
  const children = flat
    ? []
    : paths.filter((path) => {
        if (!path.startsWith(prefix)) return false;
        const name = path.slice(prefix.length);
        return !name.includes('/') && name.toLowerCase().includes(query);
      });
  function navigate(next: string[], position: number) {
    setHistory({ entries: next, index: position });
    setSearch('');
    searchRef.current?.focus();
  }
  return {
    hasFolders: paths.length > 0,
    definitions: flat
      ? definitions
      : definitions.filter((block) => (block.folderPath ?? '') === folder),
    folder,
    children,
    flat,
    setFlat,
    search,
    setSearch,
    searchRef,
    reset: () => {
      setHistory({ entries: [''], index: 0 });
      setSearch('');
    },
    back: index > 0 ? () => navigate(entries, index - 1) : undefined,
    forward: index + 1 < entries.length ? () => navigate(entries, index + 1) : undefined,
    open: (path: string) => navigate([...entries.slice(0, index + 1), path], index + 1),
  };
}

type FolderBrowser = ReturnType<typeof useBlockFolders>;

export function BlockFolderControls({ browser }: { browser: FolderBrowser }) {
  return (
    <nav className="content-folder-breadcrumbs block-folder-controls" aria-label="Block folders">
      {!browser.flat && (
        <>
          <div className="content-folder-history">
            <Button
              className="button--small"
              aria-label="Back"
              disabled={!browser.back}
              onClick={browser.back}
            >
              <ArrowLeft aria-hidden="true" /> <span>Back</span>
            </Button>
            <Button
              className="button--small"
              aria-label="Forward"
              disabled={!browser.forward}
              onClick={browser.forward}
            >
              <span>Forward</span> <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          <strong role="status">
            {browser.folder ? browser.folder.split('/').join(' / ') : 'Root'}
          </strong>
        </>
      )}
      <label className="definition-reference-toggle">
        <input
          type="checkbox"
          checked={browser.flat}
          onChange={(event) => browser.setFlat(event.target.checked)}
        />
        Flatten blocks
      </label>
    </nav>
  );
}

export function BlockFolderList({ browser }: { browser: FolderBrowser }) {
  if (!browser.children.length) return null;
  return (
    <section className="content-folders" aria-label="Folders">
      {browser.children.map((path) => {
        const name = path.slice(path.lastIndexOf('/') + 1);
        return (
          <div className="content-folder-card" key={path}>
            <button
              type="button"
              className="content-folder-open"
              onClick={() => browser.open(path)}
              aria-label={`Open folder ${name}`}
            >
              <Folder aria-hidden="true" />
              <span>
                <strong>{name}</strong>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}

export function NewBlockFolderDialog({
  parent,
  onClose,
  onCreated,
}: {
  parent: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      closeOnBackdrop
      title="New block folder"
      description={`Create in ${parent || 'Root'}. Use / to create subfolders.`}
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const path = await api<string>(
              '/block-folders',
              jsonRequest('POST', { path: parent ? parent + '/' + name : name }),
            );
            onCreated(path);
            onClose();
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorNotice message={error} />
        <Field label="Folder name" htmlFor="new-block-folder-name">
          <input
            id="new-block-folder-name"
            autoFocus
            required
            disabled={busy}
            maxLength={500}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="button-group">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            Create folder
          </Button>
        </div>
      </form>
    </Modal>
  );
}
