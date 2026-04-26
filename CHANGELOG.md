# Changelog

## Unreleased

- Fixed project wikilink mapping so existing wikilinks are not double-wrapped. Thanks @waspeer (#9).
- Fixed `~` expansion for configured collection paths, environment paths, and `--path` values. Thanks @anomatomato (#7).
- Fixed `mtn list --due` so natural-language date expressions like `tomorrow` and `May 13 2026` are resolved before filtering. Thanks @npondel (#11).
- Added hour/minute support for `mtn timer log --from` and `--to` filters, including `YYYY-MM-DD HH:mm` and `YYYY-MM-DDTHH:mm`. Thanks @anomatomato (#8).

## 0.1.2 - 2026-02-19

- Fixed timer log/stat output to compute duration dynamically and use robust display title fallback.
- Fixed filename-title mode behavior so commands resolve task titles from filename when title frontmatter is absent.
- Added TaskNotes-compatible create fallback for `path_pattern` templates (including TaskNotes-style variables like `{{zettel}}`) when `mdbase` cannot derive a path directly.
- Added create-time compatibility defaults for TaskNotes-style schemas:
  - applies schema defaults before create,
  - applies `match.where` defaults (`eq`, `contains`, `exists`),
  - auto-populates mapped `dateCreated`/`dateModified` fields when present.
- Added warnings when `path_pattern` cannot be resolved, including exact missing template variable names.
- Added regression coverage for filename-title mode and create compatibility flows.
