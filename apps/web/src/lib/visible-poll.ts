// Timer, focus and visibility events can coincide when Chrome wakes a background tab.
export function visiblePoll(read: () => Promise<void>, interval: number) {
  let pending: Promise<void> | undefined;
  let invalidated = false;
  let stopped = false;

  function refresh(): Promise<void> {
    if (stopped || document.hidden) return Promise.resolve();
    pending ??= Promise.resolve().then(async () => {
      try {
        do {
          invalidated = false;
          if (!stopped && !document.hidden) await read();
        } while (invalidated && !stopped && !document.hidden);
      } finally {
        pending = undefined;
      }
    });
    return pending;
  }
  void refresh();
  const timer = window.setInterval(refresh, interval);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return {
    // A mutation can finish while a pre-mutation read is still in flight.
    invalidate() {
      invalidated = true;
      return refresh();
    },
    stop() {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    },
  };
}
