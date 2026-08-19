# specs/

This repo has no `specs/` structure of its own. Design docs, plans, and ADRs that concern (or are
partly implemented in) `pyobs-robotic-backend` live in `pyobs-core`'s `specs/` — see
`../../pyobs-core/specs/design/obsnum_fits_header.md` (#738, `Observation.obsnum`: Django model +
migration + serializer changes needed here).

- `../../pyobs-core/specs/adrs/0013-renaming-pyobs-robotic-backend.md` — naming decision for this
  repo (proposed name: `pyobs-schedule`, not yet settled), with the considered-and-rejected name
  alternatives and the full rename surface (repo, package, Docker image, Keycloak client,
  cross-repo references).
