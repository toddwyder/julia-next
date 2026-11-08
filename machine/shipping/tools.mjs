// A review starts the app to try it, then reads the app's output. Asking for
// that output with a blocking wait holds the review inside the tool call until
// the process exits, and a server never does: the review of 8 Nov sat there for
// ten minutes with the model doing nothing. The wait stays available for a
// process that has already finished, and is refused while one is still running,
// so a review reads what is there and moves on.

export const GET_PROCESS_OUTPUT = 'mastra_workspace_get_process_output';

const RUNNING_REFUSAL = pid =>
  [
    `Refused: process ${pid} is still running, so a blocking wait would hold this review until it exits, and a server does not exit.`,
    `Read what it has printed so far by calling get_process_output again with the pid and no wait.`,
    'To wait for a server to come up, run a bounded check instead, such as `for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:PORT/api/health && exit 0; sleep 1; done; exit 1`.',
  ].join(' ');

function isGetProcessOutput({ toolName, workspaceToolName }) {
  return workspaceToolName === GET_PROCESS_OUTPUT || toolName === 'get_process_output';
}

// Whether the process this call names has not exited yet. A handle the manager
// does not know about is not something to refuse: the tool answers that itself.
export async function stillRunning(processes, pid) {
  if (!processes?.get) return false;
  const handle = await processes.get(String(pid));
  return Boolean(handle) && handle.exitCode === undefined;
}

// The `beforeToolCall` hook Mastra runs for a workspace tool. `{ proceed: false }`
// returns the refusal as the tool's output, so the model reads the reason and
// the next step it should take instead of retrying the same wait.
export function refuseBlockingWait({ workspaceToolName, toolName, input, context } = {}) {
  if (!isGetProcessOutput({ toolName, workspaceToolName })) return undefined;
  if (input?.wait !== true) return undefined;
  const processes = context?.workspace?.sandbox?.processes;
  return stillRunning(processes, input?.pid).then(running =>
    running ? { proceed: false, output: RUNNING_REFUSAL(input.pid) } : undefined
  );
}

// The workspace's tool config carries mastracode's own names and its plan-mode
// guard, so the refusal is chained onto that guard rather than replacing it.
export function installBlockingWaitRefusal(workspace) {
  if (!workspace?.setToolsConfig) return false;
  const existing = workspace.getToolsConfig() ?? {};
  const previous = existing.hooks?.beforeToolCall;
  workspace.setToolsConfig({
    ...existing,
    hooks: {
      ...existing.hooks,
      beforeToolCall: async hookContext => {
        const refusal = await refuseBlockingWait(hookContext);
        if (refusal) return refusal;
        return previous ? previous(hookContext) : undefined;
      },
    },
  });
  return true;
}
