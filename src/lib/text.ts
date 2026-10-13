/** Shared text helpers: slugs, dates, reading time and word counts. */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/** Strips fenced code blocks so a word count reflects prose, not source. */
export function countWords(markdown: string): number {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
  const words = withoutCode
    .replace(/[#>*_\-|]/g, ' ')
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token))
  return words.length
}

/**
 * Counts every word including code samples. Used for reading time only: a technical
 * article with a 20-line C# block does not read as fast as the same number of prose
 * words, so the estimate has to see the code.
 */
export function countAllWords(markdown: string): number {
  const words = markdown
    .replace(/[#>*_\-|`]/g, ' ')
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token))
  return words.length
}

/**
 * 200 words per minute: technical prose with code samples does not read at the
 * 250 wpm used for fiction, and the number should not flatter the length.
 */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200))
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) {
    return iso
  }
  const [, year, month, day] = match
  const monthLabel = MONTHS[Number(month) - 1] ?? month
  return `${Number(day)} ${monthLabel} ${year}`
}

export function relativeDate(iso: string, now: Date = new Date()): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed)) {
    return iso
  }
  const days = Math.floor((now.getTime() - parsed) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase()
  return `${(parts[0] ?? '').charAt(0)}${(parts[parts.length - 1] ?? '').charAt(0)}`.toUpperCase()
}

export function excerptFrom(markdown: string, maxLength = 168): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (plain.length <= maxLength) {
    return plain
  }
  const clipped = plain.slice(0, maxLength)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : maxLength).trimEnd()}…`
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}
