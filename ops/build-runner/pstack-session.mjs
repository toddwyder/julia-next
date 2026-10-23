export function resolveModelKey(settings, role) {
  const raw = typeof role === 'string' ? role : (role?.modelId ?? role?.model)
  const matches = settings.models?.[raw] ? [raw] : Object.keys(settings.models ?? {}).filter(key => settings.models[key]?.wireModel === raw)
  if (matches.length !== 1) throw new Error(`unknown or ambiguous model: ${raw}`)
  const key = matches[0]
  if (role && typeof role !== 'string') {
    for (const field of ['provider', 'route', 'service', 'wire', 'company']) {
      const expected = role[field] ?? (field === 'provider' ? role.route : undefined)
      const actual = settings.models[key][field] ?? (field === 'provider' ? settings.models[key].route : undefined)
      if (expected != null && actual != null && expected !== actual) throw new Error(`model provider mismatch: ${raw}`)
    }
  }
  return key
}

export function createPstackSession(settings, snapshot, table) {
  let orchestratorModel = resolveModelKey(settings, snapshot.roles?.orchestrator)
  let coderModel = resolveModelKey(settings, snapshot.roles?.coder)
  const machineryProof = snapshot.machineryProof === true || settings.machineryProof === true
  const machineryModel = settings.machineryModel
  if (machineryProof && (!machineryModel || !settings.models?.[machineryModel])) throw new Error('machinery model must name a configured model')
  if (machineryProof) orchestratorModel = coderModel = machineryModel
  else if ([orchestratorModel, coderModel].includes(machineryModel)) throw new Error('machinery model cannot build a real card')
  const reviewModel = machineryProof ? machineryModel : undefined
  let panelModels = []
  const pstackModels = table.split(/\r?\n/).map(line => {
    if (!line.trim() || line.trimStart().startsWith('#')) return line
    const colon = line.indexOf(':')
    if (colon < 0) throw new Error('invalid pstack model line')
    const role = line.slice(0, colon)
    const ids = line.slice(colon + 1).split(',').map(value => value.trim())
    for (const id of ids) if (!settings.models?.[id]) throw new Error(`unknown pstack model: ${id}`)
    if (role === 'interrogate reviewers') panelModels = ids
    if (!machineryProof) return line
    return `${role}: ${machineryModel}`
  }).join('\n')
  const reviewModels = machineryProof ? [machineryModel] : panelModels
  if (!machineryProof && (reviewModels.length !== 2 || new Set(reviewModels).size !== 2)) throw new Error('configured two-model code-review panel required')
  const helpers = Object.keys(settings.models).filter(id => machineryProof ? id === machineryModel : id !== machineryModel).map((modelId, index) => ({
    id: `model-${index + 1}`,
    name: modelId,
    description: `General task helper using exact model ${modelId}.`,
    instructions: 'Perform the task supplied by the parent session. Read the referenced skills and evidence before acting.',
    defaultModelId: modelId,
    maxSteps: 30,
  }))
  const unavailable = Object.entries(settings.models).filter(([, spec]) => spec.unavailable).map(([id, spec]) => `${id}: ${spec.unavailable}`)
  const reviewRule = machineryProof
    ? 'This machinery run uses the configured machinery model for every role, including its self-check. The machinery self-check is a Beam-only machinery check, not independent review; do not describe it as independent review.'
    : `A normal build requires a successful review by a different model of the actual changed files. Both configured panel models, ${reviewModels.join(' and ')}, must complete their reviews. A refused or failed handoff is not a completed review and cannot pass.`
  const hostInstructions = `The selected poteto-mode skill and its routed playbooks govern this session. They take precedence over generic SDK suggestions about task size, direct execution, or limiting helpers to parallel work. Read and follow the selected playbook, including its required artifacts. Do not waive mandatory steps based on task size. The saved card describes the code change; its exclusions of downstream delivery phases do not waive the selected skill’s internal build, review and proof work.

Pstack model settings:\n${pstackModels}\n\nHarness mapping:\nTask means the subagent tool. Choose the helper whose name is the exact model ID required by the role. Each helper is general purpose; the task supplies its role.\nHome is .builder-home. Retain the pstack-authored checklist and decision log as run evidence. These required run artifacts belong at .builder-home/pstack/checklist.md and .builder-home/pstack/decisions.tsv. These files are excluded from the card's candidate diff and retained by the host as run evidence. Keep them factual. This session owns Build only; the host owns publishing the parent PR. Publishing is outside this saved-card session. Mark that playbook step out of scope rather than claiming a PR was opened or waiting for GitHub authentication. A different helper instance using the same model is a same-model check. ${reviewRule}\nUnavailable configured models:\n${unavailable.join('\n') || 'None'}`
  const prompt = `Saved card:\n${JSON.stringify(snapshot.card, null, 2)}\n\nRead .agents/skills/poteto-mode/SKILL.md in full and follow poteto-mode for this saved card. Select and read its matching playbook, then carry out that playbook in full. Reading the skill alone does not satisfy this instruction. Retain the playbook checklist and decision trail at the harness evidence paths.`
  return { orchestratorModel, coderModel, machineryProof, reviewModel, reviewModels, helpers, pstackModels, hostInstructions, prompt }
}

