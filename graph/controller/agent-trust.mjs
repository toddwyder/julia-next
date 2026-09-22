// agent-trust.mjs -- JUL-98 step 6: the agent's own folder-trust list, and the
// one pure function that adds a worktree to it.
//
// WHY THIS EXISTS AT ALL. A TUI agent asks, on a folder it has not seen before,
// whether the folder is trusted -- and then does nothing until somebody
// answers. Orca reports `input_accepted` either way. That is the 19-20
// September failure exactly: a builder sat at Claude Code's version of this
// question for about eight hours (JUL-109 findings, section 6), and the fix
// there was a trust entry written in advance.
//
// agy (the Antigravity CLI, Gemini) asks the same question. MEASURED on this
// host on 2026-09-22, by opening a brand-new folder with `agy` in a pty:
//
//   Do you trust the contents of this project?
//   Antigravity CLI requires permission to read, edit, and execute files here.
//   > Yes, I trust this folder / No, exit
//
// Answering yes wrote exactly one file, and nothing else in ~/.gemini changed:
//
//   ~/.gemini/antigravity-cli/settings.json
//   {"trustedWorkspaces":["<the folder's absolute path>"]}
//
// AND THE ENTRY IS PER EXACT PATH, like Claude Code's. Trusting an ancestor did
// not help there (findings section 6, the table of what cures the failure) and
// nothing suggests agy is different, so every new worktree gets its own entry
// rather than one entry for the workspaces directory. That is also the safer
// direction: this list grants an agent permission to execute files, and a
// blanket entry would grant it for every worktree that ever lands there.
//
// Pure, and I/O-free on purpose. The FILE is written by
// scripts/trust-worktree.mjs, which runs AS THE WORKER -- the settings file is
// 0600 and owned by `runner` (measured 2026-09-22), so the controller, running
// as `orchestrator-svc`, cannot touch it directly any more than it can read the
// worker's transcript directory (./cost-read.mjs's header).

// Keyed by the AGENT COMMAND, because that is what the launch route names.
export const TRUST_STORES = Object.freeze({
  agy: Object.freeze({ file: '.gemini/antigravity-cli/settings.json', key: 'trustedWorkspaces' }),
});

export function trustStoreFor(agent) {
  const store = TRUST_STORES[agent];
  if (!store) {
    throw new Error(`no trust store is known for the agent ${JSON.stringify(agent)} -- known: ${Object.keys(TRUST_STORES).join(', ') || 'none'}`);
  }
  return store;
}

// `text` is the settings file as it is on disk (or '' when there is none).
// Returns the text to write back and whether anything changed.
export function addTrustedWorkspace({ agent, text = '', worktreePath } = {}) {
  const store = trustStoreFor(agent);
  if (typeof worktreePath !== 'string' || !worktreePath.startsWith('/')) {
    throw new Error(`addTrustedWorkspace: the worktree path must be absolute -- the trust entry is keyed by the exact path (got ${JSON.stringify(worktreePath)})`);
  }
  const raw = String(text).trim();
  let settings;
  if (raw === '') {
    settings = {};
  } else {
    try {
      settings = JSON.parse(raw);
    } catch (error) {
      // NEVER overwritten. This file is the agent's own, not ours: replacing
      // something we could not read would throw away whatever else it holds.
      throw new Error(`addTrustedWorkspace: ${store.file} could not be read as JSON (${error.message}) -- refusing to overwrite it`);
    }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`addTrustedWorkspace: ${store.file} could not be read as JSON: its top level is not an object -- refusing to overwrite it`);
  }
  const current = Array.isArray(settings[store.key]) ? settings[store.key] : [];
  if (current.includes(worktreePath)) {
    return { text: `${JSON.stringify(settings, null, 2)}\n`, added: false, path: worktreePath, store };
  }
  const next = { ...settings, [store.key]: [...current, worktreePath] };
  return { text: `${JSON.stringify(next, null, 2)}\n`, added: true, path: worktreePath, store };
}
