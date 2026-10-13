#!/usr/bin/env node
/**
 * Content gate for the blog.
 *
 * Fails the build (or CI) when a post breaks the publishing contract:
 *   - front-matter is present and every required field is filled
 *   - at least 300 words of readable prose (code samples are excluded on purpose:
 *     the requirement is "300 words", not "300 lines of C#")
 *   - at least 300 words in total including code
 *   - slugs and titles are unique
 *   - the body has real structure (headings) and at least one code sample
 *
 * Usage: npm run validate:posts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts')

const MIN_PROSE_WORDS = 300
const MIN_TOTAL_WORDS = 300
const REQUIRED_FIELDS = ['title', 'slug', 'excerpt', 'category', 'date', 'level', 'author']

const ALIAS_TO_CANONICAL = {
  cs: 'csharp',
  'c#': 'csharp',
  csharp: 'csharp',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  json: 'json',
  xml: 'xml',
  csproj: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
}

function parseFrontMatter(source, fileName) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    throw new Error(`${fileName}: missing front-matter block`)
  }

  const data = {}
  let cursor = 1
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line.trim() === '---') {
      cursor += 1
      break
    }
    if (line.trim().length === 0) continue

    const separator = line.indexOf(':')
    if (separator === -1) throw new Error(`${fileName}: malformed front-matter line "${line}"`)

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()

    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^["']|["']$/g, ''))
        .filter((part) => part.length > 0)
    } else {
      data[key] = value.replace(/^["']|["']$/g, '')
    }
  }

  return { data, body: lines.slice(cursor).join('\n').trim() }
}

const words = (text) => text.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length

function analyse(source, fileName) {
  const { data, body } = parseFrontMatter(source, fileName)

  const codeBlocks = [...body.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)]
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_|]/g, ' ')

  const languages = codeBlocks
    .map((match) => (match[1] ?? '').trim().toLowerCase())
    .map((token) => ALIAS_TO_CANONICAL[token] ?? token)
    .filter((token) => token.length > 0)

  const problems = []
  for (const field of REQUIRED_FIELDS) {
    const value = data[field]
    if (value === undefined || (typeof value === 'string' && value.trim().length === 0)) {
      problems.push(`missing front-matter field "${field}"`)
    }
  }

  const proseWords = words(prose)
  const totalWords = words(body)

  if (proseWords < MIN_PROSE_WORDS) {
    problems.push(`prose has ${proseWords} words (minimum ${MIN_PROSE_WORDS})`)
  }
  if (totalWords < MIN_TOTAL_WORDS) {
    problems.push(`only ${totalWords} words in total`)
  }
  if (codeBlocks.length === 0) {
    problems.push('no fenced code sample')
  }
  if (codeBlocks.length > 0 && languages.length === 0) {
    problems.push('code fence without a language tag')
  }
  if (!/^##\s+/m.test(body)) {
    problems.push('no level-2 headings')
  }
  if (Array.isArray(data.tags) && data.tags.length < 3) {
    problems.push('fewer than 3 tags')
  }

  return { data, proseWords, totalWords, languages, codeBlocks: codeBlocks.length, problems }
}

const files = readdirSync(POSTS_DIR)
  .filter((name) => name.endsWith('.md') && statSync(join(POSTS_DIR, name)).isFile())
  .sort()

if (files.length === 0) {
  console.error(`No posts found in ${relative(ROOT, POSTS_DIR)}`)
  process.exit(1)
}

const seenSlugs = new Map()
const seenTitles = new Map()
const failures = []
const rows = []

for (const file of files) {
  const source = readFileSync(join(POSTS_DIR, file), 'utf8')
  try {
    const result = analyse(source, file)
    const slug = String(result.data.slug ?? '')
    const title = String(result.data.title ?? '')

    if (seenSlugs.has(slug)) {
      result.problems.push(`duplicate slug "${slug}" (also in ${seenSlugs.get(slug)})`)
    } else {
      seenSlugs.set(slug, file)
    }
    if (seenTitles.has(title)) {
      result.problems.push(`duplicate title "${title}" (also in ${seenTitles.get(title)})`)
    } else {
      seenTitles.set(title, file)
    }

    rows.push({ file, ...result })
    if (result.problems.length > 0) {
      failures.push({ file, problems: result.problems })
    }
  } catch (error) {
    failures.push({ file, problems: [error.message] })
  }
}

const pad = (value, width) => String(value).padEnd(width)
console.log(`\n ${pad('POST', 46)}${pad('CATEGORY', 30)}${pad('PROSE', 8)}${pad('TOTAL', 8)}CODE`)
console.log(` ${'-'.repeat(46 + 30 + 8 + 8 + 4)}`)
for (const row of rows) {
  console.log(
    ` ${pad(row.file, 46)}${pad(String(row.data.category ?? '—'), 30)}${pad(row.proseWords, 8)}${pad(
      row.totalWords,
      8,
    )}${row.codeBlocks}`,
  )
}

const proseTotal = rows.reduce((sum, row) => sum + row.proseWords, 0)
const totalTotal = rows.reduce((sum, row) => sum + row.totalWords, 0)
const minProse = Math.min(...rows.map((row) => row.proseWords))
const avgProse = Math.round(proseTotal / Math.max(1, rows.length))

console.log(`\n posts: ${rows.length}`)
console.log(` prose words: ${proseTotal} (min ${minProse}, average ${avgProse})`)
console.log(` total words incl. code: ${totalTotal}`)

if (failures.length > 0) {
  console.error(`\n ✗ ${failures.length} post(s) failed validation:\n`)
  for (const failure of failures) {
    console.error(`   ${failure.file}`)
    for (const problem of failure.problems) {
      console.error(`     · ${problem}`)
    }
  }
  process.exit(1)
}

console.log('\n ✓ all posts satisfy the publishing contract\n')
