<p align="center">
  <img src="./assets/brand-mark.png" width="88" alt="Moorread">
</p>

<h1 align="center">Moorread</h1>

<p align="center">A new tab that shows the sites you actually use today.</p>

<p align="center">
  <a href="./README.md">繁體中文</a> ·
  <a href="https://falaisy.github.io/moorread/privacy/">Privacy</a> ·
  <a href="./LICENSE">License</a>
</p>

---

> **Source and credit**
> This is a personal build of [kiwiflydream/yunji-tab](https://github.com/kiwiflydream/yunji-tab) (MIT), original work © KIWI. Thank you to the author for sharing it. Native bookmark sorting is inspired by [Sortmark](https://chromewebstore.google.com/detail/sortmark/nmhnlemdhjjebiklhbjmpkiekgjjbnfc); thanks to its author for the tool and inspiration. The original license is kept in [LICENSE](./LICENSE).

## Why this exists

The more bookmarks we save, the less we open them. When we finally need one, all we remember is that a site existed somewhere.

Moorread treats the new tab as the door to that folder: everyday sites appear first, pages saved in a hurry have somewhere to wait, and older saves can be described, tagged and placed over time. It reads and writes Chrome's native bookmarks. Nothing is imported or moved, and a change here is the same change in the bookmark manager.

The extension is listed as unlisted and is mainly for my own installation. There is no support channel and no feature requests.

## How this build differs

The interface and flow follow personal habits, with Traditional Chinese (Taiwan) as the default language. Documentation and store copy were rewritten rather than reused. Licensing and credit are unchanged: MIT, original work © KIWI, modifications © 2026 falaisy.

## Install

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select `build/chrome-mv3-prod`.

## Day to day

### Two shapes for a new tab

The centered home keeps only what is needed: time, weather, search, and up to ten pinned items. Bookmarks and groups can share the row.

The workspace layout moves search and weather into the top bar and gives the rest to bookmarks. The category bar can be fixed or floating, and folder counts can be shown or hidden.

### Finding things

Search looks at names, addresses, descriptions, tags and folder paths, with fuzzy matching and Pinyin initials. Narrow it with `tag:`, `site:` or `folder:`, and save frequent queries as filters.

The same field switches to web search with your browser's default engine, or `g`, `b`, `ddg` and `gh`. `Ctrl/Cmd + K` opens the command palette.

### Saving and sorting

- **Inbox**: save now, decide on a folder and tags later; skip anything you are unsure about.
- **Groups**: sites that open together stay together, each with its own label, icon and position. Deleting a group keeps the bookmarks.
- **Bulk mode**: move, open or delete many at once, or add descriptions in a batch.
- **Extra fields**: descriptions, tags, Emoji or image icons, and multiple alternate URLs with automatic fallback.
- **Rules**: match title, address, domain, description or tag and apply a folder and tags. They run only when you press apply.
- **Link checks**: list duplicate, broken and redirected addresses without deleting anything.
- **Trash and history**: restore deletions immediately or within thirty days; operation history and sync restore points are included.
- **Tab sessions**: up to fifty sessions of one hundred pages, stored only on this device.

### Backup and sync

| Method | Contents |
| --- | --- |
| Browser sync | Chrome syncs native bookmarks; descriptions, tags, icons, pins and inbox state use sync storage |
| JSON | Extra metadata and settings |
| Full snapshot | Bookmark tree, folder hierarchy, metadata, groups, usage history and settings |
| WebDAV | Full snapshots on your own storage, versioned, with optional encryption |

Groups use separate sync storage and are not covered by the sync field selection or passphrase encryption. A full restore shows a preview first; the tree is imported into a new folder and existing bookmarks are kept.

### Appearance and weather

Five styles: Clear Sky, Minimal, Balanced, Compact and Soft; six color themes: Default, Clear Sky, Graphite, Meadow, Dawn and Berry, each supporting light, dark and system modes.

Width, density, corner radius, icon size and visible fields are all adjustable. Time and weather can be turned off separately, with 12/24-hour format, Celsius or Fahrenheit, and a city you choose. Device location is never read.

### Optional AI sorting

Add an OpenAI-compatible base URL, token and model to generate a sorting preview. Bookmarks move only after you confirm; pause, resume or stop at any point, and undo the last result within twenty-four hours. Tokens are never written to sync data or backups.

## Privacy

No account and no analytics. Site icons request domains from Google Favicon when needed. Weather, page details, link checks, AI and WebDAV connect only when you use those features. WebDAV credentials and backup passphrases stay on this device.

See the [privacy policy](https://falaisy.github.io/moorread/privacy/).

## Development

Plasmo, React 19, TypeScript, Tailwind CSS, Zustand. Requires Node.js 22+ and pnpm 10.34.4.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

- `pnpm verify`: type check, lint and unit tests
- `pnpm release`: build and package
- `pnpm docs:screenshots`: regenerate documentation screenshots

More: [Backup and restore](./docs/en/backup.en.md), [Privacy and permissions](./docs/en/privacy.en.md), [Development](./docs/en/development.en.md), [Design](./docs/zh-TW/design.md).

## License

[MIT](./LICENSE). Original work © KIWI; modifications © 2026 falaisy. The original license text is kept in full.
