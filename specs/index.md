# specs/

- [plans/2026-08-20-connect-pyobs-archive.md](plans/2026-08-20-connect-pyobs-archive.md) — plan for
  pyobs/pyobs-robotic-backend#82: connect to pyobs-archive so each observation links directly to
  its archived frames (preview, headers, FITS download), in the API and the Observations tab.
- [plans/2026-08-20-script-builder.md](plans/2026-08-20-script-builder.md) — plan for
  pyobs/pyobs-robotic-backend#81: replace the raw-YAML `ScriptEditor` on the task page with a
  visual, schema-driven script builder (polymorphic/nested script fields, dynamic maps, live
  validation).

Most design docs, plans, and ADRs that concern (or are partly implemented in) this repo live in
`pyobs-core`'s `specs/` — see
`../../pyobs-core/specs/design/obsnum_fits_header.md` (#738, `Observation.obsnum`: Django model +
migration + serializer changes needed here).

- `../../pyobs-core/specs/adrs/0013-renaming-pyobs-robotic-backend.md` — naming decision for this
  repo (proposed name: `pyobs-schedule`, not yet settled), with the considered-and-rejected name
  alternatives and the full rename surface (repo, package, Docker image, Keycloak client,
  cross-repo references).
