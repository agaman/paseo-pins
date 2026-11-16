# Repository configuration

Add `.paseo/pins.json` to a workspace checkout to supply links automatically. Each worktree reads its own file.

```json
{
  "version": 1,
  "sections": [{ "key": "guides", "title": "Guides" }],
  "pins": [
    {
      "key": "handbook",
      "title": "Project handbook",
      "url": "https://docs.example.com",
      "type": "docs",
      "section": "guides"
    }
  ]
}
```

`version` and `pins` are required; `sections` is optional. Each pin needs a unique `key`, `title`, and absolute HTTP(S) `url`. Available types are `app`, `review`, `docs`, `example`, `artifact`, and `link` (the default). Omit `section` or use `null` for an unsectioned pin; every assigned section must be declared in the file.

## Ownership

Configured pins show a gear and **Repo** label. The file controls their title, URL, type, and section. Agents can notify you about updates to these resources, but cannot replace their definitions or remove them through pin tools. Edit the file to make those changes.

A config key takes ownership of an existing agent-managed pin with the same key, including a kept pin. Its position and notification state are preserved. Config also owns section names; agents can place their own pins in those sections but cannot rename or remove them.

Removing an entry removes its configured pin. Removing a section ungroups surviving agent-managed pins. Reordering arrays does not reorder existing pins; new entries append in file order. Config changes apply quietly, without unread notifications or chat summaries.

## Validation

- Keys use 1–64 lowercase letters, digits, or hyphens, starting with a letter.
- Pin titles are at most 120 characters; section titles at most 80.
- At most 100 pins and 100 sections in a regular UTF-8 file up to 256 KiB.
- No variable substitution, commands, automatic `.env` loading, symlinks, or embedded URL credentials.
- Unknown fields or versions, duplicate keys, and references to undeclared sections are rejected.

Pins checks configuration when listing or changing resources. An open menu normally notices edits within a few seconds. Invalid files preserve the last valid list and show an error; pin mutations and new refresh runs pause until corrected. Deleting the file removes its owned entries after deletion is confirmed on a second check.

See [help](help.md) for profile settings and troubleshooting. Agents receive notification guidance through the pin tools.
