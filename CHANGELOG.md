# Changelog

## Unreleased

- Read TaskNotes v5 collections (mdbase spec 0.3 with `implements` type
  bindings): `create`, `update`, `complete` and `skip` write the bound field
  names, including when completing one instance of a recurring task (#20).
- Use the published `@callumalpass/mdbase` 0.3.0-rc.9 and `@tasknotes/model`
  0.3.0-rc.21 (the versions TaskNotes 5.0.0-beta.7 uses) instead of a vendored
  tarball. `mtn init` now writes the contract to
  `_contracts/tasknotes.task/<version>.md`.
- Update `fast-uri` to clear its production advisories.
- `mtn archive` adds the tag the task type binds (`archive.archived_tag` in
  the `tasknotes.task` binding) instead of always `archive`; types without a
  binding (v0.2) keep `archive`. `mtn list` hides tasks with that tag too.
  Thanks @Lorite (#20).
- Clarified that saved views are ordinary v0.3 records in this task-domain
  client and that canonical named-view execution belongs to `mdbase view run`.
- Corrected the custom-path example to use the canonical `mdbase.type` wrapper.

## 0.2.0-rc.1 - 2026-07-19

- Generate mdbase v0.3 collections and canonical JSON Schema task types while
  continuing to read existing v0.2 TaskNotes collections.
- Normalize v0.3 collection metadata, TaskNotes field roles, lifecycle fields,
  enum values, and path templates into the CLI's compatibility model.
- Use portable structured filters for CLI-generated queries and support the
  v0.3 `file.name` binding.
- Update `yaml` to a patched release and clear all production dependency
  advisories.
- Fixed project wikilink mapping so existing wikilinks are not double-wrapped. Thanks @waspeer (#9).
- Fixed `~` expansion for configured collection paths, environment paths, and `--path` values. Thanks @anomatomato (#7).
- Fixed `mtn list --due` so natural-language date expressions like `tomorrow` and `May 13 2026` are resolved before filtering. Thanks @npondel (#11).
- Added hour/minute support for `mtn timer log --from` and `--to` filters, including `YYYY-MM-DD HH:mm` and `YYYY-MM-DDTHH:mm`. Thanks @anomatomato (#8).
- Improved the create error and documentation when a task type has `match.path_glob` but no `path_pattern`. Thanks @tparsons9 (#2).
- Fixed `mtn --version` so it reports the package version instead of a hardcoded stale value. Thanks @plashal (#5) and @anomatomato (#6).

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
