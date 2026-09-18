import { emitBootEvents } from './lib/boot-events.js';

// Next.js calls `register()` once per server runtime at startup. Only the
// Node.js runtime has the environment this module reads, and only there is it
// safe to emit boot telemetry, so every other runtime is a no-op.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    await emitBootEvents();
  } catch (err) {
    console.warn('julia-next: instrumentation register failed:', err?.message ?? err);
  }
}
