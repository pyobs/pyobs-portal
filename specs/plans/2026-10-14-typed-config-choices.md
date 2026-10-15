# Plan: typed enum values and readable labels in schema forms

Status: implemented; release and deployment pending.
Repos: pyobs-portal, pyobs-core.
Related issue: [pyobs-gui#211](https://github.com/pyobs/pyobs-gui/issues/211).
Shared contract: [core plan](../../../pyobs-core/specs/plans/2026-10-14-typed-config-choices.md).
Companion: [GUI plan](../../../pyobs-gui/specs/2026-10-14-typed-config-choices.md).

## Verified path and cause

`pyobs_portal/api/schema.py::_schema_for` publishes Pydantic `model_json_schema()`.
Observation scripts can embed configuration models whose numeric Literal
values already appear as numeric JSON Schema enums. The portal never consumes core's
`ConfigFieldSchema.options` for this form. Fixing that core schema alone cannot fix
this UI.

`pyobs_portal/frontend/static/frontend/js/schemaform.js::buildEnumControl` assigns
raw enum values to HTML options and returns `select.value`, which is always text.
This loses integer, float and bool types. Ordinary numeric controls already convert
their input values. Existing invalid-enum fallback deliberately preserves stored
invalid data as raw YAML; retain that behavior.

The same form builder is shared across script/constraint/merit/nested configuration
editing, so the repair must be generic. Use synthetic fixtures such as
integer `16416` with display label `Detector A`.

## Implementation checklist

- [x] In `buildEnumControl`, give DOM options opaque index tokens and return the
      original element from `resolved.enum` using the selected index/token. Do not
      parse labels or values with `Number`, `parseInt`, or `JSON.parse(select.value)`.
      `1`, `"1"`, `true`, `"true"`, and `"001"` must remain distinct where JavaScript
      distinguishes them. JSON numbers `1` and `1.0` have the same JS identity.
- [x] Select existing/default values using typed scalar equality, not DOM string
      equality. Handle absent values separately from null, false, zero and empty string.
      Guard empty domains and no-selection cases so a bad index cannot yield an
      unrelated option. Preserve current defaults for genuinely new valid fields.
- [x] Keep out-of-domain stored values in `buildInvalidValueFallback`; do not silently
      migrate old numeric strings into numbers or overwrite them with the first choice.
      Users can correct them through existing raw YAML editing and server validation.
- [x] Read optional `x-pyobs-choices` records (`value`, `label`) for display only,
      following the core plan's matching/fallback rules. The standard `enum` remains
      authoritative for allowed values and order. Missing/partial/malformed/conflicting
      metadata falls back to raw-value labels; labels outside the domain add no choices.
- [x] Put labels in `textContent`, preserving the current escaping behavior. Do not
      render label HTML. Duplicate labels must still have separate index tokens.
- [x] Audit `resolveSchema` and the nullable `anyOf` branch: field-level extension
      metadata may sit beside `anyOf` while the enum lives in its non-null branch.
      Carry the presentation metadata into that branch without overwriting its enum,
      validation constraints, or explicit branch metadata. Test `$ref` plus sibling
      metadata, nested `$defs`, and normal non-null direct enums.
- [x] Preserve the existing optional set/unset checkbox and null round-trip. Check
      single-value Pydantic `const` schemas separately: use/preserve their typed constant,
      rather than assuming every Literal is emitted as `enum`; add a focused handling
      fix only if the current route loses that constant.
- [x] Confirm `api/schema.py` preserves the extension in script-tree responses;
      backend changes should be limited to a demonstrated metadata-loss point.
      No provider-specific imports, label tables, or numeric coercion patch in server validation.
- [x] Verify save/load, source-view toggling, validation and duration-estimation requests
      all consume the same typed form result. Preserve YAML/JSON numeric values rather
      than converting them back to text elsewhere.

## Verification checklist

- [x] Extend `frontend-tests/js/schemaform.test.js` with no-edit round trips and changed
      selections for integer `16416`, decimal `1.5`, bool false/true, and string enums.
      Use strict type assertions, mixed domains, duplicate display labels and `"001"`.
- [x] Cover default values, false/zero/empty string, undefined/null, an empty enum,
      invalid stored numeric strings, and invalid selected index. Existing issue #101
      raw-value fallback tests must still pass.
- [x] Exercise labels on direct enum, `$ref`, nested object and nullable enum paths,
      including partial/invalid metadata and markup-like labels rendered as plain text.
- [x] Add a SchemaForm/scriptbuilder integration regression with `configuration.main.detector`:
      render → edit → `getData()` → YAML/source toggle → reload retains numeric codes.
      Existing number inputs must remain numeric.
- [x] In `pyobs_portal/api/tests.py`, use a small Pydantic fixture with integer Literal
      and metadata to check schema output and validation of the typed script payload.
      Avoid making generic tests depend on the optional instrument extension. Add an
      extension-enabled smoke check for the representative configuration model when available.
- [ ] Run `npm test` (Vitest) and affected Django API tests using the repository's
      `uv run python manage.py test` setup; then use installed candidate extensions to
      create/save/reload an observation script and verify the persisted numeric value
      passes validation and duration estimation. No telescope execution is required.

## Dependency and rollout notes

The typed DOM fix can deploy independently of core's capability change and of label
metadata. Readable choice labels require the model provider to publish `x-pyobs-choices` in
`model_json_schema()` and the portal's model-provider environment to be
updated. Restart/refresh cached schema producers and refresh browser assets after
releases. Do not assume a local sibling checkout changes installed portal packages.

Bitmask enums keep their full legal domain; metadata with only atomic choices must
not filter legal combinations. Unlabeled combinations initially display the raw
numeric value. The existing JavaScript safe-integer limit remains; example codes
are within it, and this change does not claim arbitrary-precision JSON number support.

Existing malformed stored scripts are preserved for explicit correction, not batch
migrated. General schema unions, arbitrary object-valued enums and nullable capability
redesign are outside this plan. The implementation preserves the existing dependency requirements through feature detection.

## Implementation verification (2026-10-15)

- Frontend suite: 133 passed. Django suite: 159 passed.
- Candidate provider JSON Schema → portal controls preserves numeric values,
  readable labels, unlabeled bitmask combinations and single-value constants.
- Metadata survives nested API schemas; invalid numeric strings remain invalid.
- Repository-wide Black reports existing differences in 12 files. The new backend
  regression follows Black formatting without reformatting unrelated existing tests.
