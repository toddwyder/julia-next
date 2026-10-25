export function resolveModelKey(settings, role) {
  const raw = typeof role === 'string' ? role : (role?.modelId ?? role?.model)
  const route = typeof role === 'string' ? undefined : (role?.route ?? role?.provider)
  let matches = settings.models?.[raw] ? [raw] : Object.keys(settings.models ?? {}).filter(key => {
    const spec = settings.models[key]
    return spec?.modelId === raw || spec?.wireModel === raw
  })
  if (route) {
    const routed = matches.filter(key => {
      const spec = settings.models[key]
      return (spec?.route ?? spec?.provider) === route
    })
    if (routed.length) matches = routed
  }
  if (matches.length !== 1) throw new Error(`unknown or ambiguous model: ${raw}`)
  return matches[0]
}

export function createPstackSession(settings, snapshot, table) {
  let orchestratorModel = resolveModelKey(settings, snapshot.roles?.orchestrator)
  let coderModel = resolveModelKey(settings, snapshot.roles?.coder)
  const machineryProof = snapshot.machineryProof === true || settings.machineryProof === true
  const machineryModel = settings.machineryModel
  if (machineryProof && (!machineryModel || !settings.models?.[machineryModel])) throw new Error('machinery model must name a configured model')
  if (machineryProof) orchestratorModel = coderModel = machineryModel
  const referencedModels = new Set()
  const pstackModels = table.split(/\r?\n/).map(line => {
    if (!line.trim() || line.trimStart().startsWith('#')) return line
    const colon = line.indexOf(':')
    if (colon < 0) throw new Error('invalid pstack model line')
    const role = line.slice(0, colon)
    const ids = line.slice(colon + 1).split(',').map(value => value.trim())
    for (const id of ids) {
      if (!settings.models?.[id]) throw new Error(`unknown pstack model: ${id}`)
      referencedModels.add(id)
    }
    if (!machineryProof) return line
    return `${role}: ${machineryModel}`
  }).join('\n')
  const helperModels = machineryProof
    ? [machineryModel]
    : [...new Set([...referencedModels, orchestratorModel, coderModel])]
  const helpers = helperModels.map((modelId, index) => ({
    id: `model-${index + 1}`,
    name: modelId,
    description: `General task helper using exact model ${modelId}.`,
    instructions: 'Perform the task supplied by the parent session. Read the referenced skills and evidence before acting.',
    defaultModelId: modelId,
    maxSteps: 100,
  }))
  const unavailable = Object.entries(settings.models).filter(([, spec]) => spec.unavailable).map(([id, spec]) => `${id}: ${spec.unavailable}`)
  const hostInstructions = `The selected poteto-mode skill and its routed playbooks govern this session. Read and follow the selected playbook, including its required artifacts. Do not waive mandatory steps based on task size.

Pstack model settings:\n${pstackModels}\n\nHarness mapping:\nTask means the subagent tool. Choose the helper whose name is the exact model ID required by the role. Each helper is general purpose; the task supplies its role.\nHome is .builder-home. Retain the pstack-authored checklist and decision log as run evidence. These required run artifacts belong at .builder-home/pstack/checklist.md and .builder-home/pstack/decisions.tsv. These files are excluded from the card's candidate diff and retained by the host as run evidence. Keep them factual. This session owns Build only; the host owns publishing the parent PR. Publishing is outside this saved-card session. Mark that playbook step out of scope rather than claiming a PR was opened or waiting for GitHub authentication. The host owns git remotes, branches, publishing, pull requests and GitHub credentials. Do not search the machine for them; mark that step out of scope and continue. The evidence review judges the result against the saved card. A missing checklist or a build with no real change is reported unproven there; this session does not decide that.
Unavailable configured models:\n${unavailable.join('\n') || 'None'}`
  const prompt = `Saved card:\n${JSON.stringify(snapshot.card, null, 2)}\n\nRead .agents/skills/poteto-mode/SKILL.md in full and follow poteto-mode for this repository task. Select and read its matching playbook, then carry out that playbook. Reading the skill alone does not satisfy this instruction. Retain the playbook checklist and decision trail at the harness evidence paths.`
  return { orchestratorModel, coderModel, machineryProof, helpers, pstackModels, hostInstructions, prompt }
}

export function inspectPstackRun({ events, requests, checklist, decisions, changedFiles = [] }) {
  const unproven = []
  if (!checklist?.trim()) unproven.push('missing checklist')
  if (!changedFiles.length) unproven.push('no real change')
  return {
    events,
    requests,
    checklist: checklist?.trim() ? checklist : null,
    decisions: decisions?.trim() ? decisions : null,
    changedFiles,
    unproven,
    next: unproven.length ? 'Remediation' : 'Evidence review',
  }
}
