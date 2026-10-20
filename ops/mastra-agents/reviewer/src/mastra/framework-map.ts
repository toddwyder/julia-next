import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const reviewer = 'ops/mastra-agents/reviewer/'

export function isFrameworkMapRecord(text: string) {
  return /^(?:#{1,6}[ \t]+.*|\*\*)?Framework[ -]Map\b/im.test(text)
    || /docs\/[\w./-]*framework-map\.md/i.test(text)
}

function readRepositoryFile(path: string) {
  const absolute = realpathSync(resolve(root, path))
  const local = relative(realpathSync(root), absolute)
  if (local.startsWith('..') || isAbsolute(local)) throw new Error('outside repository')
  return readFileSync(absolute, 'utf8')
}

// Comments are the pre-plan record. Repository maps are followed only when linked,
// never selected by guessing a filename from the card identifier.
export function frameworkMapFindings(description: string, comments: string[] = []) {
  const issues: string[] = []
  const maps = comments.filter(isFrameworkMapRecord)
  const inline = /#{1,6}\s+Framework[ -]Map\b/i.exec(description)
  if (inline) maps.push(description.slice(inline.index))
  for (const source of [description, ...maps]) {
    for (const match of source.matchAll(/(?:https:\/\/github\.com\/toddwyder\/julia-next\/blob\/[^/]+\/)?(docs\/[\w./-]*framework-map\.md)/gi)) {
      try { maps.push(readRepositoryFile(match[1]!)) }
      catch { issues.push(`Framework Map: cannot read ${match[1]}`) }
    }
  }
  if (!maps.length && /Read the Framework Map comment before building\./i.test(description)) {
    issues.push('Framework Map: missing comment or linked repository map')
  }
  for (const map of new Set(maps)) {
    for (const row of map.split('\n').filter(line => line.trim())) {
      // Exceptions must be attached to the affected job, not inferred from generic
      // documentation or an unrelated decision elsewhere in the card.
      const exception = /framework gap|no (?:public(?:hed)?|published)(?:[^|.]*?)page|private[^|.]*?(?:files?|formats?)|provider-owned (?:writer-lock|IDE|session)|(?:\.codex|\.commandcode)[/\\]|JSONL readers/i.test(row.replace(/\b(?:no|without) private[- ](?:files?|formats?) (?:discovery|access|reading)\b/gi, ''))
      const decision = /\[[^\]]*Todd[^\]]*decision[^\]]*\]\(https:\/\/(?:linear\.app\/[^\s)]+|github\.com\/toddwyder\/julia-next\/(?:blob|issues|pull)\/[^\s)]+)\)/i.test(row)
      if (exception && !decision) issues.push(`Framework Map: linked Todd decision required for ${row.split('|')[1]?.trim() || row.trim()}`)
      const citations = [...row.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+(?::[\d,-]+)?)`|((?:[\w.@-]+\/)*node_modules\/[^\s`"“”<>|),;]+)/g)]
      for (let index = 0; index < citations.length; index++) {
        const citation = citations[index]!
        const citedPath = (citation[1] || citation[2])!
        let path = citedPath.replace(/\\/g, '/').replace(/:[\d,-]+$/, '').replace(/^(@[^/]+\/[^/@]+|[^/@]+)@[^/]+\//, '$1/')
        if (/^@[^/]+\/[^/]+$/.test(path)) continue // A scoped package/version has no file segment.
        const installed = path.includes('node_modules/') || /^(?:@[^/]+\/|[\w.-]+\/)/.test(path) && !/^(?:docs|scripts|ops|src|proof|test|tests|dist|\.agents|\.claude)\//.test(path)
        if (!installed) continue
        let content: string
        try {
          try { content = readRepositoryFile(path) }
          catch (error) {
            if (path.includes('node_modules/') && !path.startsWith('node_modules/')) throw error
            // Maps also cite retained evidence relative to docs/agents.
            // Resolve that repository file before interpreting a bare npm path.
            if (!path.includes('node_modules/')) {
              try { content = readRepositoryFile(`docs/agents/${path}`) }
              catch { content = readRepositoryFile(`${reviewer}node_modules/${path}`) }
            } else content = readRepositoryFile(`${reviewer}${path}`)
          }
        }
        catch {
          issues.push(`Framework Map: installed file not found: ${citedPath}`)
          continue
        }
        const start = index === 0 ? row.lastIndexOf('|', citation.index!) + 1 : citation.index! + citation[0].length
        const following = row.slice(start, citations[index + 1]?.index)
        for (const quote of following.matchAll(/[“"]([^”"\n]+)[”"]/g)) {
          if (!content.toLowerCase().includes(quote[1]!.toLowerCase())) {
            issues.push(`Framework Map: section "${quote[1]}" not found in ${citedPath}`)
          }
        }
      }
    }
  }
  return [...new Set(issues)]
}
