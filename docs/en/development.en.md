# Development guide

[繁體中文](../zh-TW/development.md) · [Back to README](../../README.en.md)

Moorread is a Plasmo project, built and tested against Chrome Manifest V3. This guide starts with getting a working build, then moves to tests, packaging, and the implementation details that tend to bite.

## Environment

- Node.js 22 or later
- pnpm 10.34.4
- Chrome or Chromium

```bash
corepack enable
pnpm install --frozen-lockfile
```

## First run

```bash
pnpm dev
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and point it at `build/chrome-mv3-dev/`. Plasmo watches the source, rebuilds, and reloads the extension for you.

Use a spare browser profile and sample bookmarks. The extension edits native bookmarks directly, so anything you add, move, or delete while testing also changes the real data in that profile.

## Build and package

```bash
pnpm build
pnpm package
```

`pnpm build` writes to `build/chrome-mv3-prod/`; load that folder to check the production build. `pnpm package` produces the ZIP.

In this version, `pnpm release` builds, copies `LICENSE` into the output, then packages — so the upload cannot ship without its licence. There are no public Releases; the install package is generated locally when needed.

Chrome is the target that gets verified. Other Chromium browsers carry no separate compatibility promise, and Firefox and Safari have no formal workflow.

## Verify changes

```bash
pnpm typecheck
pnpm lint
pnpm test

