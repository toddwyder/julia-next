#!/usr/bin/env node
// effort.mjs -- JUL-79 step 3: translate the ticket's one Low/Medium/High
// choice ("Todd chooses each agent's model and effort on the card") into the
// CLI spelling each seat-table entry actually understands.
//
// This is pure and vendor-knowledge-only on purpose: the label groups that
// let Todd pick a level, and the Linear writes behind them, are later steps.
// Keeping the mapping here means a future label reader and today's launch
// commands can never disagree about what "High" means for a vendor, and the
// live-verified spellings below are pinned by scripts/effort.test.mjs instead
// of being rediscovered per vendor.
//
// The three spellings, each live-verified against the vendor's own CLI:
//   - claude      : `claude --effort low|medium|high` (live --help check).
//   - codex       : `codex -c model_reasoning_effort=low|medium|high`.
//   - pi (DeepSeek): `pi --thinking <level>` (the level is required); Low is
//     `off`, Medium/High pass `medium`/`high`. Pi's own models.json
//     `thinkingLevelMap` turns the level into the model's internal setting.
export const EFFORT_LEVELS = ['low', 'medium', 'high'];
export const DEFAULT_EFFORT = 'medium';

// An omitted OR unrecognized effort is Medium -- the ticket's stated default
// ("defaults are always visible, never implied: ... default model, Medium
// effort") and never a throw. Missing is the common case (today no caller
// passes one yet); a typo falling back to the documented default is safer than
// a five-minute run dying on a shell-argument parse error.
export function normalizeEffort(effort) {
  return EFFORT_LEVELS.includes(effort) ? effort : DEFAULT_EFFORT;
}

// Returns the argv entries to append to that entry's launch command -- an
// array so callers spread it into an argv list, never interpolate it. An
// unknown ENTRY throws, the same discipline as
// orchestratorLaunchCommandFor: silently launching the wrong vendor because a
// seat name was misspelled is exactly the bug this guard exists to prevent.
export function translateEffort(entry, effort) {
  const level = normalizeEffort(effort);
  if (entry === 'claude') return ['--effort', level];
  if (entry === 'codex') return ['-c', `model_reasoning_effort=${level}`];
  if (entry === 'pi-deepseek') {
    // `--thinking` needs its level or Pi swallows the next argument.
    return ['--thinking', level === 'low' ? 'off' : level];
  }
  throw new Error(`unknown orchestrator seat-table entry: ${entry}`);
}
