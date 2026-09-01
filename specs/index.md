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
- [plans/2026-09-01-portal-instrument-config-app.md](plans/2026-09-01-portal-instrument-config-app.md)
  — new `instruments` Django app: per-type capability models (camera/telescope/dome/filter
  wheels), admin-editable via a scoped `instrument-config` group, read-only nested API for the
  script builder, incl. task-duration-estimate fields (readout, filter-change, slew, dome-rotate
  times). **implemented** (#133, closed #116)

- `../../pyobs-core/specs/plans/2026-09-01-instrument-capability-duration-estimates.md` —
  follow-up to `plans/2026-09-01-portal-instrument-config-app.md` above: feeds the `instruments`
  app's capability data into `Script.estimate_duration()` in pyobs-core (`ImagingScript` + 4
  others), and into this repo's `estimate_duration/` endpoint (`schema.py`) via a new
  ORM-backed, TTL-cached `get_instrument_capabilities()` helper plus a `last_instrument_update/`
  endpoint mirroring `last_task_update/`. **proposed** (no issue yet; Repos: pyobs-core,
  pyobs-portal)

Most design docs, plans, and ADRs that concern (or are partly implemented in) this repo live in
`pyobs-core`'s `specs/` — see
`../../pyobs-core/specs/design/obsnum_fits_header.md` (#738, `Observation.obsnum`: Django model +
migration + serializer changes needed here).

- `../../pyobs-core/specs/adrs/0013-renaming-pyobs-robotic-backend.md` — naming decision for this
  repo (accepted 2026-08-24, name is `pyobs-portal`), with the considered-and-rejected name
  alternatives and the full rename surface (repo, package, Docker image, Keycloak client,
  cross-repo references); execution checklist:
  `../../pyobs-core/specs/plans/2026-08-24-rename-robotic-backend-to-portal.md`.
- `../../pyobs-core/specs/design/shared-authz-keycloak.md` — proposed: centralized authorization
  via Keycloak groups/roles; replaces this repo's per-service `is_active` activation and syncs
  `is_superuser` from a `portal-admin` client role (issue #823).