# Install Chromium before the first end-to-end run
pnpm exec playwright install chromium
pnpm test:e2e
```

The end-to-end suite builds the extension and loads the real thing. Coverage runs through bookmark management, groups, keyboard navigation, themes, settings reset, WebDAV backup and restore, AI classification, site icons, memory, and accessibility. Pick the tests that touch your change, and clear the checks above before you commit.

## Internationalization

The interface ships two languages: `zh-TW` and `en`.

Runtime strings live in `src/lib/i18n.ts` and `src/lib/i18n-*.ts`. Components call `useI18n()` for `t` and the current `language`, and `MessageKey` keeps message keys honest. The `locales/` directory holds extension metadata only — name, description, keyboard shortcut labels — and does not replace the runtime catalogues.

Any new user-visible string goes into both languages in the same pass — errors, status text, placeholders, confirmations, `aria-label` values. Interpolation parameter names must match across languages, and dates and numbers follow the active interface language. Titles and folder names the user typed stay exactly as typed. WebDAV settings, sync history, encryption, and restore messages live in `src/lib/i18n-webdav.ts`.

Run the focused checks first, then the full set under "Verify changes":

```bash
pnpm exec vitest run src/lib/i18n.test.ts src/lib/i18n-hardcoded.test.ts
pnpm typecheck
```

The i18n tests check that interpolation parameters agree across languages; an AST check stops Chinese copy from being pasted into components and business logic. Neither replaces reading the translation or looking at the screen. After editing longer copy, check wrapping, button widths, and dialog layout on a narrow window.

## Implementation notes

### Time and weather

The widget settings sit in the synced `headerWidget` field. `normalizeHeaderWidget` fills in defaults for older data, and the field travels with backups and a General settings reset.

Weather runs on the coordinates of a city you pick by hand; searching for one asks for optional access to two Open-Meteo domains. Results are cached locally for 15 minutes. Turning the widget off or unmounting it clears timers and aborts requests still in flight. Coverage lives in `e2e/header-widget.spec.ts` and `src/lib/weather.test.ts`.

### Appearance presets

A fresh install and any missing appearance field fall back to the full Clear Sky preset (`DEFAULT_APPEARANCE_SETTINGS`). The Balanced preset builds on `BALANCED_APPEARANCE_SETTINGS`, so moving the default never drags those presets along.

Home layout is stored in `appearance.homeLayout`. When there are no appearance settings at all it reads `centered`; when saved settings simply lack the field it reads `workspace`, so an upgrade does not rearrange someone's home page. Like the category bar position, it belongs to a General reset and survives an Appearance reset. Visual rules are in [design.md](../zh-TW/design.md).

### Build configuration

The production build uses the root `.parcelrc` to pull shared dependencies through Parcel's default bundler, leaving the other Plasmo plugins in place. Those paths assume pnpm's current `node_modules/.pnpm/node_modules` layout — after upgrading Plasmo or Parcel, or changing `node-linker`, recheck every entry point and shared asset. Writing `extends` as a file path raises a Plasmo configuration notice, but the full configuration is still inherited.

### WebDAV

Connection settings and automatic check status use their own local storage and never enter synced settings or snapshots.

Once startup succeeds, the automatic backup check runs in the background: it does not delay the first paint, and a failed initialization uploads nothing. Every page coordinates saving, clearing, folder queries, reads, and uploads through a single Web Lock, and reads settings and intervals only after taking it.

Fingerprints ignore both `exportedAt` fields, stabilise object key order, and preserve native tree and array order. Each backup is one PUT of a JSON file named with a UTC millisecond timestamp and a UUID, guarded by `If-None-Match: *` so nothing is overwritten. The checkpoint advances only on success; on failure the last successful time and fingerprint stay put and automatic retries are capped. Manual backups skip the interval and the content deduplication. Changing the destination or the credentials clears the checkpoint.

The optional `encryptionPassphrase` sits in local storage with the WebDAV settings, defaults to an empty string, and is never borrowed from the browser sync passphrase. Once set, the extension reaches into `metadata-crypto.ts` for PBKDF2-SHA-256 (150,000 iterations) and AES-256-GCM, then encrypts the whole snapshot under a fresh random salt and IV. The envelope carries `kind: yunji-tab-encrypted-full-snapshot`, `schemaVersion: 1`, and a `payload`; file naming does not change.

Fingerprints always come from the plaintext snapshot, so random ciphertext cannot disturb deduplication. Setting, changing, or clearing the passphrase clears the checkpoint and queues the next automatic upload. Reads accept both plain and encrypted files: the envelope version, salt and IV lengths, and KDF iteration range (100,000 to 1,000,000) are checked before decryption, and the decrypted snapshot is validated afterwards. A missing or wrong passphrase prompts for the one used at creation — saved settings are left alone and the preview confirmation is not skipped.

History is a PROPFIND with Depth 1, parsed from the DAV-namespaced 207 XML, reading properties only from successful `propstat` entries and dropping directories, other origins, paths outside the folder, invalid filenames, and duplicate `href` values. Timestamped files sort by the UTC time in the filename; legacy fixed-name and UUID files use `getlastmodified`; anything without a time sorts last.

The interface pages through records and refreshes on demand. That list stays in memory — no local persistence, no uploaded index, no deleting remote files behind your back. Loading settings clears stale local records. Restore checks the chosen file's folder and account inside the lock, sends `If-Match` when a strong ETag is available, validates the format, then reuses the import preview and confirmation. Clearing the connection removes only local settings and check status. The WebDAV browser tests answer with simulated protocol responses, covering the real flow and folder parsing without touching a live account.

### Full snapshot restore

`restoreFullBackup` does all of it: it imports the native tree into a new folder; matching URLs take supplementary data and usage records from the snapshot; groups are restored by ID under a `replace` strategy (same ID replaced, every other existing group kept); app settings are replaced outright. Restored data then joins normal browser and extension sync. WebDAV encryption wraps only what is uploaded — `exportBackup` and `exportFullBackup` still write plaintext locally.

### Object reuse for bookmarks and categories

Bookmarks and categories are immutable object snapshots: changing one item keeps the references to the others, and a full native refresh reuses whatever did not change. Search indexes are keyed by bookmark object and category path; renaming or moving a category invalidates the affected paths. Regular view sorting ignores open counts, and a changing open count never triggers a re-score. Native title events are handled with local updates first; unknown nodes, URL changes, and structural changes still fall back to a full refresh, and a title event arriving mid-refresh discards the stale tree and reads again.

### Rendering bookmark groups

Fifty items per batch by default, shared by the regular group view and the pinned mix. Navigation counts and search match counts still cover the full list. Changing search or view mode resets the batch; drag positions still come from the index in the complete sorted list. The group's load-more button has its own accessible name, so it cannot be confused with regular bookmark pagination.

The groups page shows a grid loading state rather than a blocking overlay. Member lists that expand upward or downward both have to clear the card action buttons. Hover expansion waits 100 ms; pointer movement inside the card only repositions and does not restart the timer; leaving keeps a 200 ms closing buffer.

Buttons in the member menu should fill the space inside the border, with the text padding inside each button. A container must not leave padding that cannot be clicked, and buttons must not shrink on press, or edge clicks stop landing.

## Code layout

```text
src/
├── newtab.tsx                 # New tab entry point
├── popup.tsx                  # Toolbar popup
├── background.ts              # Background events, shortcuts, messages
├── tabs/
│   └── global-command-palette.tsx
├── components/                # Bookmarks, folders, search, dialogs
│   ├── bookmark-grid/         # Bookmark grid components and hooks
│   ├── settings/              # Settings page tabs
│   └── ui/                    # Shared UI components
└── lib/                       # Bookmarks, search, backup, sync, state

