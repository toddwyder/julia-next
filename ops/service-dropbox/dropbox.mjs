// dropbox.mjs -- JUL-72's one-time code drop box.
//
// Runs as its own dedicated system account (dropbox-svc), NOT the `runner`
// builder account and NOT `orchestrator-svc`: same-UID processes can read each other's
// environment via /proc/<pid>/environ, so the account that briefly handles
// four raw bearer tokens must not be an account any builder worktree or the
// publisher also runs as.
//
// Todd's browser -> this process -> a root-owned sudo helper
// (write-secret.sh) -> the protected file. This process itself never has
// write access to the destination files -- it can only invoke the one
// fixed helper script via a narrowly scoped NOPASSWD sudo rule (see
// README.md's one-time root install steps), and the helper is the only
// thing that ever touches the target path. A value is passed to the helper
// over stdin, never argv (argv is visible to any other process via /proc or
// `ps`; stdin to a short-lived child process is not).
//
// Not every field lands with the same reader (JUL-77 added DeepSeek, which
// the runner/builder account reads, not just orchestrator-svc) -- see
// FIELD_GROUPS below, which write-secret.sh's case statement must match
// exactly (write-secret.test.mjs asserts this).
//
// Values are never logged, echoed back in any response, or held longer
// than the single request that carries them -- see logField() below, which
// is the only thing allowed to touch process.stdout/stderr for a field,
// and it only ever logs the field NAME and a pass/fail boolean.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const FIELDS = [
  'sentry', 'supabase', 'powersync', 'axiom', 'deepseek', 'linear',
  'linear-app-id', 'linear-app-secret', 'commandcode',
];

// Which group write-secret.sh chowns each field's file to on the server --
// the single source of truth for "who can read this key" (JUL-77). The
// original four are all orchestrator-svc-only, unchanged. write-secret.sh's
// own test asserts its case statement matches this exactly, so the two
// files can never silently drift apart.
export const FIELD_GROUPS = {
  sentry: 'orchestrator-svc',
  supabase: 'orchestrator-svc',
  powersync: 'orchestrator-svc',
  axiom: 'orchestrator-svc',
  // Pi builder and reviewer (runner) AND the orchestrator-deepseek route -- a
  // dedicated group with both accounts as members (see README.md's one-time
  // setup), never orchestrator-svc's own group directly -- that would let
  // runner read the orchestrator-only fields
  // (sentry/supabase/powersync/axiom/linear) too.
  deepseek: 'deepseek-readers',
  // Orchestrator-svc only, same as the original four.
  linear: 'orchestrator-svc',
  // The controller's own Linear identity (an OAuth app, client-credentials
  // tokens): the app's client ID and client secret. Orchestrator-svc only --
  // never a group runner is in, since these let the holder act as the
  // controller on the board.
  'linear-app-id': 'orchestrator-svc',
  'linear-app-secret': 'orchestrator-svc',
  // Command Code GOAT reviewer trial (JUL-98, Todd's 13:43Z Decision):
  // read by the Pi route (runner) the same way deepseek is, AND by
  // orchestrator-svc for a coordinator-run probe -- a dedicated group,
  // same reasoning as deepseek-readers above, not either account's
  // existing group.
  commandcode: 'commandcode-readers',
};

