const SKIPPED_STEP = /\b(?:skip(?:ped)?|n\/a|not applicable|out of scope)\b/i

function checklistStatus(text, checked) {
  if (checked) return 'finished'
  if (/\bdone:/i.test(text)) return 'finished'
  if (SKIPPED_STEP.test(text)) return 'skipped'
  return 'pending'
}

export function summarizeChecklist(items) {
  const summary = { finished: 0, skipped: 0, pending: 0 }
  for (const item of items) summary[item.status] += 1
  return summary
}

export function parseChecklist(text) {
  const items = []
  for (const line of String(text).split(/\r?\n/)) {
    const indent = /^([ \t]*)/.exec(line)?.[1] ?? ''
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2)
    const checkbox = /^[ \t]*(?:[-*]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/.exec(line)
    if (checkbox) {
      const item = checkbox[2].trim()
      if (item) items.push({ text: item, status: checklistStatus(item, checkbox[1].toLowerCase() === 'x'), depth })
      continue
    }
    const numbered = /^[ \t]*\d+[.)]\s+(.+)$/.exec(line)
    if (!numbered) continue
    const item = numbered[1].trim()
    if (!item) continue
    items.push({ text: item, status: checklistStatus(item, false), depth })
  }
  return items
}