e2e/                           # Playwright end-to-end tests
locales/                       # Extension metadata translations
assets/                        # Brand icons and decorative assets
docs/                          # Screenshots, development, privacy docs
```

## Technology stack

- Plasmo — extension build and development
- React 19, TypeScript — interface and type checking
- Tailwind CSS, shadcn/ui, Radix UI — styling and interactive components
- Zustand, @plasmohq/storage — state and browser storage
- dnd-kit — drag and drop
- Vitest, Playwright, axe-core — unit tests, end-to-end tests, accessibility checks

## Relationship with native bookmarks

The extension works on the native bookmark tree and listens for creation, edits, moves, deletions, and reordering. Change something in the bookmark manager or on another device, and the home page follows the events.

| Action | Browser API |
| --- | --- |
| Create a bookmark or folder | `chrome.bookmarks.create` |
| Edit a name or URL | `chrome.bookmarks.update` |
| Move a bookmark or folder | `chrome.bookmarks.move` |
| Delete a bookmark | `chrome.bookmarks.remove` |
| Delete a folder | `chrome.bookmarks.removeTree` |

Extra fields — descriptions, tags, icons, alternate URLs — are stored by the extension. Storage and sync boundaries are in [Privacy and permissions](./privacy.en.md).

## Documentation and screenshots

After changing something users can see, update the usage notes in the README and the product description in `docs/store-description.md`, and keep the README, this guide, and the privacy document matched across Chinese and English.

When data, network requests, or permissions change, update the privacy document. When settings, storage, or testing constraints change, update this guide.

Screenshots go in `docs/images/`, taken with test data and public sites only — never real bookmarks, accounts, or credentials.

```bash
# Install the capture browser once
pnpm exec playwright install chromium
pnpm docs:screenshots
```

The command rebuilds first, then `scripts/capture-docs.mjs` loads the real extension in a temporary Chromium profile and sets up public sample bookmarks, groups, and inbox items.

Time is fixed at 2026-10-15 10:08 and weather at Taipei, clear, 26°C. Those are capture fixtures, not product defaults. The script never touches your everyday browser, uses no real accounts or credentials, and closes the browser and removes the temporary profile when done.

When it finishes, `docs/images/` holds twelve WebP images — one each for the centered home, Workspace, search, groups, command palette, inbox triage, bookmark editor, bulk management, appearance, time and weather, data backup, and WebDAV.

The script waits for bookmarks, weather, and icons, checks for horizontal overflow, and turns animations off through reduced-motion plus screenshot settings; existing images are replaced only when every capture succeeds. If something fails, a diagnostic screenshot is written to `yunji-docs-error.png` in the system temp directory. Look through the results afterwards for content, cropping, and legible text — capturing screenshots is not a regression run. The script writes PNGs; afterwards convert every PNG in `docs/images/` to a same-named WebP and delete the PNG, because the documents link to `.webp` and the PNGs would otherwise go stale and keep the folder heavy.

Both READMEs share the Chinese-interface screenshots. Adding or renaming an image means updating both READMEs and any guide that references it. Backup operations are in [Backup and restore](./backup.en.md).