// Shape checks are deliberately loose -- the point is to catch an obviously
// wrong paste (an empty box, a pasted URL, a pasted sentence with spaces),
// not to validate a provider's exact token grammar, which none of Sentry's,
// Supabase's, PowerSync's, or Axiom's own docs specify precisely enough to
// hard-code (checked live, JUL-72 research pass, 2026-09-17 -- each confirms
// only the dashboard page that mints the token, not a documented format).
const MIN_LENGTH = 20;
export function validateFieldShape(name, rawValue) {
  if (!FIELDS.includes(name)) {
    return { ok: false, reason: `unknown field: ${name}` };
  }
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if (/\s/.test(value)) return { ok: false, reason: 'contains whitespace -- tokens are one unbroken string' };
  if (value.length < MIN_LENGTH) return { ok: false, reason: `too short (expected at least ${MIN_LENGTH} characters)` };
  if (/^https?:\/\//i.test(value)) return { ok: false, reason: 'looks like a URL, not a token' };
  return { ok: true, value };
}

// The only function allowed to write a field's raw value to a log/console
// call -- and it never does; it logs the field name and outcome only. Kept
// as a single named chokepoint so a future change can't accidentally start
// logging `value` by editing a call site instead of this function.
export function logField(name, ok) {
  console.log(`dropbox: field=${name} ${ok ? 'received' : 'rejected'}`);
}

const DEFAULT_STATE = { armedAt: null, received: {}, usedAt: null };

export async function loadState(statePath) {
  try {
    const raw = await readFile(statePath, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE, armedAt: new Date().toISOString() };
    throw err;
  }
}

export async function saveState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// A partial round (fewer than all four boxes filled in) used to disarm the
// whole page on its very first Save -- Todd flagged this as "a new question
// waiting to happen" (JUL-72 walkthrough-correction Instruction, 2026-09-17):
// each field now saves independently the moment it's received, and the page
// only goes off once every field in FIELDS has been received, or the
// 24-hour window passes, whichever comes first. A received field stays open:
// a new value pasted over it replaces the old one (a token may turn out to
// have the wrong scopes), and a box left blank leaves the saved value alone.
export function allReceived(state) {
  return FIELDS.every((f) => state.received && state.received[f] === true);
}

// Exported and pure (no I/O) so both the server and its tests can reason
// about "armed" identically without needing a real clock or a real file.
export function isArmed(state, nowMs) {
  if (allReceived(state)) return false;
  if (!state.armedAt) return false;
  const armedAtMs = Date.parse(state.armedAt);
  if (Number.isNaN(armedAtMs)) return false;
  return (nowMs - armedAtMs) < TWENTY_FOUR_HOURS_MS;
}

// Re-arms the box for a future sitting. Not reachable over HTTP -- run
// manually over SSH as dropbox-svc (or via sudo -u dropbox-svc) between
// sittings; see README.md. Deliberately not a network-reachable endpoint:
// re-arming is a decision this box should never make for itself.
export async function rearm(statePath, { now = () => new Date() } = {}) {
  const state = { armedAt: now().toISOString(), received: {}, usedAt: null };
  await saveState(statePath, state);
  return state;
}

function defaultSecretWriterFactory({ execImpl = execFile, helperPath }) {
  return (name, value) => new Promise((resolve, reject) => {
    const child = execImpl('sudo', ['-n', helperPath, name], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`write-secret helper failed for field ${name}: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
    child.stdin.end(value);
  });
}

const PAGE_HEAD = '<!doctype html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Julia-next setup codes</title>'
  + '<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1a1a1a}'
  + 'label{display:block;margin-top:20px;font-weight:600}'
  + '.hint{font-weight:400;color:#555;font-size:0.9em;margin-top:2px}'
  + 'input{width:100%;box-sizing:border-box;padding:8px;font-size:1em;margin-top:6px}'
  + 'button{margin-top:28px;padding:10px 20px;font-size:1em}'
  + '.status{margin-top:6px;font-size:0.9em}'
  + '.ok{color:#0a7a2f}.bad{color:#a30000}</style></head><body>';

const HINTS = {
  sentry: 'From Sentry: your account menu -> Personal Tokens (not an Organization Token). A long string of letters/numbers, no spaces.',
  supabase: 'From Supabase: Account -> Access Tokens. A long string of letters/numbers, no spaces.',
  powersync: 'From PowerSync: Account -> Access Tokens. A long string of letters/numbers, no spaces.',
  axiom: 'From Axiom: Settings -> API tokens. A long string of letters/numbers, no spaces.',
  deepseek: 'From DeepSeek: Platform -> API keys. A long string of letters/numbers, no spaces.',
  commandcode: 'From Command Code: your account -> API keys. A long string of letters/numbers, no spaces.',
  linear: 'From Linear: Settings -> Security & access -> Personal API keys. A long string of letters/numbers, no spaces.',
  'linear-app-id': 'From Linear: Settings -> API -> OAuth applications -> Julia controller (created with client credentials tokens switched on) -> Client ID. A long string of letters/numbers, no spaces.',
  'linear-app-secret': 'From Linear: the same Julia controller page -> Client secret (shown once, right after you create the app). A long string of letters/numbers, no spaces.',
};

// Boxes whose name is not just the field id capitalised.
const LABELS = {
  'linear-app-id': 'Julia controller: client ID',
  'linear-app-secret': 'Julia controller: client secret',
};

function renderForm(state) {
  const received = state.received || {};
  const boxes = FIELDS.map((f) => {
    const done = received[f] === true;
    return `
    <label for="${f}">${LABELS[f] ?? `${f[0].toUpperCase()}${f.slice(1)}`}
      <div class="hint">${HINTS[f]}</div>
    </label>
    <input type="text" id="${f}" name="${f}" autocomplete="off" spellcheck="false">
    <div class="status ${done ? 'ok' : ''}" id="${f}-status">${done ? 'received ✓ (paste a new value here to replace it)' : ''}</div>
  `;
  }).join('\n');
  return `${PAGE_HEAD}
  <h1>Julia-next setup codes</h1>
  <p><strong>Each box saves on its own the moment you click Save</strong> -- you can fill in one now
  and come back for the rest later, in any order. Boxes already marked "received ✓" are saved; leave them
  blank to keep what is there, or paste a new value to replace it. This page turns itself off only
  once every box is received, or after 24 hours, whichever comes first.</p>
  <form id="f">${boxes}
    <button type="submit">Save</button>
  </form>
  <p id="progress" style="display:none;font-weight:600"></p>
  <p id="done" style="display:none;font-weight:600">Saved. Everything received -- this page is now off.</p>
  <script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const f of ${JSON.stringify(FIELDS)}) {
      const el = document.getElementById(f);
      if (!el || el.value === '') continue;
      body[f] = el.value;
    }
    const res = await fetch('/save', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
    const result = await res.json();
    for (const f of ${JSON.stringify(FIELDS)}) {
      const el = document.getElementById(f + '-status');
      const input = document.getElementById(f);
      const r = result[f];
      if (!r) continue;
      el.textContent = r.ok ? 'received ✓' : "doesn't look right ✗ (" + r.reason + ')';
      el.className = 'status ' + (r.ok ? 'ok' : 'bad');
      if (r.ok) input.value = '';
    }
    if (result.allReceived) {
      document.getElementById('f').style.display = 'none';
      document.getElementById('done').style.display = 'block';
    } else {
      document.getElementById('progress').textContent = 'Saved so far. Come back any time for the rest -- this page stays on.';
      document.getElementById('progress').style.display = 'block';
    }
  });
  </script>
  </body></html>`;
}

const OFF_PAGE = `${PAGE_HEAD}<h1>This one-time setup page is off</h1>
<p>It has already been used, or its 24-hour window has passed. Ask the agent to re-arm it for a new sitting.</p>
</body></html>`;

export function createServer({
  statePath,
  writeSecret,
  now = () => Date.now(),
}) {
  return http.createServer(async (req, res) => {
    const state = await loadState(statePath);
    const armed = isArmed(state, now());

    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(armed ? renderForm(state) : OFF_PAGE);
      return;
    }

    if (req.method === 'POST' && req.url === '/save') {
      if (!armed) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'this box is off' }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
      req.on('end', async () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid request' }));
          return;
        }
        const received = { ...(state.received || {}) };
        const result = {};
        for (const field of FIELDS) {
          // A field received earlier is not skipped: a non-blank value replaces
          // it (write-secret.sh moves the new file over the old one, so no
          // copy of the old value is kept). A blank one leaves it untouched,
          // and a rejected one never reaches the writer, so a working value
          // survives a bad paste.
          const raw = parsed[field];
          if (raw === undefined || raw === '') continue; // left blank this round -- fine, ask again next time
          const shape = validateFieldShape(field, raw);
          logField(field, shape.ok);
          if (!shape.ok) {
            result[field] = { ok: false, reason: shape.reason };
            continue;
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            await writeSecret(field, shape.value);
            result[field] = { ok: true };
            received[field] = true;
          } catch {
            // Deliberately not including the underlying error's message --
            // it could echo the value back via a shell/stderr path (same
            // reasoning as scripts/publish-pr.mjs's push-error handling).
            result[field] = { ok: false, reason: 'could not be saved -- see the server-side log for detail, not this message' };
          }
        }
        const nowComplete = FIELDS.every((f) => received[f] === true);
        const newState = {
          ...state,
          received,
          usedAt: nowComplete ? new Date(now()).toISOString() : state.usedAt,
        };
        await saveState(statePath, newState);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...result, allReceived: nowComplete }));
        if (nowComplete) {
          console.log('dropbox: all fields received -- box is now off');
        }
      });
      return;
    }

    res.writeHead(404).end();
  });
}

async function main() {
  const BIND_ADDR = process.env.DROPBOX_BIND_ADDR;
  const PORT = Number(process.env.DROPBOX_PORT || 8945);
  const STATE_PATH = process.env.DROPBOX_STATE_PATH || '/var/lib/dropbox-svc/state.json';
  const HELPER_PATH = process.env.DROPBOX_HELPER_PATH || '/opt/orca-runner/service-dropbox/write-secret.sh';

  // Refuse to start bound to every interface or unset -- "reachable only
  // over Tailscale" is a network-layer property this process cannot verify
  // from inside itself, but it CAN refuse the one config mistake that would
  // silently defeat it (an empty/0.0.0.0/:: bind exposing every interface,
  // including the public one).
  if (!BIND_ADDR || BIND_ADDR === '0.0.0.0' || BIND_ADDR === '::') {
    throw new Error('DROPBOX_BIND_ADDR must be set to this host\'s Tailscale IP explicitly -- refusing to bind to all interfaces');
  }

  const writeSecret = defaultSecretWriterFactory({ helperPath: HELPER_PATH });
  const server = createServer({ statePath: STATE_PATH, writeSecret });
  server.listen(PORT, BIND_ADDR, () => {
    console.log(`dropbox listening on ${BIND_ADDR}:${PORT}`);
  });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--rearm') {
    const STATE_PATH = process.env.DROPBOX_STATE_PATH || '/var/lib/dropbox-svc/state.json';
    rearm(STATE_PATH).then((s) => console.log(`dropbox re-armed at ${s.armedAt}`));
  } else {
    main();
  }
}
