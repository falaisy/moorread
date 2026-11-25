# Privacy and permissions

[繁體中文](../zh-TW/privacy.md) · [Back to README](../../README.en.md)

This page answers three questions only: where your data lives, when it leaves this computer, and what each permission is for.

Moorread needs no extra account, uses no third-party analytics or tracking SDKs, and sends no usage statistics to the developer. Some usage history (bookmark open counts and last-opened times) stays on this device and is included in a full snapshot only when you choose to back up.

## Where data lives

| Data | Storage and sync |
| --- | --- |
| Native bookmark names, addresses and folders | Managed by the browser; cross-device sync depends on the browser's bookmark sync settings |
| Descriptions, tags, custom icons, alternate URLs, pins, inbox state, folder icons | Local storage, synced across devices through browser sync by default; fields are selectable and passphrase encryption is available |
| Group titles, descriptions, icons, member addresses, member labels, order and pins | Separate browser sync storage, outside the metadata field selection and passphrase encryption |
| Interface and feature settings | Browser sync storage; AI service tokens are not synced |
| Usage history (bookmark open counts and last-opened times), tab sessions, trash, operation history, caches | Stays on this device normally; when you create and upload a full snapshot, usage history is sent with it to your configured Gist/WebDAV |
| AI service API token | Local only; never synced or backed up |
| WebDAV address, account, app password, backup passphrase, automatic backup check state | Local only; never synced or included in exported backups. **The app password is kept only for the current browser session** and is cleared when the extension is updated or reloaded, or when the browser restarts, so it must be re-entered |
| GitHub Gist token, Gist ID and backup passphrase | Stored with app settings in Chrome sync storage; when Chrome sync is enabled, the Chrome sync service carries them to your other devices. During backup, the token is sent to the GitHub API as an authentication credential and the Gist ID appears in the GitHub API request path; the backup passphrase is not sent to other services. The token and passphrase are not written into backups; the Gist ID is a non-credential resource identifier and may be included with app settings in snapshots |

Two devices stay in step only when both are signed in to the same Chrome account, browser sync is on, and the same extension is installed. Sync status and advanced metadata options sit under Settings → Data & privacy.

A browser showing "uploaded" does not mean another device has received it, and Moorread has no separate cloud account or server.

Groups connect to existing bookmarks by address, so they do not depend on bookmark IDs that differ between devices. Deleting a group does not delete native bookmarks. Group settings are included in metadata backups and full snapshots.

## When the extension connects

### Time and weather

Time follows the device time zone. Weather requires a manual city search; device location is never read.

A search requests optional access to two Open-Meteo domains and sends the city keyword to `geocoding-api.open-meteo.com`. Once configured, the chosen city's coordinates and temperature unit go to `api.open-meteo.com`.

The service sees the IP address of an ordinary network request, but never bookmarks or browsing history.

City and display settings follow browser settings and are included in backups; weather results are cached locally for 15 minutes. Turning weather off stops automatic requests, and no request is made without a city.

Adjust it from the time and weather widget on the home page or Settings → General → Time and weather. Optional site access can be revoked in Data & privacy.

### Site icons

When bookmark cards are displayed, the bookmark domain is sent to Google's Favicon service on demand. Paths, query parameters and page content are not sent. If the remote request fails, the browser's own favicon interface is used.

A custom image URL on a bookmark or group means the browser will go and fetch that image.

### Alternate URLs

With alternate URLs configured, clicking a bookmark requests the primary and alternate addresses together and uses whichever responds first. Requests go only to the addresses you entered.

### Page details and link checks

Access to a site is requested only when you ask for a page description or run a link check. The request reads page details or determines whether a link is broken or redirected. Optional access can be revoked in settings.

### AI sorting

AI sorting requires your own OpenAI-compatible service. A run sends bookmark titles, addresses with query parameters and anchors removed, descriptions, tags, the folder path each bookmark is currently in, internal bookmark IDs, the complete folder list (IDs and paths), the model name and the classification prompt you configured. That service processes the data; browsing history, open counts, tabs, trash and operation history are never sent. Read that service's privacy policy first.

Before every new run and every resume, the interface shows a separate consent dialog listing the destination host, the purpose, the exact fields above, what is not sent, and how the token and automatic retries are handled. A request is sent only after you press "Agree and send"; cancelling, closing the dialog, pressing Escape or an incomplete consent flow sends no request containing bookmark data. Consent applies to that run only, is never stored and is never reused for another run; pressing "Continue" after an error requires a new consent. If a request temporarily fails inside the same run, it is retried automatically up to 2 times with identical content under that consent.

