# Vinnie Docs

The official documentation website for Vinnie, built with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build). It is a standalone project: it has its own `package.json` and
lockfile, uses npm, and does not affect the desktop app's build, lint, or tests.

## Requirements

- Node.js 20.19 or later
- npm

## Commands

Run these from the `vinnie-docs/` folder.

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at `http://localhost:4321` with hot reload |
| `npm run build` | Build the static site into `dist/`, build the search index, and validate all internal links |
| `npm run preview` | Serve the production build locally |
| `npm run check` | Type-check Astro components and content |

Search (Pagefind) is generated during `npm run build`, so it only works with `npm run preview` or a deployed
build, not in `npm run dev`.

## Project layout

```text
vinnie-docs/
├── astro.config.mjs          Site config: title, sidebar, edit links, theme, plugins
├── public/                   Static files served as-is (favicon, dragon mark)
└── src/
    ├── assets/               Images processed by Astro (header logo)
    ├── components/
    │   ├── home/             Homepage sections (search launcher, architecture flow, latest updates)
    │   ├── overrides/        Starlight overrides (dark-first theme, breadcrumbs, version badge)
    │   └── Changelog.astro   Full changelog, rendered on the Changelog page
    ├── content/docs/         All pages, one folder per sidebar section
    ├── data/
    │   ├── changelog.ts      Changelog entries (homepage and Changelog page)
    │   └── version.ts        Vinnie version shown in the header, and the repository URL
    ├── styles/vinnie.css     Theme colors and custom styles
    └── content.config.ts     Content collection setup
```

## Writing pages

Pages are Markdown (`.md`) or MDX (`.mdx`, when a page needs components) files in `src/content/docs/`. Every
page needs frontmatter:

```md
---
title: Page Title
description: One sentence shown in search results and link previews.
sidebar:
  order: 3
---
```

- **Sidebar.** Each sidebar group is generated from one folder (see `sidebar` in `astro.config.mjs`). A new file
  in a folder appears automatically; `sidebar.order` sets its position. A new section needs a new folder and a
  new entry in `astro.config.mjs`.
- **Links.** Link to other pages with root-relative paths and a trailing slash, for example
  `/mcp/adding-mcp-servers/`. The build fails on broken internal links or anchors
  ([starlight-links-validator](https://github.com/HiDeoo/starlight-links-validator)). Write local URLs such as
  `http://localhost:11434` in backticks so they aren't turned into links.
- **Callouts.** Use Starlight asides: `:::note`, `:::tip`, `:::caution`, `:::danger`.
- **Code blocks.** Fenced blocks get syntax highlighting and a copy button. Use a language tag (`powershell`,
  `json`, `ts`, `text`, …).

### Accuracy rules

These docs describe what Vinnie actually does.

- Document only behavior that exists in the code. Check the source before describing a setting, command, limit,
  or message.
- Mark anything not implemented yet as **Planned**.
- Where information doesn't exist yet (for example a license or security policy), say so with a
  `:::note[Requires documentation]` aside instead of guessing.
- Don't add placeholder pages, mock screenshots, or paths from a specific machine. Use `%APPDATA%`,
  `%LOCALAPPDATA%`, and paths relative to the repository.

## Version and changelog

- Update `VINNIE_VERSION` in `src/data/version.ts` when Vinnie's version changes. It appears as the badge next to
  the site title.
- Add new entries to the top of `src/data/changelog.ts`. The homepage shows the three newest, and
  **Additional → Changelog** shows all of them.

## Theme

The site defaults to dark mode on a visitor's first visit; after that, the theme picker is respected. Colors are
defined as CSS variables in `src/styles/vinnie.css` for both dark and light themes.

## Deploying

The output in `dist/` is a static site and can be hosted anywhere that serves static files.

Before deploying, set `site` in `astro.config.mjs` to the real URL. It is currently a placeholder
(`https://vinnie-docs.example.invalid`) and is used for canonical links and the sitemap. If the site is served
from a sub-path, also set Astro's `base` option.

Edit links point to `master` on [github.com/1anP33in/vinnie](https://github.com/1anP33in/vinnie)
(`editLink.baseUrl` in `astro.config.mjs`).
