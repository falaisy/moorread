# Backup and restore

[繁體中文](../zh-TW/backup.md) · [Back to README](../../README.en.md)

A backup is not for peace of mind. It is so you know which file to open when something goes wrong. This document is arranged by situation: moving to another computer, deleting something by mistake, or returning to last week's state.

Everything starts in Settings › Data & privacy. You can export and import metadata, or take a full snapshot of the bookmark tree and related settings. WebDAV uses that same snapshot.

## What a snapshot contains

| Included | Not included |
| --- | --- |
| Native bookmark tree, folder hierarchy and order | Tab sessions, trash, operation history and caches |
| Descriptions, tags, custom icons, alternate URLs, pins and inbox state | AI API tokens, WebDAV connection settings and encryption passphrase |
| Groups and member order, folder icons, open counts, last visit times, app settings | Browser sync passphrase, Gist token and Gist backup passphrase (only the non-credential Gist ID is kept) |

## What happens on restore

A full snapshot shows a preview first. Once confirmed, the native bookmark tree is imported into a new `Moorread Restore ...` folder, and existing bookmarks stay untouched.

Metadata and usage records for the same address return to the values in the snapshot. Groups are restored by ID: a group with the same ID is replaced by the snapshot, other existing groups are kept. App settings are replaced as well, but Gist credential fields in a backup are always sanitized to empty values, so a restore never wipes your current Gist token, Gist ID or backup passphrase; values are only taken when the backup supplies a non-empty value, and only an explicit `null` marker clears them.

Restored data still takes part in cross-device sync under the browser and extension sync settings.

## Setting up WebDAV

1. Enter a directory address. The default is Nutstore's `https://dav.jianguoyun.com/dav/`; another WebDAV service or subdirectory also works. A custom directory must exist in the cloud first, and the remote service must use HTTPS.
2. Enter the account and app password. For Nutstore, the account is your login email and the app password is created under Account info › Security options › Third-party apps.
3. Optionally enter a backup passphrase, save, and test the connection. The first connection requests host access for that server.
4. Run a backup manually, or enable "Back up when opening a new tab". Before the first manual backup, the first automatic backup, and the first connection test, remote listing or restore, a disclosure dialog shows the destination server, what this transfer contains (a full snapshot for uploads; reads only for tests, listings and restores) and how credentials are stored; nothing is exported or sent until you explicitly agree, and declining, a failed consent-record read or a malformed record sends nothing. Uploads and reads are separate consents. Automatic backup is off by default; once enabled, the minimum check interval is 24 hours, with 1, 6 or 72 hours available. It uploads only when the interval has passed and the content has changed. It does not run while the home page is closed, so `alarms` and notification permissions are not needed. Manual backups ignore both the interval and the content check.

If an upgrade leaves automatic backup enabled without a consent record, settings show "Automatic backup is paused" with an "Agree again and resume automatic backup" button. Agreeing restores the original setting without unticking and reticking the checkbox, and does not upload immediately; the next new-tab open performs the check. To revoke all backup consent, use "Backup transfer consent" in Data & privacy; automatic backup stops and every manual transfer asks again, while existing connection settings and credentials remain.

![WebDAV backup: connection settings, passphrase and automatic backup](./images/webdav-backup.webp)

## Encryption and passphrases

With the passphrase empty, the upload is plain JSON. Once a passphrase is saved, later manual and automatic backups reuse it from this device and encrypt the full snapshot with AES-256-GCM, groups included.

This passphrase is separate from the browser sync passphrase for metadata. It stays on this device and is never written to remote files or snapshots.

Changing or clearing the passphrase affects only future backups; older files still need the passphrase they were created with. A restore tries the local passphrase first. If it is missing or does not match, you can enter one temporarily. A temporary passphrase does not change the saved settings, and a successful decryption still requires the preview and confirmation.

Without the passphrase, the corresponding encrypted backups cannot be restored.

A manually exported local JSON is not covered by this passphrase and remains plain text.

## Versions and other devices

Each backup uploads a separate JSON file named `moorread-backup-YYYYMMDDThhmmssSSSZ-<UUID>.json`, for example `moorread-backup-20261011T100000000Z-<UUID>.json`. The name carries a UTC timestamp (to the millisecond) and a random UUID, so older versions are never overwritten.

The sync history reads the remote directory listing directly and shows files newest first. It can refresh, restore the latest backup, or restore a specific entry. Reading requires WebDAV read consent first; without it the directory is not queried. After switching devices, connect to the same directory to see the history; encrypted files still need their passphrase.

A failed upload or unchanged content shows only the current status and creates no history entry.

The history is not stored locally and no index is uploaded. Older fixed names, `yunji-tab-full-snapshot.json`, `yunji-tab-snapshot-<random id>.json` and `yunji-tab-backup-...`, are also listed, using the server's modification time.

After each successful upload only the 10 newest backups are kept, and older files are removed on a best-effort basis (including recognizable legacy `yunji-tab-*` names); a failed delete does not affect the completed backup. You can still clean up in your cloud storage yourself. Clearing the connection removes only local credentials, passphrases and check state; remote files remain.

![Data & privacy settings: sync status, export and full restore](./images/backup-and-restore.webp)