Connection tests and model listing require their own consent: only the token is sent to your configured service, with no bookmarks, folder lists or classification content, and that consent cannot be used for AI sorting.

The extension generates a sorting and move preview, and changes folders only after you confirm. API tokens stay local and are never synced or backed up.

### Web search

When you switch to web search and submit a query, it goes to the chosen search engine, or to the browser's default service if none is chosen.

### WebDAV backup

WebDAV is off by default. When you configure a connection, optional host access is requested for that server address, and only the account and app password are sent to it.

**The app password is kept only for the current browser session.** It is never written to sync or backups, and it is cleared when the extension is updated or reloaded, or when the browser restarts. Re-enter it once to resume automatic backups. Bookmarks and existing remote backup files are unaffected.

The remote server must use HTTPS (HTTP is allowed for local testing only), and requests do not follow redirects. Testing a connection queries the directory; a manual backup, or automatic backup once enabled, uploads a full snapshot containing the bookmark tree, metadata, groups, folder icons, usage history and interface settings. WebDAV credentials, the Gist token/passphrase and AI tokens are not in the snapshot; the Gist ID is a non-credential resource identifier and may be included with app settings.

Before the first manual backup, before automatic backup is first enabled, and before the first connection test, remote listing or restore, the interface shows a disclosure dialog: the destination server, what this transfer contains (a full snapshot for uploads; reads for connection tests, listings and restores, with no snapshot uploaded), and how credentials are stored and sent. It requires an explicit agreement button. Uploads and reads (connection tests, remote listings, restores) are separate consent scopes, and Gist and WebDAV are independent. Declining, a failed consent-record read, or a malformed consent record means no snapshot is exported and no request is sent. Automatic backup also requires agreement first; after an upgrade, an enabled setting without consent shows "Automatic backup is paused", and one click on "Agree again and resume automatic backup" restores it with the original settings kept, without uploading immediately.

You can revoke all backup consent under "Backup transfer consent" in Data & privacy. After revocation there are no spontaneous transfers at all (including automatic backup), and manual uploads, connection tests, remote listings and restores ask again. Existing Gist/WebDAV connection settings and credentials remain. To stop automatic backup, revoking consent is enough; you do not need to untick the checkbox or reopen the settings page.

Automatic backup is off by default. It checks only after the home page opens and local data loads, and uploads when the configured interval has passed and the content has changed. It uses no background timer, `alarms` or system notifications.

The backup passphrase starts empty, and an empty passphrase uploads plain text. Save one once, and later backups reuse it: PBKDF2-SHA-256 derives the key, AES-256-GCM encrypts the whole snapshot before it leaves the machine. Groups are inside that envelope — wider coverage than browser sync encryption, which only wraps metadata.

This passphrase has nothing to do with the browser sync passphrase. It stays on this machine: not synced, not written into backup files, not placed in request headers. Editing or clearing it resets the automatic backup checkpoint, which only affects later backups; files already written still need the passphrase they were created with.

A restore tries the local passphrase first. If it is missing or does not match, you can enter one temporarily; it lives only in the current interface's memory and does not change saved settings. A failed decryption never reaches the import step. Without the passphrase, the corresponding encrypted file cannot be restored.

Remote access control is yours to configure. Each successful upload creates a new file named `moorread-backup-YYYYMMDDThhmmssSSSZ-<UUID>.json` (UTC timestamp, e.g. `moorread-backup-20261011T100000000Z-<UUID>.json`), never overwriting older files and never re-uploading a fixed "latest" copy. After a successful upload, only the newest 10 backups are kept, and older ones are deleted on a best-effort basis, including recognizable legacy `yunji-tab-*` names; a failed delete neither affects the completed backup nor your local bookmarks. You can still manage or delete these files in your cloud storage yourself.

Sync history reads the WebDAV directory listing and shows it in memory only. It is not persisted locally, and no index is uploaded. Other devices see the same list when connected to the same directory; older fixed backups and UUID history files are recognised too.

A restore reads the selected file from the same directory configured for the current account. When the server provides a strong ETag, a conditional request detects changes. After format validation, a preview appears and the import happens only after confirmation. A failed directory listing shows an error; a failed upload or unchanged content creates no remote record.

Locally, only the connection settings, last check and success times, content fingerprint and current result are kept, to control the automatic backup rate and avoid duplicates; older local records are cleaned up. Clearing the connection removes local credentials and state without deleting remote files; optional site access can be revoked separately in Data & privacy.

### GitHub Gist backup

