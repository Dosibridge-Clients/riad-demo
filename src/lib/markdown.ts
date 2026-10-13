import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import json from 'highlight.js/lib/languages/json'
import sql from 'highlight.js/lib/languages/sql'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import plaintext from 'highlight.js/lib/languages/plaintext'
import { slugify } from './text'

/**
 * Markdown → HTML for blog posts.
 *
 * `marked` produces the HTML; the DOM pass that follows then does the three things a
 * plain renderer cannot: stable anchor ids for the table of contents, syntax
 * highlighting, and the chrome around each code block. Running it on a parsed document
 * (rather than on strings) means the post body never round-trips through regexes.
 */

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('json', json)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('plaintext', plaintext)

export interface TocEntry {
  id: string
  text: string
  depth: 2 | 3
}

export interface RenderedPost {
  html: string
  toc: TocEntry[]
}

const LANGUAGE_ALIASES: Record<string, string> = {
  cs: 'csharp',
  csharp: 'csharp',
  'c#': 'csharp',
  sh: 'bash',
  shell: 'bash',
  console: 'bash',
  bash: 'bash',
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  csproj: 'xml',
  html: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  text: 'plaintext',
  txt: 'plaintext',
}

function resolveLanguage(token: string): string | null {
  const normalised = token.trim().toLowerCase()
  if (normalised.length === 0) {
    return null
  }
  const mapped = LANGUAGE_ALIASES[normalised]
  return mapped !== undefined && hljs.getLanguage(mapped) ? mapped : null
}

function languageOf(code: Element): string {
  const fromClass = Array.from(code.classList)
    .filter((name) => name.startsWith('language-'))
    .map((name) => name.replace('language-', ''))
    .shift()
  return fromClass ?? code.getAttribute('data-lang') ?? ''
}

function highlightCode(code: Element): void {
  const token = languageOf(code)
  const language = resolveLanguage(token)
  const source = code.textContent ?? ''

  if (language === null || source.trim().length === 0) {
    return
  }

  code.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value
  code.classList.add('hljs')
}

function decorateCodeBlocks(doc: Document): void {
  doc.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code')
    if (code === null) {
      return
    }

    highlightCode(code)

    const wrapper = doc.createElement('div')
    wrapper.className = 'code-block'

    const head = doc.createElement('div')
    head.className = 'code-block__head'

    const label = doc.createElement('span')
    label.className = 'code-block__lang'
    const token = languageOf(code)
    label.textContent = token.length > 0 && token !== 'text' ? token : 'code'

    const copy = doc.createElement('button')
    copy.type = 'button'
    copy.className = 'code-block__copy'
    copy.setAttribute('data-copy-code', 'true')
    copy.textContent = 'Copy'

    head.append(label, copy)
    wrapper.append(head)

    pre.replaceWith(wrapper)
    wrapper.append(pre)
  })
}

function annotateHeadings(doc: Document, toc: TocEntry[]): void {
  const seen = new Map<string, number>()

  doc.querySelectorAll('h2, h3').forEach((heading) => {
    const text = (heading.textContent ?? '').trim()
    const base = slugify(text).length > 0 ? slugify(text) : 'section'
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const id = count === 1 ? base : `${base}-${count}`

    heading.id = id
    toc.push({ id, text, depth: heading.tagName === 'H2' ? 2 : 3 })
  })
}

export function renderMarkdown(markdown: string): RenderedPost {
  const raw = marked.parse(markdown, { gfm: true, breaks: false, async: false }) as string
  const doc = new DOMParser().parseFromString(raw, 'text/html')

  const toc: TocEntry[] = []
  annotateHeadings(doc, toc)
  decorateCodeBlocks(doc)

  return { html: doc.body.innerHTML, toc }
}
