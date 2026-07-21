// app/instrumentation.ts
// Next.js instrumentation hook — initialize the scheduler singleton once,
// only in the Node.js runtime.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("../lib/scheduler");
    startScheduler();
  }
}
