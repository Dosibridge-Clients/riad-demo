# Riad — Advanced .NET Core Engineering Blog

A professional, fully static blog site: **React 18 + Vite + TypeScript**, hand-written CSS design
system, Markdown content, and **60 in-depth articles on advanced .NET Core**.

Live demo: run `npm install && npm run dev` → http://localhost:5173

---

## What is in here

| Area | Details |
| --- | --- |
| **Articles** | 60 Markdown posts in `src/content/posts/`, every one ≥ 300 words of prose (average ≈ 480, minimum 403) |
| **Categories** | 9 topic areas: ASP.NET Core, Data & EF Core, Architecture, Performance & Diagnostics, Async & Concurrency, Security & Identity, Messaging & Distributed Systems, Testing & Quality, Cloud & Deployment |
| **Pages** | Home (hero + featured + latest + categories + CTA), article library (search / filter / sort / paginate), article detail (TOC, code copy, share, related, prev-next), About, 404 |
| **Theming** | Dark by default, light theme toggle persisted to `localStorage`, no flash on load (theme applied before first paint) |
| **Quality gates** | `npm run validate:posts` enforces the content contract; `npm run build` runs `tsc` first, so a type error fails the build |

## Commands

```bash
npm install
npm run dev              # Vite dev server on http://localhost:5173
npm run build            # typecheck + production build into dist/
npm run preview          # serve the built site on http://localhost:4173
npm run validate:posts   # content gate: word counts, front-matter, structure, duplicate slugs
npm run typecheck        # tsc --noEmit
```

## Architecture

Dependencies point in one direction — `pages → components → lib → content`:

```
src/
  config/site.ts             site name, author, nav, social links, page size
  lib/
    frontmatter.ts           tiny front-matter reader (no YAML dependency)
    markdown.ts              Markdown → HTML, heading anchors, highlight.js, code-block chrome
    posts.ts                 the post repository: glob + parse + sort + search + related
    text.ts                  slugs, word counts, reading time, dates
  components/                header, footer, post card, pagination, icons, theme toggle, progress bar
  pages/                     HomePage, PostsPage, PostPage, AboutPage, NotFoundPage
  content/posts/*.md         60 articles
  styles/global.css          design tokens + component styles (dark & light)
```

### Content pipeline

1. `import.meta.glob('../content/posts/*.md', { query: '?raw', eager: true })` inlines every article at
   build time, so there is **no runtime fetching and no API**.
2. `frontmatter.ts` parses the head of each file; `posts.ts` derives the summary data (words, reading
   time, excerpt fallback) and indexes by slug — a duplicate slug throws at module load rather than
   silently shadowing a post.
3. `markdown.ts` renders the body: `marked` produces HTML, then a DOM pass adds heading ids, builds the
   table of contents, runs `highlight.js` over every code block, and wraps each one with a language
   label and a copy button (handled by one delegated click listener, not one listener per block).

### Design system

All styling lives in `src/styles/global.css` as CSS custom properties (`--bg`, `--surface`, `--accent`,
`--text-muted`, spacing and radius scales). `html[data-theme='dark']` / `[data-theme='light']` swap the
token set, so adding a theme means adding one block of variables. No UI framework, no CSS-in-JS, no
runtime style computation.

## Adding an article

Create `src/content/posts/61-my-topic.md`:

```markdown
---
title: "My new article"
slug: "my-new-topic"
excerpt: "One or two sentences that sell the article."
category: "ASP.NET Core"
tags: ["middleware", "performance"]
date: "2026-10-20"
level: "Advanced"
author: "Riad"
---

Intro paragraph with no heading.

## First section

Prose, `inline code`, and a code fence:

```csharp
var app = builder.Build();
app.Run();
```
```

Then run `npm run validate:posts` and `npm run build`. The content gate fails on: a missing
front-matter field, fewer than 300 words of prose, no fenced code sample, a fence without a language
tag, no `##` headings, fewer than three tags, or a duplicate slug/title.

## Quality checks performed

- `npm run validate:posts` → 60 posts, 28,963 prose words, minimum 403, average 483 — all pass.
- `npm run build` → typecheck clean, production bundle built.
- Layout audited in a real browser at **320 / 390 / 768 / 1280 px**: zero horizontal overflow, zero
  console errors, single-column grid below 760 px, 2 columns to 1024 px, 3 columns above.
- Two defects were found by that audit and fixed: the header brand pushed the menu button off-screen
  below 560 px, and long code lines widened the article column (missing `min-width: 0` on grid items)
  instead of scrolling inside the code block.
- Contrast checked in both themes: body text 16.2:1, muted text 6.6:1 on the light background.

## Deployment

The build is static, so any host works. For GitHub Pages (project site under `/riad-demo/`):

```bash
npm run build -- --base=/riad-demo/
```

A ready workflow is included at `.github/workflows/deploy-pages.yml`; enable **Settings → Pages →
Source: GitHub Actions**, then push to `main`. For a root domain (Cloudflare Pages, Netlify, S3, nginx)
build with the default base — no configuration needed.

## Notes

- The article page and About page are code-split; the Markdown compiler and highlighter load only when
  an article is opened.
- `site.ts` holds the site name, author name/role and social links — change them there, not in
  components.