export function inspectPstackRun({ events, requests, coderModel, reviewModel, reviewModels, machineryProof, checklist, decisions, cardId, changedFiles = [] }) {
  const starts = events.filter(event => event.type === 'subagent_start')
  const ends = events.filter(event => event.type === 'subagent_end')
  const completed = start => ends.find(end => end.toolCallId === start.toolCallId)
  const coder = starts.find(start => start.modelId === coderModel && /implement|build|write|code/i.test(start.task ?? '') && !/review/i.test(start.task ?? '') && completed(start)?.isError === false)
  const coderActivity = events.filter(event => event.type === 'subagent_tool_end' && event.toolCallId === coder?.toolCallId && event.isError === false && /write_file|edit_file|ast_edit|execute_command/.test(event.subToolName ?? ''))
  const coderEndIndex = coder ? events.indexOf(completed(coder)) : -1
  if (!coder) throw new Error('missing successful pstack coder task')
  if (!coderActivity.length) throw new Error('missing successful coder tool activity')
  const requiredModels = machineryProof ? [reviewModel] : reviewModels
  if (!Array.isArray(requiredModels) || requiredModels.length !== (machineryProof ? 1 : 2) || new Set(requiredModels).size !== requiredModels.length) throw new Error('configured review panel required')
  const reviewHandoffs = requiredModels.map(model => {
    const review = starts.find(start => {
    if (events.indexOf(start) <= coderEndIndex) return false
    if (!/review|audit|judge|self-check/i.test(start.task ?? '')) return false
    if (!changedFiles.some(target => String(start.task ?? '').includes(target))) return false
      return start.modelId === model
    })
    const end = review && completed(review)
    if (!review || !end) throw new Error(machineryProof ? 'missing machinery self-check of actual changed files' : 'missing configured-panel review handoff of actual changed files')
    if (end.isError || !end.result) throw new Error(machineryProof ? 'pstack machinery self-check failed' : 'pstack review failed')
    return { ...review, result: end.result, refused: false }
  })
  const reviewHandoff = reviewHandoffs.find(review => review.modelId !== coderModel) ?? reviewHandoffs[0]
  if (!checklist?.trim()) throw new Error('missing pstack checklist')
  if (checklist.split('\n').some(line => /delegat.*(?:skip|n\/a)/i.test(line))) throw new Error('pstack checklist contradicts the observed completed coder task')
  if (checklist.split('\n').some(line => /\[x\].*(?:Opening a PR|publish.*PR)/i.test(line) && !/skip|n\/a|out.of.scope|host/i.test(line))) throw new Error('publishing is outside this Build session; checklist cannot claim it completed')
  if (!/\[x\]|\bdone:/i.test(checklist)) throw new Error('missing completed checklist item')
  if (!decisions?.trim()) throw new Error('missing pstack decision log')
  return { events, starts, ends, coderActivity, hasCoder: true, hasReviewer: true, reviewHandoff, reviewHandoffs, checklist, decisions, deepseekRefusal: false, deepseekSent: requests.some(request => /deepseek/i.test(String(request.model))) }
}
