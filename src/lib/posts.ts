import { site } from '../config/site'
import {
  optionalString,
  optionalStringArray,
  parseFrontMatter,
  requireString,
} from './frontmatter'
import { countAllWords, countWords, excerptFrom, readingMinutes } from './text'

/**
 * The post repository.
 *
 * Every `.md` file in `content/posts` is inlined at build time by Vite, parsed once, and
 * exposed as plain data. There is no runtime fetching and no API, so the whole blog is
 * static and works from any host — including a plain object store.
 */

export interface PostMeta {
  slug: string
  title: string
  excerpt: string
  category: string
  tags: string[]
  date: string
  level: string
  author: string
  words: number
  readingMinutes: number
}

export interface Post extends PostMeta {
  body: string
}

const modules = import.meta.glob('../content/posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function toSlug(filePath: string): string {
  const file = filePath.split('/').pop() ?? filePath
  return file.replace(/\.md$/, '').replace(/^\d+[-_]/, '')
}

function buildPost(filePath: string, source: string): Post {
  const fileName = filePath.split('/').pop() ?? filePath
  const { data, body } = parseFrontMatter(source, fileName)
  const words = countWords(body)

  return {
    slug: optionalString(data, 'slug') ?? toSlug(filePath),
    title: requireString(data, 'title', fileName),
    excerpt: optionalString(data, 'excerpt') ?? excerptFrom(body),
    category: optionalString(data, 'category') ?? 'General',
    tags: optionalStringArray(data, 'tags'),
    date: optionalString(data, 'date') ?? '2026-01-01',
    level: optionalString(data, 'level') ?? 'Advanced',
    author: optionalString(data, 'author') ?? site.author.name,
    words,
    // Reading time sees the code samples too, so a heavy article does not claim to be a two-minute read.
    readingMinutes: readingMinutes(countAllWords(body)),
    body,
  }
}

const allPosts: Post[] = Object.entries(modules)
  .map(([filePath, source]) => buildPost(filePath, source))
  .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : b.date.localeCompare(a.date)))

const bySlug = new Map<string, Post>()
for (const post of allPosts) {
  if (bySlug.has(post.slug)) {
    throw new Error(`Duplicate post slug "${post.slug}" — slugs must be unique`)
  }
  bySlug.set(post.slug, post)
}

export function listPosts(): PostMeta[] {
  return allPosts
}

export function getPost(slug: string): Post | undefined {
  return bySlug.get(slug)
}

export interface CategorySummary {
  name: string
  count: number
}

export function listCategories(): CategorySummary[] {
  const counts = new Map<string, number>()
  for (const post of allPosts) {
    counts.set(post.category, (counts.get(post.category) ?? 0) + 1)
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) =>
    b.count === a.count ? a.name.localeCompare(b.name) : b.count - a.count,
  )
}

export function listTags(limit = 24): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const post of allPosts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count === a.count ? a.name.localeCompare(b.name) : b.count - a.count))
    .slice(0, limit)
}

export interface PostQuery {
  search?: string
  category?: string
  tag?: string
  sort?: 'newest' | 'oldest' | 'title'
}

export function queryPosts(query: PostQuery): PostMeta[] {
  const needle = (query.search ?? '').trim().toLowerCase()

  const filtered = allPosts.filter((post) => {
    if (query.category !== undefined && query.category !== '' && post.category !== query.category) {
      return false
    }
    if (query.tag !== undefined && query.tag !== '' && !post.tags.includes(query.tag)) {
      return false
    }
    if (needle.length === 0) {
      return true
    }
    const haystack = [post.title, post.excerpt, post.category, post.tags.join(' '), post.body]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })

  const sorted = [...filtered]
  if (query.sort === 'oldest') {
    sorted.sort((a, b) => a.date.localeCompare(b.date))
  } else if (query.sort === 'title') {
    sorted.sort((a, b) => a.title.localeCompare(b.title))
  }
  return sorted
}

/** Same-category posts first, then the most recent others — never the post itself. */
export function relatedPosts(post: PostMeta, limit = 3): PostMeta[] {
  const sameCategory = allPosts.filter(
    (candidate) => candidate.slug !== post.slug && candidate.category === post.category,
  )
  const sharedTags = allPosts.filter(
    (candidate) =>
      candidate.slug !== post.slug &&
      candidate.category !== post.category &&
      candidate.tags.some((tag) => post.tags.includes(tag)),
  )
  const rest = allPosts.filter(
    (candidate) => candidate.slug !== post.slug && candidate.category !== post.category,
  )

  const ordered = [...sameCategory, ...sharedTags, ...rest]
  const unique = new Map<string, PostMeta>()
  for (const candidate of ordered) {
    if (!unique.has(candidate.slug)) {
      unique.set(candidate.slug, candidate)
    }
  }
  return Array.from(unique.values()).slice(0, limit)
}

export function neighbours(slug: string): { previous?: PostMeta; next?: PostMeta } {
  const index = allPosts.findIndex((post) => post.slug === slug)
  if (index === -1) {
    return {}
  }
  return {
    previous: index > 0 ? allPosts[index - 1] : undefined,
    next: index < allPosts.length - 1 ? allPosts[index + 1] : undefined,
  }
}

export function featuredPost(): PostMeta {
  const first = allPosts[0]
  if (first === undefined) {
    throw new Error('No posts found in src/content/posts')
  }
  return first
}

export function totalWords(): number {
  return allPosts.reduce((sum, post) => sum + post.words, 0)
}
