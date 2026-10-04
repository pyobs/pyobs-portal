# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for releases before this file existed were generated from commit subjects.

## [2.5.3] - 2026-10-04

- Add MIT LICENSE

## [2.5.2] - 2026-09-29

- Use brand color (teal) as page accent color (#160)
- docs: fix stale status line on the instrument-capability-estimate-duration-endpoint plan

## [2.5.1] - 2026-09-13

- Serve favicon.ico at site root
- Add CLAUDE.md entry point pointing to specs/ conventions and tooling

## [2.5.0] - 2026-09-04

- chore: bump pyobs-core pin to >=2.8.0
- Address review: migration data guard, list_display fix, docstring clarification
- Add camera/filter-wheel model fields, require FilterWheelCapability.module_name

## [2.4.1] - 2026-09-04

- pyobs version

## [2.4.0] - 2026-09-04

- chore: bump pyobs-core pin to >=2.7.0
- docs: reference the roof-capability cross-repo plan doc
- Add RoofCapability model for plain open/close roof timing

## [2.3.0] - 2026-09-03

- fix: render dashboard timeline axis labels in UTC
- Serve static files with Whitenoise, drop the nginx container
- docker workflow: support multiple downstream deploy triggers

## [2.2.0] - 2026-09-03

- chore: bump pyobs-core to 2.4.0
- fix: feature-detect InstrumentCapabilities, don't break on old pyobs-core
- feat: last_instrument_update/ marker + estimate_duration/ capability wiring
- fix: address review follow-ups on FilterWheelCapability.module_name
- fix: add module_name to FilterWheelCapability
- docs: plan for estimate_duration/ instrument-capability wiring
- fix: backfill module_name losslessly in migration 0004, amend plan doc
- fix: move module_name to Telescope/Dome/CameraCapability, drop InstrumentDetail (#139)
- fix: skip underscore-prefixed modules in script/provider scans
- feat: preselect a dropdown's sole option in the script builder
- fix: cascade task deactivation/deletion to pending observations
- docs: close out pyobs-core#848, mark marker plan implemented
- docs: note round-trip coupling with pyobs-core#854 in the plan
- fix: last_task_update marker moves on project edits (pyobs-core#848)
- docs: plan last_task_update marker fix for project changes (#848)
- docs: mark instrument-config-app plan implemented (#133, closes #116)
- Add instruments app: static camera/telescope/dome capability data (#133)
- SchemaForm: compact rows for scalar lists, inline checkbox descriptions
- Note #128/#129 fix in script-builder plan doc
- Fix nested scripts in runners showing as raw YAML instead of forms
- Fix docker.yml: secrets can't be referenced directly in step if:
- Trigger a downstream deployment rebuild after publishing the Docker image
- Wire in KeycloakSessionRefreshMiddleware, require pyobs-auth>=2.1.0
- Default ENFORCE_LOCAL_ACTIVE=True, preserving pre-2.1 is_active gating on top of the Keycloak group gate
- Address review: fix hardcoded client id in portal-admin role check, document demotion sharp edge
- Centralize authorization via Keycloak groups, sync is_superuser from role
- Specs: reference shared-authz-keycloak design doc (#823)
- Require stable pyobs-core/pyobs-auth>=2.0.0
- Add UI screenshots to docs and README
- Fix module-ref matching to check any host row, not a deduped first-seen one
- Handle fleet-aggregated module-classes response shape (#119)
- Add Dependabot auto-merge workflow
- Add .readthedocs.yml
- Add Sphinx docs from scratch
- Disable task form fields and Save/Export until data has loaded
- Show the running version in the sidebar header
- Resolve re-exported short class paths in the script builder
- Group extension package scripts under a package-labeled tree branch
- Fix schedule timeline extra space on top after first load
- Rename remaining "Robotic Backend" UI labels to "Portal"
- Discover scripts/providers from installed pyobs_* extension packages (#112)
- Fix review blockers: frontend-tests imports, CSRF cookie name
- Rename pyobs-robotic-backend to pyobs-portal
- Script builder: preserve null on any Optional[X] field, not just tuples
- Script builder: resolve a nested script candidate's own $defs
- Script builder: render fixed-length tuples as scalar inputs, not YAML
- Script builder: keep the polymorphic dropdown in the right column always
- Script builder: fix scalar-or-provider fields defaulting to a random class
- Fix doubled ghcr.io image path; document building a site-specific image
- Script builder: restrict module-name fields to real select, not free text
- Fix CSRF cookie name in frontend JS after cookie rename
- Give session/CSRF cookies a project-specific name
- Plan doc: mark pyobs-core#808 release + pin bump steps done
- Address review follow-ups: cache script_tree() and web-admin lookups, doc fixes
- Script builder: module-name fields render as dropdowns fed by pyobs-web-admin
- Script builder: drop the type picker's internal scroll cap
- Show validate_script/estimate_duration errors next to their field (#102)
- SchemaForm: flag and preserve invalid primitive field values (#101)
- Script builder: show each type's description in the type picker (#100)
- Script builder: remove the general-purpose Source toggle (#97)
- Script builder: auto-estimate duration on script change (#96)
- SchemaForm: widen the width cap from 40rem to 60rem
- SchemaForm: full-width rows for structural fields, two-column only for scalars
- SchemaForm: cap form width on wide screens
- SchemaForm: two-column (label | field) layout on wide screens
- Address PR #99 review: clear status on Delete, wording, plan drift, test
- Script builder: pick type once, hide tree while editing
- Mark script-builder plan as implemented (#90, #91, #93)
- ScriptBuilder: visual UI for the task editor's Script tab (PR 3/3) (#93)
- Fix buildBoolControl to fall back to schema default for unset value
- Frontend: polymorphic + dynamic-map controls in schemaform.js (PR 2/3) (#91)
- Backend: polymorphic script-field annotations for the script builder (PR 1/3) (#90)
- Update script-builder plan: CI workflow now exists
- Fix setup-uv version pin: v10 doesn't exist as a floating tag
- Add CI workflow to run the Django test suite
- Mark connect-pyobs-archive plan as implemented (#89)
- Address PR review: fix 5xx-on-malformed-response bug, hide Data column when disabled
- Link observations to their pyobs-archive data (issue #82)

## [2.1.1] - 2026-09-01

- Note #128/#129 fix in script-builder plan doc
- Fix nested scripts in runners showing as raw YAML instead of forms
- Fix docker.yml: secrets can't be referenced directly in step if:
- Trigger a downstream deployment rebuild after publishing the Docker image

## [2.1.0] - 2026-08-31

- Wire in KeycloakSessionRefreshMiddleware, require pyobs-auth>=2.1.0
- Default ENFORCE_LOCAL_ACTIVE=True, preserving pre-2.1 is_active gating on top of the Keycloak group gate
- Address review: fix hardcoded client id in portal-admin role check, document demotion sharp edge
- Centralize authorization via Keycloak groups, sync is_superuser from role
- Specs: reference shared-authz-keycloak design doc (#823)

## [2.0.0] - 2026-08-26

- Require stable pyobs-core/pyobs-auth>=2.0.0
- Add UI screenshots to docs and README
- Fix module-ref matching to check any host row, not a deduped first-seen one
- Handle fleet-aggregated module-classes response shape (#119)
- Add Dependabot auto-merge workflow
- Add .readthedocs.yml
- Add Sphinx docs from scratch
- Disable task form fields and Save/Export until data has loaded
- Show the running version in the sidebar header
- Resolve re-exported short class paths in the script builder
- Group extension package scripts under a package-labeled tree branch
- Fix schedule timeline extra space on top after first load
- Rename remaining "Robotic Backend" UI labels to "Portal"
- Discover scripts/providers from installed pyobs_* extension packages (#112)
- Fix review blockers: frontend-tests imports, CSRF cookie name
- Rename pyobs-robotic-backend to pyobs-portal
- Script builder: preserve null on any Optional[X] field, not just tuples
- Script builder: resolve a nested script candidate's own $defs
- Script builder: render fixed-length tuples as scalar inputs, not YAML
- Script builder: keep the polymorphic dropdown in the right column always
- Script builder: fix scalar-or-provider fields defaulting to a random class
- Fix doubled ghcr.io image path; document building a site-specific image
- Script builder: restrict module-name fields to real select, not free text
- Fix CSRF cookie name in frontend JS after cookie rename
- Give session/CSRF cookies a project-specific name
- Plan doc: mark pyobs-core#808 release + pin bump steps done
- Address review follow-ups: cache script_tree() and web-admin lookups, doc fixes
- Script builder: module-name fields render as dropdowns fed by pyobs-web-admin
- Script builder: drop the type picker's internal scroll cap
- Show validate_script/estimate_duration errors next to their field (#102)
- SchemaForm: flag and preserve invalid primitive field values (#101)
- Script builder: show each type's description in the type picker (#100)
- Script builder: remove the general-purpose Source toggle (#97)
- Script builder: auto-estimate duration on script change (#96)
- SchemaForm: widen the width cap from 40rem to 60rem
- SchemaForm: full-width rows for structural fields, two-column only for scalars
- SchemaForm: cap form width on wide screens
- SchemaForm: two-column (label | field) layout on wide screens
- Address PR #99 review: clear status on Delete, wording, plan drift, test
- Script builder: pick type once, hide tree while editing
- Mark script-builder plan as implemented (#90, #91, #93)
- ScriptBuilder: visual UI for the task editor's Script tab (PR 3/3) (#93)
- Fix buildBoolControl to fall back to schema default for unset value
- Frontend: polymorphic + dynamic-map controls in schemaform.js (PR 2/3) (#91)
- Backend: polymorphic script-field annotations for the script builder (PR 1/3) (#90)
- Update script-builder plan: CI workflow now exists
- Fix setup-uv version pin: v10 doesn't exist as a floating tag
- Add CI workflow to run the Django test suite
- Mark connect-pyobs-archive plan as implemented (#89)
- Address PR review: fix 5xx-on-malformed-response bug, hide Data column when disabled
- Link observations to their pyobs-archive data (issue #82)
- Add mobile-responsiveness requirement to script builder plan
- Rewrite connect-pyobs-archive plan: link-only, drop server-side cache
- Add issue #81/#82 plans directly to develop
- Dual login buttons: one-click IdP login via kc_idp_hint
- Fix review findings: management command marker, cancel/marker access scoping
- Derive update markers from the DB instead of the per-process cache
- Display observation times in UTC on task schedule tables
- Add public flag to Project with resolved access everywhere
- Reference ADR 0013 (repo renaming, proposed) in specs/index.md
- Lower Python requirement to 3.12 (Django 6 floor)
- Rename specs/README.md to index.md
- Make timeline observation items clickable, link to task
- Poll dashboard timeline and update observations in place
- Add settings-configured admin account, bump pyobs-auth for nicer error page
- Fix resolve_user username collision, restore manual-activation gate
- Add Keycloak browser login (SSO) via pyobs-auth
- Add Keycloak Bearer-token auth via pyobs-auth
- Add a distinct favicon/login icon, fix task tab titles
- Add configurable pyobs logo to sidebar header
- Add light/dark mode switcher
- Upgrade uv.lock to clear open Dependabot alerts
- Fix doubled ghcr.io image path in docker workflow

## [1.6.3] - 2026-08-10

- Add obsnum field to Observation (pyobs-core#738) (#69)
- Add specs/ pointer to pyobs-core design docs
- Add dependabot.yml, targeting develop for PRs
- fix: cap celery container nofile ulimit and bulk-delete old observations

## [1.6.2] - 2026-07-21

- fix: reduce celery worker idle CPU by disabling cluster coordination

## [1.6.1] - 2026-07-15

- Maintenance release (dependency and metadata updates only).

## [1.6.0] - 2026-07-10

- feat: support new pyobs-core target types (HeliocentricPolar, Helioprojective)
- fix: preserve port in Host header forwarded to Django
- docs: fix stale nginx port and document CORS/COOP env vars

## [1.5.2] - 2026-07-02

- feat: make Cross-Origin-Opener-Policy header configurable

## [1.5.1] - 2026-07-02

- fix: allow cross-origin requests to the API

## [1.5.0] - 2026-06-19

- feat: prettify target type names in dropdown
- fix: reliably update SDO marker when psi/delta coordinates change
- feat: add SDO sun image viewer for HelioprojectiveRadialTarget
- new pyobs version

## [1.4.1] - 2026-06-19

- new pyobs version

## [1.4.0] - 2026-06-19

- feat: expand merit plot to cover next 24 hours
- fix: suppress NonRotationTransformationWarning in moon separation
- fix: correct merit plot constraint/merit evaluation
- feat: improve visibility plots and merit plot reactivity
- feat: add merit/constraint plot to task editor

## [1.3.1] - 2026-06-18

- Maintenance release (dependency and metadata updates only).

## [1.3.0] - 2026-06-18

- feat: improve visibility plots — performance, layout and UX
- feat: add interactive visibility plots to task editor
- export yaml: normalize SiderealTarget coordinates to degrees

## [1.2.4] - 2026-06-17

- gitignore: exclude .idea and db.sqlite3
- add window_expired state for pending observations past their window

## [1.2.3] - 2026-06-17

- Maintenance release (dependency and metadata updates only).

## [1.2.2] - 2026-06-17

- add syntax highlighting for Script and YAML tabs using CodeMirror
- dashboard: use local solar noon-to-noon window instead of UTC

## [1.2.1] - 2026-06-17

- add picker schema endpoint and UI for DynamicTarget
- fix DynamicTarget serialization to preserve nested picker object
- task detail: add readonly YAML preview tab

## [1.2.0] - 2026-06-17

- schedule tab: only show observations ending in the future
- observations tab: add pagination, show completed/aborted/failed only
- enforce ObservationState enum; update observations tab and dashboard states
- dashboard: hide projects with no observations in night plot
- dashboard: show completed observations in night plot, brighten axis labels

## [1.1.6] - 2026-06-16

- fix for estimating duration correctly

## [1.1.5] - 2026-06-16

- update README: mention Aladin Lite sky view
- add Aladin Lite sky view to SiderealTarget editor
- add Open in Simbad button to target name field
- add DEFAULT_CONSTRAINTS/MERITS setting and update README

## [1.1.4] - 2026-06-16

- new pyobs version

## [1.1.3] - 2026-06-16

- add bulk activate/deactivate to task overview; fix PATCH support
- tasks overview: show inactive by default, grey out inactive, align columns
- add import task from YAML
- replace clone prompt() with inline input field
- add Export YAML button to task editor
- add clone button to task editor
- expand nested object defaults in script templates
- add hms/dms support for SiderealTarget RA/Dec
- added black
- updated file

## [1.1.2] - 2026-06-15

- update README: ghcr.io image, port 8472, env vars from .env
- expose nginx on port 8472
- remove expose port 8000 from web service
- permit transient_nonexcl_queues on rabbitmq
- pull image from ghcr.io instead of building locally
- move all hardcoded env vars from docker-compose.yml to .env.example

## [1.1.1] - 2026-06-15

- added SECURE_PROXY_SSL_HEADER

## [1.1.0] - 2026-06-15

- fix timeline: use standalone vis-timeline build, sequential fetches
- improve timeline error handling and loading state on dashboard
- add schedule timeline to dashboard with day/night visualisation
- filter already-used types from merit/constraint add dropdown
- support ENABLE_FRONTEND env var in addition to local_settings.py
- remove standalone docker run example from README
- run migrate and collectstatic automatically on web container startup
- add nginx.conf.example and reference it in README
- replace inline docker-compose and .env content with file references
- add docker-compose.yml, .env.example, and gitignore .env
- use .env file for docker-compose environment variables
- add docker-compose example with PostgreSQL, RabbitMQ, Celery, and nginx
- update README to reflect frontend being disabled by default
- add local_settings.example.py and fix FRONTEND_ENABLED ordering
- add ENABLE_FRONTEND flag to settings, disabled by default
- update README
- add README
- add estimate duration button to task editor
- improve sidebar project group styling
- refresh sidebar task list after saving a task
- improve frontend: sidebar task list, tabbed task detail, project fix
- add Bootstrap 5 web frontend for task and project management

## [1.0.5] - 2026-06-07

- Maintenance release (dependency and metadata updates only).

## [1.0.4] - 2026-06-02

- fixed bug in create() that I had already fixed in update()...

## [1.0.3] - 2026-06-02

- fixed bug

## [1.0.2] - 2026-06-02

- added migration

## [1.0.1] - 2026-06-02

- resolve dynamic targets
- fixed some bugs
- seems to be working now
- .

## [1.0.0] - 2026-05-29

- added active field to Task

## [0.3.3] - 2026-05-26

- Maintenance release (dependency and metadata updates only).

## [0.3.2] - 2026-05-26

- changed NumberFilter to CharFilter for task
- added sorting

## [0.3.1] - 2026-05-25

- using pagination for http requests, i.e. all lists are in "results" now

## [0.3.0] - 2026-05-25

- Maintenance release (dependency and metadata updates only).

## [0.2.23] - 2026-05-25

- using filters instead of extra method
- added pagination

## [0.2.22] - 2026-05-20

- more celery settings

## [0.2.21] - 2026-05-20

- removed collectstatic and migrate

## [0.2.20] - 2026-05-20

- add latest tag as well for image
- execute every hour
- using celery to delete old observations that were never observed

## [0.2.19] - 2026-05-20

- filter by task

## [0.2.18] - 2026-05-20

- filter obs

## [0.2.17] - 2026-05-19

- split start and end into *_before and *_after

## [0.2.16] - 2026-05-18

- made admin pages more useful

## [0.2.15] - 2026-05-18

- for constraints/merits save correct type

## [0.2.14] - 2026-05-18

- removed flush

## [0.2.13] - 2026-05-18

- added admin sites

## [0.2.12] - 2026-05-18

- CSRF_TRUSTED_ORIGINS to env

## [0.2.11] - 2026-05-18

- --no-input for collectstatic

## [0.2.10] - 2026-05-18

- STATIC_ROOT from env

## [0.2.9] - 2026-05-17

- uv run

## [0.2.8] - 2026-05-17

- replaced nc call with python

## [0.2.7] - 2026-05-17

- Maintenance release (dependency and metadata updates only).

## [0.2.6] - 2026-05-17

- Maintenance release (dependency and metadata updates only).

## [0.2.5] - 2026-05-17

- docker

## [0.2.4] - 2026-05-17

- docker

## [0.2.3] - 2026-05-17

- docker

## [0.2.2] - 2026-05-17

- docker

## [0.2.1] - 2026-05-17

- docker

## [0.2.0] - 2026-05-17

- docker
- allow to filter for multiple comma-separated states
- added enpoints for last_task_update and last_observation_update
- added get_serializer
- working on permissions
- added /api/me endpoint
- static path
- local settings
- added gunicorn
- made code primary key
- unique constraint for code
- serializing target
- user relation to project
- added user views
- basic project management
- added project views
- fixed bug in task serialization
- added token auth
- skeleton for target serialization
- serialize to project code
- projects
- added priority
- .
- change structure for input/output
- added migration
- removed old stuff
- mostly working
- observations work
- tasks work again
- working on fastapi->django migration
- added user table
- fixed imports
- added /api prefix
- update observations
- cancel observations
- added observations
- use sqlalchemy directly instead of sqlmodel
- initial commit
