"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { spaceHeaders, spaceUrl } from "../../lib/space-url";
import {
  LEASE_RENEW_MS,
  type BlockDraft,
  type Command,
  type CommitResult,
  type Json,
  type Lease,
  type LocaleSnapshot,
} from "@blok/core";
import {
  acknowledgeBuffer,
  editBuffer,
  readBuffers,
  readPendingCommand,
  type DraftBuffers,
} from "./draft-buffer";
import { api, ApiError, errorMessage, jsonRequest } from "./api";

export function useStoryEditor({
  storyId,
  localeId,
  userId,
  sessionId,
  spaceId,
}: {
  storyId: string;
  localeId: string;
  userId: string;
  sessionId: string;
  spaceId: string;
}) {
  const base = `/stories/${storyId}/locales/${localeId}`;
  const storageKey = `blok:drafts:${userId}:${spaceId}:${storyId}:${localeId}`;
  const [snapshot, setSnapshot] = useState<LocaleSnapshot | null>(null);
  const snapshotRef = useRef<LocaleSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [buffers, setBuffers] = useState<DraftBuffers>({});
  const buffersRef = useRef<DraftBuffers>({});
  const leases = useRef<Record<string, Lease>>({});
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const connected = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [blockErrors, setBlockErrors] = useState<Record<string, ApiError>>({});
  const blockErrorsRef = useRef<Record<string, ApiError>>({});
  const [saving, setSaving] = useState(false);
  const [leaseRevision, setLeaseRevision] = useState(0);
  const inFlight = useRef<Partial<Record<string, Promise<boolean>>>>({});
  const leaseRequests = useRef<Partial<Record<string, Promise<Lease>>>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxWait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(true);
  const syncing = useRef<Promise<LocaleSnapshot> | null>(null);
  const pendingCommand = useRef<Command | null>(null);
  const structuralRequest = useRef<Promise<CommitResult> | null>(null);
  const [unconfirmedCommand, setUnconfirmedCommand] = useState(false);
  const [completedCommand, setCompletedCommand] = useState<Command | null>(
    null,
  );

  const persistCommand = useCallback(
    (command: Command | null) => {
      pendingCommand.current = command;
      setUnconfirmedCommand(!!command);
      try {
        if (command)
          localStorage.setItem(
            `${storageKey}:command`,
            JSON.stringify(command),
          );
        else localStorage.removeItem(`${storageKey}:command`);
      } catch {
        setError(
          "This browser could not keep a recovery copy. Keep this page open until the change is confirmed.",
        );
      }
    },
    [storageKey],
  );

  const persist = useCallback(
    (next: DraftBuffers) => {
      buffersRef.current = next;
      setBuffers(next);
      try {
        if (Object.keys(next).length)
          localStorage.setItem(storageKey, JSON.stringify(next));
        else localStorage.removeItem(storageKey);
      } catch {
        setError(
          "This browser could not store a recovery copy. Keep this tab open until your changes are saved.",
        );
      }
    },
    [storageKey],
  );
  const setBlockError = useCallback((id: string, problem: ApiError | null) => {
    const next = { ...blockErrorsRef.current };
    if (problem) next[id] = problem;
    else delete next[id];
    blockErrorsRef.current = next;
    setBlockErrors(next);
  }, []);

  const acceptSnapshot = useCallback(
    (next: LocaleSnapshot) => {
      if (snapshotRef.current && next.revision < snapshotRef.current.revision)
        return;
      snapshotRef.current = next;
      setSnapshot(next);
      for (const lease of next.leases)
        // A snapshot may predate a release; never resurrect a released lease.
        if (lease.sessionId === sessionId && lease.token && leases.current[lease.blockId]?.token === lease.token)
          leases.current[lease.blockId] = lease;
      for (const [id, lease] of Object.entries(leases.current))
        if (Date.parse(lease.expiresAt) <= Date.now())
          delete leases.current[id];
      setLeaseRevision((value) => value + 1);
      if (
        !selectedRef.current ||
        !next.blocks.some((block) => block.id === selectedRef.current)
      ) {
        // Keep a deleted blok's recovery buffer available until the editor explicitly discards it.
        const recoveryId = Object.keys(buffersRef.current)[0];
        selectedRef.current = recoveryId ?? next.locale.rootBlockId;
        setSelectedId(selectedRef.current);
      }
      for (const [id, buffer] of Object.entries(buffersRef.current)) {
        const block = next.blocks.find((block) => block.id === id);
        if (
          !buffer.attempt &&
          (!block || block.revision !== buffer.baseRevision)
        )
          setBlockError(
            id,
            new ApiError(
              "This block changed while you were away. Your unsaved edits are preserved below.",
              "stale_revision",
            ),
          );
      }
    },
    [sessionId, setBlockError],
  );

  const sync = useCallback(async () => {
    if (syncing.current) return syncing.current;
    const promise = api<LocaleSnapshot>(base)
      .then((next) => {
        if (active.current) acceptSnapshot(next);
        return next;
      })
      .finally(() => {
        syncing.current = null;
      });
    syncing.current = promise;
    return promise;
  }, [base, acceptSnapshot]);

  const acquire = useCallback(
    async (blockId: string): Promise<Lease> => {
      const current = leases.current[blockId];
      if (current?.token && Date.parse(current.expiresAt) > Date.now() + 5000)
        return current;
      const pendingRequest = leaseRequests.current[blockId];
      if (pendingRequest) return pendingRequest;
      const request = api<Lease>(
        `${base}/leases`,
        jsonRequest("POST", { blockId }),
      )
        .then((lease) => {
          leases.current[blockId] = lease;
          if (active.current) setLeaseRevision((value) => value + 1);
          return lease;
        })
        .finally(() => {
          delete leaseRequests.current[blockId];
        });
      leaseRequests.current[blockId] = request;
      return request;
    },
    [base],
  );

  const release = useCallback(
    async (blockId: string) => {
      const lease = leases.current[blockId];
      if (!lease?.token) return;
      delete leases.current[blockId];
      setLeaseRevision((value) => value + 1);
      await api(
        `${base}/leases`,
        jsonRequest("DELETE", { blockId, token: lease.token }),
      ).catch(() => undefined);
    },
    [base],
  );

  const flushBlock = useCallback(
    async (blockId: string): Promise<boolean> => {
      const pendingRequest = inFlight.current[blockId];
      if (pendingRequest) return pendingRequest;
      if (!buffersRef.current[blockId]) return true;
      if (!connected.current) return false;
      const existingError = blockErrorsRef.current[blockId];
      if (
        existingError &&
        ["stale_revision", "locked", "invalid", "forbidden"].includes(
          existingError.code,
        )
      )
        return false;
      const task = (async () => {
        setSaving(true);
        try {
          let buffer = buffersRef.current[blockId];
          if (!buffer) return true;
          if (!buffer.attempt) {
            const block = snapshotRef.current?.blocks.find(
              (block) => block.id === blockId,
            );
            if (!block || block.revision !== buffer.baseRevision)
              throw new ApiError(
                "A newer version of this block is saved. Your edits have been preserved.",
                "stale_revision",
              );
            const lease = await acquire(blockId);
            buffer = {
              ...buffer,
              attempt: {
                mutationId: crypto.randomUUID(),
                baseRevision: buffer.baseRevision,
                fields: structuredClone(buffer.fields),
                generation: buffer.generation,
                leaseToken: lease.token!,
              },
            };
            persist({ ...buffersRef.current, [blockId]: buffer });
          }
          const attempt = buffer.attempt!;
          const command: Command = {
            type: "saveBlock",
            mutationId: attempt.mutationId,
            expectedRevisions: { [blockId]: attempt.baseRevision },
            leaseTokens: { [blockId]: attempt.leaseToken },
            payload: { blockId, fields: attempt.fields },
          };
          const result = await api<CommitResult>(
            `${base}/commands`,
            jsonRequest("POST", command),
          );
          const committed = result.snapshot.blocks.find(
            (block) => block.id === blockId,
          );
          if (!committed)
            throw new ApiError(
              "The saved block could not be found. Reload the current page before editing.",
              "unavailable",
            );
          const pending = buffersRef.current[blockId];
          if (pending) {
            const updated = acknowledgeBuffer(
              pending,
              attempt.generation,
              committed.revision,
            );
            const next = { ...buffersRef.current };
            if (updated) next[blockId] = updated;
            else delete next[blockId];
            persist(next);
          }
          setBlockError(blockId, null);
          acceptSnapshot(result.snapshot);
          if (blockId !== selectedRef.current && !buffersRef.current[blockId])
            await release(blockId);
          return true;
        } catch (error) {
          const problem =
            error instanceof ApiError
              ? error
              : new ApiError(errorMessage(error), "unavailable");
          if (
            ["invalid", "locked", "stale_revision", "forbidden"].includes(
              problem.code,
            )
          ) {
            const buffer = buffersRef.current[blockId];
            if (buffer) {
              const { attempt: _attempt, ...rest } = buffer;
              persist({ ...buffersRef.current, [blockId]: rest });
            }
          }
          setBlockError(blockId, problem);
          return false;
        } finally {
          delete inFlight.current[blockId];
          if (active.current)
            setSaving(Object.keys(inFlight.current).length > 0);
        }
      })();
      inFlight.current[blockId] = task;
      return task;
    },
    [base, acquire, release, persist, setBlockError, acceptSnapshot],
  );

  const flush = useCallback(async () => {
    if (debounce.current) clearTimeout(debounce.current);
    if (maxWait.current) clearTimeout(maxWait.current);
    debounce.current = undefined;
    maxWait.current = undefined;
    // A second pass sends input typed while the first request was in flight.
    for (let pass = 0; pass < 3; pass++) {
      const ids = Object.keys(buffersRef.current);
      if (!ids.length) return true;
      const results = await Promise.all(ids.map((id) => flushBlock(id)));
      if (results.some((result) => !result)) return false;
    }
    return Object.keys(buffersRef.current).length === 0;
  }, [flushBlock]);

  const edit = useCallback(
    (block: BlockDraft, name: string, value: Json) => {
      if (
        !connected.current ||
        pendingCommand.current ||
        !leases.current[block.id]?.token ||
        Date.parse(leases.current[block.id].expiresAt) <= Date.now()
      )
        return;
      persist({
        ...buffersRef.current,
        [block.id]: editBuffer(
          buffersRef.current[block.id],
          block,
          name,
          value,
        ),
      });
      if (blockErrorsRef.current[block.id]?.code === "invalid")
        setBlockError(block.id, null);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        void flush();
      }, 500);
      if (!maxWait.current)
        maxWait.current = setTimeout(() => {
          void flush();
        }, 2000);
    },
    [persist, flush, setBlockError],
  );

  const select = useCallback(
    async (blockId: string) => {
      if (blockId === selectedRef.current) return;
      const previousId = selectedRef.current;
      for (
        let pass = 0;
        previousId && buffersRef.current[previousId] && pass < 3;
        pass++
      )
        if (!(await flushBlock(previousId))) break;
      if (previousId && buffersRef.current[previousId]) {
        setError(
          "Resolve or save your pending edits before opening another block.",
        );
        return;
      }
      if (selectedRef.current) await release(selectedRef.current);
      selectedRef.current = blockId;
      setSelectedId(blockId);
      setError(null);
      if (connected.current)
        await acquire(blockId).catch((error) => {
          if (!(error instanceof ApiError && error.code === "locked"))
            setError(errorMessage(error));
          void sync().catch(() => undefined);
        });
    },
    [flushBlock, release, acquire, sync],
  );

  const sendStructuralCommand = useCallback(
    async (command: Command): Promise<CommitResult> => {
      if (structuralRequest.current) return structuralRequest.current;
      persistCommand(command);
      const request = (async () => {
        try {
          const result = await api<CommitResult>(
            `${base}/commands`,
            jsonRequest("POST", command),
          );
          acceptSnapshot(result.snapshot);
          persistCommand(null);
          setCompletedCommand(command);
          setError(null);
          return result;
        } catch (error) {
          if (
            error instanceof ApiError &&
            !["network", "unavailable"].includes(error.code)
          )
            persistCommand(null);
          throw error;
        } finally {
          structuralRequest.current = null;
        }
      })();
      structuralRequest.current = request;
      return request;
    },
    [base, acceptSnapshot, persistCommand],
  );

  const runCommand = useCallback(
    async (
      input: { type: Command["type"]; payload: Command["payload"] },
      lockIds: string[] = [],
      extraRevisions: Record<string, number> = {},
    ) => {
      if (!connected.current)
        throw new ApiError("Reconnect before making this change.", "network");
      if (pendingCommand.current) {
        const previous = pendingCommand.current;
        if (
          previous.type !== input.type ||
          JSON.stringify(previous.payload) !== JSON.stringify(input.payload)
        )
          throw new ApiError(
            "The previous change has not been confirmed yet. Use Try again before making another change.",
            "unavailable",
          );
        return sendStructuralCommand(previous);
      }
      if (!(await flush()))
        throw new ApiError(
          "Save or resolve your pending edits first.",
          "stale_revision",
        );
      const borrowed: string[] = [];
      try {
        const expectedRevisions: Record<string, number> = { ...extraRevisions };
        const leaseTokens: Record<string, string> = {};
        for (const id of [...new Set(lockIds)].sort()) {
          const wasOwned = !!leases.current[id]?.token;
          const lease = await acquire(id);
          if (!wasOwned && id !== selectedRef.current) borrowed.push(id);
          leaseTokens[id] = lease.token!;
          const block = snapshotRef.current?.blocks.find(
            (block) => block.id === id,
          );
          if (!block)
            throw new ApiError(
              "This block was removed. Refresh and try again.",
              "stale_revision",
            );
          expectedRevisions[id] = block.revision;
        }
        const command = {
          ...input,
          mutationId: crypto.randomUUID(),
          expectedRevisions,
          leaseTokens,
        } as Command;
        return await sendStructuralCommand(command);
      } finally {
        await Promise.all(borrowed.map((id) => release(id)));
      }
    },
    [flush, acquire, release, sendStructuralCommand],
  );

  const discard = useCallback(
    async (blockId: string) => {
      const next = { ...buffersRef.current };
      delete next[blockId];
      persist(next);
      setBlockError(blockId, null);
      setError(null);
      await sync();
    },
    [persist, setBlockError, sync],
  );

  const retry = useCallback(async () => {
    setError(null);
    try {
      if (pendingCommand.current)
        await sendStructuralCommand(pendingCommand.current);
      await sync();
      for (const [id, problem] of Object.entries(blockErrorsRef.current))
        if (["network", "unavailable", "locked"].includes(problem.code)) {
          if (problem.code === "locked") {
            await acquire(id);
            const block = snapshotRef.current?.blocks.find(
              (block) => block.id === id,
            );
            if (
              buffersRef.current[id] &&
              block?.revision !== buffersRef.current[id].baseRevision
            ) {
              setBlockError(
                id,
                new ApiError(
                  "The saved block changed. Your edits are preserved.",
                  "stale_revision",
                ),
              );
              continue;
            }
          }
          setBlockError(id, null);
        }
      await flush();
    } catch (error) {
      setError(errorMessage(error));
    }
  }, [sync, acquire, setBlockError, flush, sendStructuralCommand]);

  const leave = useCallback(async () => {
    if (pendingCommand.current) {
      try {
        await sendStructuralCommand(pendingCommand.current);
      } catch (error) {
        setError(errorMessage(error));
        return false;
      }
    }
    if (!(await flush())) {
      setError(
        "Your edits are still unsaved. Resolve them before leaving this story.",
      );
      return false;
    }
    await Promise.all(Object.keys(leases.current).map((id) => release(id)));
    return true;
  }, [flush, release, sendStructuralCommand]);

  useEffect(() => {
    active.current = true;
    try {
      const recovered = readBuffers(localStorage.getItem(storageKey));
      buffersRef.current = recovered;
      setBuffers(recovered);
      const command = readPendingCommand(
        localStorage.getItem(`${storageKey}:command`),
      );
      pendingCommand.current = command;
      setUnconfirmedCommand(!!command);
    } catch {
      /* Browser storage may be unavailable; new edits remain in memory. */
    }
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    async function connect() {
      if (stopped || !navigator.onLine) return;
      setConnection("connecting");
      try {
        await sync();
      } catch (error) {
        if (!stopped) {
          setError(errorMessage(error));
          setConnection("disconnected");
          reconnect = setTimeout(connect, 3000);
        }
        return;
      }
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}${spaceUrl(`/api/cms${base}/live`)}`,
      );
      socket.onopen = async () => {
        if (stopped) return;
        connected.current = true;
        setConnection("connected");
        setError(null);
        try {
          await sync();
          if (selectedRef.current) await acquire(selectedRef.current);
          await retry();
        } catch (error) {
          if (!(error instanceof ApiError && error.code === "locked"))
            setError(errorMessage(error));
        }
      };
      socket.onmessage = () => {
        void sync().catch((error) => setError(errorMessage(error)));
      };
      socket.onclose = () => {
        connected.current = false;
        if (!stopped) {
          setConnection("disconnected");
          reconnect = setTimeout(connect, 1500);
        }
      };
      socket.onerror = () => socket?.close();
    }
    const offline = () => {
      connected.current = false;
      setConnection("disconnected");
      socket?.close();
    };
    const online = () => {
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      void connect();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(buffersRef.current).length || pendingCommand.current)
        event.preventDefault();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", warn);
    void connect();
    const interval = setInterval(async () => {
      if (!connected.current) return;
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: "heartbeat",
            revision: snapshotRef.current?.revision ?? 0,
          }),
        );
      for (const [blockId, lease] of Object.entries(leases.current)) {
        try {
          leases.current[blockId] = await api<Lease>(
            `${base}/leases`,
            jsonRequest("PATCH", { blockId, token: lease.token }),
          );
        } catch (error) {
          delete leases.current[blockId];
          if (buffersRef.current[blockId])
            setBlockError(
              blockId,
              error instanceof ApiError
                ? error
                : new ApiError(errorMessage(error), "unavailable"),
            );
        }
      }
      if (!stopped) {
        setLeaseRevision((value) => value + 1);
        await sync().catch((error) => setError(errorMessage(error)));
      }
    }, LEASE_RENEW_MS);
    return () => {
      stopped = true;
      active.current = false;
      connected.current = false;
      if (reconnect) clearTimeout(reconnect);
      if (debounce.current) clearTimeout(debounce.current);
      if (maxWait.current) clearTimeout(maxWait.current);
      clearInterval(interval);
      socket?.close();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", warn);
      for (const [blockId, lease] of Object.entries(leases.current))
        if (!buffersRef.current[blockId])
          void fetch(`/api/cms${base}/leases`, {
            ...jsonRequest("DELETE", { blockId, token: lease.token }),
            headers: { "Content-Type": "application/json", ...spaceHeaders() },
            keepalive: true,
          }).catch(() => undefined);
    };
  }, [base, storageKey, acquire, retry, sync, setBlockError]);

  const selected =
    snapshot?.blocks.find((block) => block.id === selectedId) ?? null;
  const currentLease = selectedId ? leases.current[selectedId] : undefined;
  const canEdit =
    connection === "connected" &&
    !unconfirmedCommand &&
    !!currentLease?.token &&
    Date.parse(currentLease.expiresAt) > Date.now();
  void leaseRevision;
  return {
    base,
    snapshot,
    selected,
    selectedId,
    buffers,
    connection,
    error,
    setError,
    blockErrors,
    saving,
    canEdit,
    currentLease,
    unconfirmedCommand,
    completedCommand,
    select,
    edit,
    flush,
    sync,
    runCommand,
    discard,
    retry,
    leave,
    acquire,
  };
}
