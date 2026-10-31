function createAlertScheduler({
  runCycle,
  intervalMs = 60_000,
  onError = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (typeof runCycle !== "function") throw new TypeError("runCycle must be a function");
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return { status: "skipped_overlap" };
    running = true;
    try {
      return await runCycle();
    } catch (error) {
      onError(error);
      return { status: "error" };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return false;
    timer = setIntervalFn(() => { void runOnce(); }, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearIntervalFn(timer);
    timer = null;
    return true;
  }

  return { runOnce, start, stop };
}

module.exports = { createAlertScheduler };