Gist backup is off by default. It requires a GitHub Personal Access Token with the `gist` scope that you provide. The token, Gist ID and backup passphrase are stored with app settings in Chrome sync storage; when Chrome sync is enabled, the Chrome sync service carries them to your other devices. During backup, the token is sent to GitHub as an authentication credential for the GitHub API, and the Gist ID is sent to GitHub as the target Gist identifier; the backup passphrase is not sent to other services and is never written into backups. The developer does not receive this data, but that does not mean there is no third-party transmission.

Backups upload a single `moorread-backup.json` to `https://api.github.com/gists`, containing a full snapshot (bookmark tree, metadata, groups, folder icons, usage history and interface settings). The snapshot never includes the Gist token, Gist passphrase, WebDAV credentials, AI tokens or any other credential fields. A gist holds exactly this one file and each upload updates it, so there are no multiple historical versions.

Before the first upload, the interface shows a disclosure dialog: the destination is GitHub Gist, a full snapshot is uploaded, which data types it contains, and that the token, Gist ID and backup passphrase live in Chrome sync storage and sync across devices. An explicit agreement button is required before uploading; declining exports no snapshot and calls no GitHub API. Testing the Gist connection and reading from Gist use a separate read consent: the dialog explains that no snapshot is uploaded and that the token is sent to `api.github.com` in the Authorization header. Without consent, or when the consent record cannot be read or is malformed, nothing is read and no API is called. Revocation works the same way as for WebDAV, described in the previous section.

Encryption is optional. When enabled, PBKDF2-SHA-256 (150,000 iterations) derives a key and AES-256-GCM encrypts the snapshot locally before upload. The passphrase stays in Chrome sync settings, is not written into the backup file, and is not sent in GitHub API request headers. Unencrypted backups are stored as plaintext in your GitHub Gist; if you have uploaded unencrypted backups, consider rotating your GitHub token.

Restore reads the existing Gist ID and detects an encrypted envelope; encrypted backups require the passphrase used at upload. Older unencrypted backups restore directly.

## Permission purposes

| Permission | Purpose |
| --- | --- |
| `storage` | Settings, local metadata and cross-device sync data |
| `bookmarks` | Read and manage native browser bookmarks |
| `favicon` | Retrieve site icons through the browser interface |
| `activeTab` | Read the current page when you use quick save or the global command |
| `scripting` | Inject the isolated global command palette into ordinary pages on demand |
| `contextMenus` | Provide the "Save this page" context menu item |
| `tabs` | Save and restore tab sessions, and reuse the home tab |
| `search` | Run web searches with the browser's default service |
| `https://www.google.com/*` | Request the Google Favicon service |
| `https://*.gstatic.com/*` | Load icon resources returned by Google |
| `https://api.github.com/*` | Call the GitHub API only when Gist backup is enabled |
| Optional `http://*/*`, `https://*/*` | Access the specific sites and services used for page details, link checks, AI sorting or WebDAV, on demand |

The global command palette is off by default. To use it and its browser-level shortcut, assign a key on the extension's shortcuts page.

## Backup, restore and cleanup

Settings › Data & privacy offers JSON export and import for metadata, plus full snapshots; WebDAV uses the same snapshot.

A snapshot carries the native bookmark tree, metadata such as alternate URLs, groups, folder icons, usage history and app settings. What it never carries: tab sessions, trash, operation history, caches, AI tokens, WebDAV settings, the Gist token/Gist passphrase, or any passphrase. The Gist ID is a non-credential resource identifier and may be included with app settings in snapshots.

You see conflicts in a preview before anything is imported. Confirm it, and the full snapshot lands in a new `Moorread Restore ...` folder; nothing existing gets cleared or overwritten.

Metadata and usage records for the same address return to the snapshot's values. Groups are restored by ID: the same ID is replaced by the snapshot, other existing groups are kept. App settings are replaced. Gist credential fields in a backup are always sanitized to empty values, so a restore never wipes your current token, Gist ID or backup passphrase: values are only taken when the backup supplies a non-empty value, and only an explicit `null` marker clears them.

New native bookmarks and restored extension data still propagate to other devices under their own sync settings; WebDAV does not take over browser sync.

The WebDAV passphrase guards the snapshot you upload; a local JSON you export by hand stays outside it. Where that exported file ends up is yours to decide.

When you delete a bookmark or folder through Moorread, a local snapshot is saved first, so the action can be undone immediately or restored from "Trash and history". Deletion snapshots are kept for 30 days.

Clearing is granular: usage history (bookmark open counts and last-opened times), the site icon cache, tab sessions, trash and history, metadata, and optional site access each have their own control. Clearing metadata leaves native bookmarks alone but drops the synced copy. Groups count as separate data, managed or deleted from the group entry point.

When reporting a problem, hide API tokens, private addresses and browsing history. Screenshots and exported backups may contain them; avoid attaching them to a public issue.
