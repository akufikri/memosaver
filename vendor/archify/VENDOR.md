# Vendored: Archify

Self-contained, trimmed copy of the Archify architecture-diagram renderer, used by
`memosaver visual` to render an architecture diagram from the local SQLite memory DB.

- **Upstream:** <https://github.com/tt-a1i/archify>
- **Version:** 3.0.1
- **License:** MIT (see `LICENSE`; additional notices in `THIRD_PARTY_NOTICES.md`)
- **Copied from:** the locally installed skill snapshot at `~/.claude/skills/archify`
- **Provenance note:** that local snapshot is on the upstream `development` channel and its
  own `skill-release.json` still reports `2.17.0-dev.1`; the pinned release recorded above
  is the Archify 3.0.1 line this vendored set corresponds to.
- **Runtime contract:** invoked as a subprocess, never imported:

  ```sh
  node vendor/archify/bin/archify.mjs render architecture <spec.json> <out.html>
  ```

  Exits `0` and writes a self-contained HTML artifact (~800 KB for the memosaver graph).

## Vendored files

24 upstream files + this `VENDOR.md`, ~1.7 MB total (`du -sh vendor/archify`).

```
LICENSE                                            1.1 KB   upstream MIT license
THIRD_PARTY_NOTICES.md                             5.2 KB   upstream third-party notices
assets/template.html                             774.9 KB   self-contained HTML shell (inlined font + CSS)
assets/JetBrainsMono-OFL.txt                       4.4 KB   font license referenced by THIRD_PARTY_NOTICES.md
bin/archify.mjs                                   78.6 KB   CLI entry point (render / validate / doctor / …)
renderers/architecture/render-architecture.mjs     45.5 KB   architecture renderer
renderers/architecture/grid.mjs                    2.1 KB
renderers/shared/brand-marks.mjs                  22.6 KB
renderers/shared/cli.mjs                          10.2 KB
renderers/shared/desktop-readability.mjs           1.1 KB
renderers/shared/diagnostics.mjs                   6.2 KB
renderers/shared/engineering-profiles.mjs          6.9 KB
renderers/shared/generated-brand-marks.mjs       163.6 KB   generated brand-mark catalog (build artifact upstream)
renderers/shared/generated-validators.mjs        431.7 KB   generated JSON-schema validators (build artifact upstream)
renderers/shared/geometry.mjs                     57.2 KB
renderers/shared/i18n.mjs                         48.5 KB
renderers/shared/layout-report.mjs                 1.0 KB
renderers/shared/legend.mjs                        8.7 KB
renderers/shared/output-path.mjs                  11.6 KB
renderers/shared/repository-evidence.mjs          12.5 KB
renderers/shared/repository-location.mjs           3.5 KB
renderers/shared/text-fit.mjs                      2.2 KB
renderers/shared/utils.mjs                        11.6 KB
renderers/shared/validator.mjs                     3.5 KB
```

No `node_modules` and no npm dependencies are required: every external identifier the
renderer would otherwise pull from `ajv`/`parse5`/`saxes`/`simple-icons` is baked into
`generated-validators.mjs` and `generated-brand-marks.mjs`.

## Trim rationale

The vendor tree is the **minimum file set for `render architecture`**. Starting from a
full copy of the skill (bin/, renderers/, assets/, schemas/, LICENSE,
THIRD_PARTY_NOTICES.md), each candidate was deleted and the render smoke command re-run;
anything whose removal still produced a valid artifact was dropped.

Removed (never copied, or copied then pruned after a passing re-render):

| Removed | Why it is safe |
| --- | --- |
| `schemas/` (7 files) | Only consumed by the `validate`/`doctor`/`examples` CLI commands via `skillRoot` paths; `render architecture` validates with `renderers/shared/generated-validators.mjs`. Verified: render still exits 0 with `schemas/` absent. |
| `renderers/dataflow/`, `lifecycle/`, `sequence/`, `workflow/` | Other diagram types, dispatched only by `bin/archify.mjs` for their own subcommands. |
| `bin/open-artifact.mjs`, `bin/preview.mjs`, `bin/visual-check.mjs` | Lazily `import()`ed only by the `open`/`preview`/`visual-check` subcommands. Verified removable each in turn. |
| `brand-marks/`, `delta/`, `scripts/`, `examples/`, `migrations/`, `recipes/`, `references/`, `test/` | Consumed only by non-render subcommands (`brands`, `compare`, `check`, `examples`, `migrate`, `guide`, `doctor`). |
| `SKILL.md`, `package.json`, `package-lock.json`, `skill-release.json` | Skill packaging metadata, not runtime inputs. |

Kept because removal broke the render or because they are required notices:

- everything under `bin/archify.mjs`, `renderers/architecture/` and `renderers/shared/`
  (all 17 shared modules are statically reachable from `render-architecture.mjs`);
- `assets/template.html`, injected verbatim into every output;
- `LICENSE` and `THIRD_PARTY_NOTICES.md` (MIT attribution);
- `assets/JetBrainsMono-OFL.txt`, the font license referenced by `THIRD_PARTY_NOTICES.md`.

Because `schemas/` is trimmed, the spec's "0 error" validation in the update procedure
below must be re-checked against the **source skill snapshot**, not this tree.

## Update procedure

1. Re-copy the minimal set from a fresh, validated install of the skill:

   ```sh
   S=~/.claude/skills/archify
   rm -rf vendor/archify && mkdir -p vendor/archify
   cp -R "$S/bin" "$S/renderers" "$S/assets" vendor/archify/
   cp "$S/LICENSE" "$S/THIRD_PARTY_NOTICES.md" vendor/archify/
   rm -rf vendor/archify/renderers/{dataflow,lifecycle,sequence,workflow}
   rm -f vendor/archify/bin/{open-artifact,preview,visual-check}.mjs
   ```

2. Re-run the render smoke command and confirm exit `0` plus an artifact `> 200 KB`:

   ```sh
   node vendor/archify/bin/archify.mjs render architecture <spec.json> /tmp/vendor-smoke.html
   ```

3. Re-check that the spec still validates with 0 errors against the source snapshot
   (this uses `schemas/`, which is not vendored):

   ```sh
   node "$S/bin/archify.mjs" validate architecture <spec.json>
   ```

4. Re-run the reachability check to confirm no newly-added shared module is dead weight,
   then update the file list and version above.
