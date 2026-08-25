# specs/

- [plans/2026-08-20-connect-pyobs-archive.md](plans/2026-08-20-connect-pyobs-archive.md) —
  **implemented** (pyobs/pyobs-portal#89) for pyobs/pyobs-portal#82: each
  completed/aborted/failed observation gets an `archive_url` (pure link, no archive call) plus an
  on-demand frame count/reduction-status check, in the API and the Observations tab.
- [plans/2026-08-20-script-builder.md](plans/2026-08-20-script-builder.md) —
  **implemented** (pyobs/pyobs-portal#90, #91, #93) for pyobs/pyobs-portal#81:
  replaced the raw-YAML `ScriptEditor` on the task page with a visual, schema-driven script
  builder (searchable type tree, polymorphic/nested script fields, dynamic maps, live validation,
  mobile-responsive, source-view fallback for unmappable data).
- [plans/2026-08-24-module-ref-dropdowns.md](plans/2026-08-24-module-ref-dropdowns.md) —
  **implemented** for pyobs/pyobs-portal#98: module-name script fields
  (`ImagingScript.camera`/`.telescope`/…) render as dropdowns fed by pyobs-web-admin's
  `GET /api/modules/classes/`, filtered per-field by required `pyobs.interfaces` tagged in
  pyobs-core via `Annotated[str, ICamera]`-style metadata (pyobs-core#808, shipped in
  2.0.0.dev94).

Most design docs, plans, and ADRs that concern (or are partly implemented in) this repo live in
`pyobs-core`'s `specs/` — see
`../../pyobs-core/specs/design/obsnum_fits_header.md` (#738, `Observation.obsnum`: Django model +
migration + serializer changes needed here).

- `../../pyobs-core/specs/adrs/0013-renaming-pyobs-robotic-backend.md` — naming decision for this
  repo (accepted 2026-08-24, name is `pyobs-portal`), with the considered-and-rejected name
  alternatives and the full rename surface (repo, package, Docker image, Keycloak client,
  cross-repo references); execution checklist:
  `../../pyobs-core/specs/plans/2026-08-24-rename-robotic-backend-to-portal.md`.
