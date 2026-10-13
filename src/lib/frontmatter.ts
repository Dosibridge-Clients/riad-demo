/**
 * A deliberately tiny front-matter reader.
 *
 * The blog ships its posts as Markdown with a fixed, known front-matter shape, so a
 * full YAML parser is unnecessary weight in the client bundle. This handles exactly
 * that shape (quoted scalars, numbers, and JSON-style string arrays) and stays
 * predictable: anything it cannot parse is reported rather than silently guessed.
 */

export type FrontMatterValue = string | number | string[]

export interface FrontMatterResult {
  data: Record<string, FrontMatterValue>
  body: string
}

const DELIMITER = /^---\s*$/

function parseValue(raw: string): FrontMatterValue {
  const value = raw.trim()

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (inner.length === 0) {
      return []
    }
    return inner
      .split(',')
      .map((part) => part.trim().replace(/^["']|["']$/g, ''))
      .filter((part) => part.length > 0)
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  return value.replace(/^["']|["']$/g, '')
}

export function parseFrontMatter(source: string, sourceName: string): FrontMatterResult {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)

  if (lines.length === 0 || !DELIMITER.test(lines[0] ?? '')) {
    throw new Error(`Missing front-matter block in ${sourceName}`)
  }

  const data: Record<string, FrontMatterValue> = {}
  let cursor = 1

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? ''
    if (DELIMITER.test(line)) {
      cursor += 1
      break
    }
    if (line.trim().length === 0) {
      continue
    }

    const separator = line.indexOf(':')
    if (separator === -1) {
      throw new Error(`Malformed front-matter line in ${sourceName}: ${line}`)
    }

    const key = line.slice(0, separator).trim()
    data[key] = parseValue(line.slice(separator + 1))
  }

  return { data, body: lines.slice(cursor).join('\n').trim() }
}

export function requireString(
  data: Record<string, FrontMatterValue>,
  key: string,
  sourceName: string,
): string {
  const value = data[key]
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  throw new Error(`Front-matter "${key}" must be a non-empty string in ${sourceName}`)
}

export function optionalString(
  data: Record<string, FrontMatterValue>,
  key: string,
): string | undefined {
  const value = data[key]
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return undefined
}

export function optionalStringArray(
  data: Record<string, FrontMatterValue>,
  key: string,
): string[] {
  const value = data[key]
  if (Array.isArray(value)) {
    return value.filter((item) => item.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value]
  }
  return []
}
