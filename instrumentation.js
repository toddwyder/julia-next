import { emitBootEvents } from './lib/boot-events.js';
import { captureApplicationError } from './lib/delivery-events.js';

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

// Next supplies the caught application error; request headers/body are never
// forwarded. A failed exporter cannot replace the original application error.
export async function onRequestError(error, _request, context) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const result = await captureApplicationError(error, context);
  console.info(JSON.stringify({ event: 'julia-next.application-error', ...result }));
}
