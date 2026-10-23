export function resolveModelKey(settings, role) {
  const raw = typeof role === 'string' ? role : (role?.modelId ?? role?.model)
  if (settings.models?.[raw]) {
    if (role && typeof role !== 'string') {
      for (const field of ['provider', 'route', 'service', 'wire', 'company']) {
        const expected = role[field] ?? (field === 'provider' ? role.route : undefined)
        const actual = settings.models[raw][field] ?? (field === 'provider' ? settings.models[raw].route : undefined)
        if (expected != null && actual != null && expected !== actual) throw new Error(`model provider mismatch: ${raw}`)
      }
    }
    return raw
  }
  const matches = Object.keys(settings.models ?? {}).filter(key => settings.models[key]?.wireModel === raw)
  if (matches.length === 1) return matches[0]
  throw new Error(`unknown or ambiguous model: ${raw}`)
}

export function createPstackSession(settings, snapshot, table) {
  const orchestratorModel = resolveModelKey(settings, snapshot.roles?.orchestrator)
  const coderModel = resolveModelKey(settings, snapshot.roles?.coder)
  const machineryProof = snapshot.machineryProof === true || settings.machineryProof === true
  const reviewModel = settings.machineryReviewModel
  if (machineryProof && (!settings.models?.[reviewModel] || reviewModel === coderModel)) throw new Error('distinct machinery review model required')
  const pstackModels = table.split(/\r?\n/).map(line => {
    if (!line.trim() || line.trimStart().startsWith('#')) return line
    const colon = line.indexOf(':')
    if (colon < 0) throw new Error('invalid pstack model line')
    const role = line.slice(0, colon)
    const ids = line.slice(colon + 1).split(',').map(value => value.trim())
    for (const id of ids) if (!settings.models?.[id]) throw new Error(`unknown pstack model: ${id}`)
    if (!machineryProof) return line
    const selected = /review|judgment|cross-judge/.test(role) ? [reviewModel] : [coderModel]
    return `${role}: ${selected.join(', ')}`
  }).join('\n')
  const helpers = Object.keys(settings.models).map((modelId, index) => ({
    id: `model-${index + 1}`,
    name: modelId,
    description: `General task helper using exact model ${modelId}.`,
    instructions: 'Perform the task supplied by the parent session. Read the referenced skills and evidence before acting.',
    defaultModelId: modelId,
    maxSteps: 30,
  }))
  const unavailable = Object.entries(settings.models).filter(([, spec]) => spec.unavailable).map(([id, spec]) => `${id}: ${spec.unavailable}`)
  const hostInstructions = `The selected poteto-mode skill and its routed playbooks govern this session. They take precedence over generic SDK suggestions about task size, direct execution, or limiting helpers to parallel work. Read and follow the selected playbook, including its required artifacts. Do not waive mandatory steps based on task size. The saved card describes the code change; its exclusions of downstream delivery phases do not waive the selected skill’s internal build, review and proof work.

Pstack model settings:\n${pstackModels}\n\nHarness mapping:\nTask means the subagent tool. Choose the helper whose name is the exact model ID required by the role. Each helper is general purpose; the task supplies its role.\nHome is .builder-home. Retain the pstack-authored checklist and decision log as run evidence. These required run artifacts belong at .builder-home/pstack/checklist.md and .builder-home/pstack/decisions.tsv. These files are excluded from the card's candidate diff and retained by the host as run evidence. Keep them factual. A different helper instance using the same model is a same-model check. A paid review refused by the connection core is a refused handoff, never a completed model-diverse review; record that distinction in both checklist and decision log.\nUnavailable configured models:\n${unavailable.join('\n') || 'None'}`
  const prompt = `Saved card:\n${JSON.stringify(snapshot.card, null, 2)}\n\nRead .agents/skills/poteto-mode/SKILL.md in full and follow poteto-mode for this saved card. Select and read its matching playbook, then carry out that playbook in full. Reading the skill alone does not satisfy this instruction. Retain the playbook checklist and decision trail at the harness evidence paths.`
  return { orchestratorModel, coderModel, machineryProof, reviewModel, helpers, pstackModels, hostInstructions, prompt }
}

export function inspectPstackRun({ events, requests, coderModel, reviewModel, machineryProof, checklist, decisions, cardId, changedFiles = [] }) {
  const starts = events.filter(event => event.type === 'subagent_start')
  const ends = events.filter(event => event.type === 'subagent_end')
  const completed = start => ends.find(end => end.toolCallId === start.toolCallId)
  const coder = starts.find(start => start.modelId === coderModel && /implement|build|write|code/i.test(start.task ?? '') && !/review/i.test(start.task ?? '') && completed(start)?.isError === false)
  const coderActivity = events.filter(event => event.type === 'subagent_tool_end' && event.toolCallId === coder?.toolCallId && event.isError === false && /write_file|edit_file|ast_edit|execute_command/.test(event.subToolName ?? ''))
  const coderEndIndex = coder ? events.indexOf(completed(coder)) : -1
  const review = starts.find(start => events.indexOf(start) > coderEndIndex && start.modelId !== coderModel && /review|audit|judge/i.test(start.task ?? '') && [cardId, ...changedFiles].filter(Boolean).some(target => String(start.task).includes(target)))
  const end = review && completed(review)
  if (!coder) throw new Error('missing successful pstack coder task')
  if (!coderActivity.length) throw new Error('missing successful coder tool activity')
  if (!review || !end) throw new Error('missing distinct-model review handoff')
  const refusal = end.isError && String(end.result).includes('Trial forbids nonzero model prices')
  if (machineryProof) {
    if (review.modelId !== reviewModel || !refusal) throw new Error('missing review model cap refusal')
    if (!requests.some(request => review.modelId.endsWith(String(request.model)) && String(request.refusal).includes('Trial forbids nonzero model prices'))) throw new Error('missing connection-core refusal')
  } else if (end.isError || !end.result) throw new Error('pstack review failed')
  if (!checklist?.trim()) throw new Error('missing pstack checklist')
  if (checklist.split('\n').some(line => /delegat.*(?:skip|n\/a)/i.test(line))) throw new Error('pstack checklist contradicts the observed completed coder task')
  if (!/\[x\]|\bdone:/i.test(checklist)) throw new Error('missing completed checklist item')
  if (!decisions?.trim()) throw new Error('missing pstack decision log')
  return { events, starts, ends, coderActivity, hasCoder: true, hasReviewer: !end.isError, reviewHandoff: { ...review, result: end.result, refused: refusal }, checklist, decisions, deepseekRefusal: machineryProof && refusal, deepseekSent: requests.some(request => /deepseek/i.test(String(request.model)) && request.status != null) }
}
