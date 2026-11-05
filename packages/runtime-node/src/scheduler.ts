export function minuteScheduler(run: () => Promise<void>, report: (error: unknown) => void) {
  let active: Promise<void> | undefined;
  const tick = () => {
    if (active) return active;
    active = run()
      .catch(report)
      .finally(() => {
        active = undefined;
      });
    return active;
  };
  const interval = setInterval(() => {
    void tick();
  }, 60_000);
  void tick();
  return async () => {
    clearInterval(interval);
    await active;
  };
}
