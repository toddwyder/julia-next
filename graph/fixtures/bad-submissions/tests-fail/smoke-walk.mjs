// smoke-walk.mjs: walks steps along the main path.
// Contains a bug: on step failure, accesses step.stepName instead of step.name,
// leaving failedStep undefined.
export async function smokeWalk(baseUrl, { fetch = globalThis.fetch } = {}) {
  const steps = [
    { name: 'home', path: '/' },
    { name: 'recipes', path: '/recipes' },
    { name: 'planner', path: '/planner' },
  ];
  const stepResults = [];
  for (const step of steps) {
    const url = new URL(step.path, baseUrl).toString();
    const res = await fetch(url);
    const stepResult = { name: step.name, ok: res.ok, status: res.status };
    stepResults.push(stepResult);
    if (!res.ok) {
      return { ok: false, failedStep: step.stepName, steps: stepResults };
    }
  }
  return { ok: true, steps: stepResults };
}
