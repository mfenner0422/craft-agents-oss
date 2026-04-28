/**
 * Markdown → Telegram MarkdownV2 formatting.
 *
 * Telegram MarkdownV2 requires escaping special characters outside of
 * code blocks.
 */

/** Characters that must be escaped in Telegram MarkdownV2. */
const TG_SPECIAL_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g
const SOFT_MESSAGE_LIMIT = 3500
const HARD_MESSAGE_LIMIT = 4096

/** Escape text for Telegram MarkdownV2 parse mode. */
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(TG_SPECIAL_CHARS, '\\$1')
}

function escapeInlineCode(text: string): string {
  return text.replace(/([`\\])/g, '\\$1')
}

function escapeLinkUrl(url: string): string {
  return url.replace(/([)\\])/g, '\\$1')
}

function formatInlineMarkdown(text: string): string {
  const tokens: string[] = []
  let working = text

  working = working.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `\u0000${tokens.length}\u0000`
    tokens.push(`\`${escapeInlineCode(code)}\``)
    return token
  })

  working = working.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const token = `\u0000${tokens.length}\u0000`
    tokens.push(`[${escapeTelegramMarkdown(label)}](${escapeLinkUrl(url)})`)
    return token
  })

  const escaped = escapeTelegramMarkdown(working)
  return escaped.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] ?? '')
}

function formatTableBlocks(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const next = lines[i + 1]
    const startsTable = line.includes('|') && !!next?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/)
    if (!startsTable) {
      out.push(line)
      continue
    }

    const table: string[] = [line, next!]
    i += 2
    while (i < lines.length && lines[i]!.includes('|')) {
      table.push(lines[i]!)
      i += 1
    }
    i -= 1
    out.push(`\`\`\`\n${table.join('\n')}\n\`\`\``)
  }
  return out.join('\n')
}

function formatPlainSegment(text: string): string {
  return formatTableBlocks(text)
    .split(/(```[\s\S]*?```)/g)
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const body = part.slice(3, -3).replace(/^\w+\n/, '')
        return `\`\`\`\n${escapeInlineCode(body.trimEnd())}\n\`\`\``
      }
      return formatInlineMarkdown(part)
    })
    .join('')
}

/**
 * Convert CommonMark-ish agent output into Telegram MarkdownV2.
 */
export function formatForTelegram(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const body = part.slice(3, -3).replace(/^\w+\n/, '')
        return `\`\`\`\n${escapeInlineCode(body.trimEnd())}\n\`\`\``
      }
      return formatPlainSegment(part)
    })
    .join('')
}

export function splitTelegramMessages(text: string, softLimit = SOFT_MESSAGE_LIMIT): string[] {
  if (text.length <= softLimit) return [text]

  const chunks: string[] = []
  let current = ''
  let inCodeBlock = false

  for (const paragraph of text.split(/(\n\n+)/)) {
    const nextInCodeBlock = inCodeBlock
    const candidate = current + paragraph
    if (!inCodeBlock && current && candidate.length > softLimit) {
      chunks.push(current.trimEnd())
      current = paragraph
    } else if (paragraph.length > HARD_MESSAGE_LIMIT) {
      if (current.trim()) chunks.push(current.trimEnd())
      for (let i = 0; i < paragraph.length; i += softLimit) {
        chunks.push(paragraph.slice(i, i + softLimit))
      }
      current = ''
    } else {
      current = candidate
    }

    const fences = (paragraph.match(/```/g) ?? []).length
    if (fences % 2 === 1) inCodeBlock = !nextInCodeBlock
  }

  if (current.trim()) chunks.push(current.trimEnd())
  return chunks.length > 0 ? chunks : ['']
}
