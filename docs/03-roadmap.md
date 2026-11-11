# 03 — Roadmap

Status: revision 2, 11 November 2026. Re-cut after the reviews in `docs/reviews/`: ten of
the original 24 steps were too large, several depended on later steps, and the first
contact with a real system came after launch.

## Rules

1. **One step at a time.** A step is started only when the previous step meets every line
   of its "Done when" list, its checks are green in CI, and it is merged to `main`. No step
   is started early and steps are never worked on in parallel.
2. **Steps are the same size.** One pull request, one concern: roughly 300 to 600 lines of
   production code plus tests, or the equivalent in documentation, configuration or
   measurement. Budget: about 6 to 12 focused hours.
3. **Time box.** A step that reaches twice its budget is stopped and split in this document
   before work continues (decision D25).
4. **Every step leaves `main` releasable.** Tests pass, the binary builds with
   `CGO_ENABLED=0`. A command that is not complete yet is marked `experimental` in its help
   text and loses the mark in the step that completes it.
5. **Scope changes go through the documents.** A change of scope or of a technical choice
   is written into `01-mvp-scope.md` or `04-decisions.md` before code follows.
6. **Tracking.** The table below is the single source of truth. A step is ticked in the
   pull request that completes it.

Rough size of the whole: 35 steps at 6 to 12 hours is 210 to 420 hours. This is an
estimate made before any code exists.

## Progress

| # | Step | Phase | Status |
|---|---|---|---|
| 0 | Research, scope, architecture, roadmap, independent review | Plan | Done |
| 1 | Repository scaffold, CI, Dockerfile | A Foundations | Next |
| 2 | Demo application "legacy-shop" | A | |
| 3 | Competitor bench and go/no-go | A | |
| 4 | Capture store | B Capture | |
| 5 | HTTP recorder, experimental `record`, end-to-end harness | B | |
| 6 | Redaction and `inspect` | B | |
| 7 | PostgreSQL relay and preflight | B | |
| 8 | Decoder: framing, queue, simple protocol | B | |
| 9 | Decoder: extended protocol | B | |
| 10 | Decoder: transactions and parameters | B | |
| 11 | Serial gate and idle signal | B | |
| 12 | Correlator, labels, `record` complete | B | |
| 13 | SQL analysis I: library spike, fingerprint, write targets | C Understand | |
| 14 | SQL analysis II: reads, CTEs, session statements | C | |
| 15 | Endpoint model and `behaviour.json` | C | |
| 16 | Findings and completeness notes | C | |
| 17 | Map renderer and `map` — **M1** | C | |
| 18 | Reality check I: map of a system we did not write | C | |
| 19 | Packaging, release pipeline, `init` | C | |
| 20 | Documentation and launch — **M2, v0.1.0 "Map"** | C | |
| 21 | Assertion primitives: JSON path, JSON diff, matchers | D Protect | |
| 22 | Flow schema, loader, writer | D | |
| 23 | `generate` | D | |
| 24 | Value correlation and captures | D | |
| 25 | Snapshot and reset | D | |
| 26 | Runner I: HTTP replay with response assertions | D | |
| 27 | Runner II: tap in replay, step windows | D | |
| 28 | SQL write assertions | D | |
| 29 | End-of-flow state checksum | D | |
| 30 | `calibrate` | D | |
| 31 | Reporting: console, JUnit, exit codes | D | |
| 32 | Approval and user rules — **M3** | D | |
| 33 | Seeded regressions and negative controls | E Ship | |
| 34 | Reality check II: replay on a system we did not write | E | |
| 35 | Documentation and release — **M4, v0.2.0 "Protect"** | E | |

Milestones:

- **M1 (step 17):** record and map work end to end on the demo app.
- **M2 (step 20):** v0.1.0 released. A finished product that stands on its own.
- **M3 (step 32):** tests can be generated, calibrated, replayed and approved.
- **M4 (step 35):** v0.2.0 released. The MVP is complete.

---

## Phase A — Foundations

### Step 1 — Repository scaffold, CI, Dockerfile

- **Goal:** an empty but real project that builds, tests and ships an image on every push.
- **Build:** name conflict check and final name applied; Go module; `cmd/trowel` with cobra
  root, `version`, config loading from `trowel.yaml`; package skeleton; Makefile; lint
  configuration; Dockerfile (base with `/bin/sh`); GitHub Actions: build, lint, unit tests
  on Linux, macOS and Windows, image build, `CGO_ENABLED=0`; dependency versions pinned
  with the date checked; CONTRIBUTING, SECURITY.md, no-telemetry statement.
- **Done when:** `trowel version` prints version and commit; CI is green on `main` on all
  three operating systems; the image builds in CI and runs `version`.

### Step 2 — Demo application "legacy-shop"

- **Goal:** a realistic inherited system with known quirks, and a machine-readable truth.
- **Build:** `examples/legacy-shop`: Node.js, Express, `pg` pool **without an error
  handler**, PostgreSQL, Compose with a restart policy, seed data. Cookie login that rotates
  the session id; token login for the API; product list; one HTML page with a form and a
  CSRF token; add to cart; checkout in a transaction over three tables with a savepoint;
  a request that rolls back; a GET that writes to an audit table; an N+1 endpoint; an
  upsert; a write inside a CTE; a write issued after the response is sent; an interval job
  switched on by an environment variable; responses containing a timestamp, a UUID, an
  epoch-milliseconds number, a random numeric nonce and "rendered in N ms"; a table with a
  trigger. `scenario.sh` exercises all of it. `expected.yaml` lists, per scenario request,
  statement count and SQL prefix, and per endpoint the tables read and written.
- **Done when:** `docker compose up` starts the app; the scenario passes locally and in CI;
  a script checks that every scenario request has an entry in `expected.yaml`.

### Step 3 — Competitor bench and go/no-go

- **Goal:** find out, before building, whether the differentiation holds on our own stack.
- **Build:** run Keploy, Speedscale proxymock, AppMap and Tusk Drift against the demo app
  (in GitHub Actions or on the developer's machine). For each, record: setup steps and code
  changes needed, whether it yields an endpoint-to-table listing, whether a test fails when
  a written value changes, where it breaks. Write `docs/05-competitor-bench.md` and rewrite
  section 3 of the scope from the results.
- **Stop rule:** if any one tool, with no change to the demo app's code, delivers both an
  endpoint-to-table read/write listing and a test that fails on a changed written value,
  work stops and the scope is re-decided with the project owner before step 4.
- **Done when:** the bench document is committed with commands and outputs for each tool;
  scope section 3 no longer says "hypothesis"; the stop rule is evaluated in writing.

## Phase B — Capture

### Step 4 — Capture store

- **Goal:** a place to put recordings that never blocks the proxies.
- **Build:** `internal/store`: schema from the architecture document, versioned migrations,
  single writer goroutine with batched transactions and WAL mode, typed insert and query
  functions, body deduplication by hash, size caps.
- **Done when:** a round-trip test exists for every table; twenty goroutines write
  concurrently without a lock error; a store survives close and reopen; no CGO.

### Step 5 — HTTP recorder, experimental `record`, end-to-end harness

- **Goal:** record every request and response, and have a harness all later steps reuse.
- **Build:** `internal/httprec`: reverse proxy, body tees with caps, identity encoding,
  preserved `Host`, upgrades and streams passed through; `trowel record` (HTTP only,
  `experimental`); `compose.trowel.yaml` for the demo app with the start order and
  `${TROWEL_CMD:-record}`; `test/e2e` harness that starts the stack in CI, runs the
  scenario and reads the store.
- **Done when:** integration tests cover JSON, HTML, a response above the cap, a request
  above the response cap but below the request limit, a chunked stream, a redirect, an
  error and a client abort; the harness shows one exchange per scenario request with the
  demo app image unmodified (criterion A1).

### Step 6 — Redaction and `inspect`

- **Goal:** nothing secret leaves the tool, and recordings can be looked at.
- **Build:** `internal/redact`: secret rules by header and field name, user rules, value
  dictionary with exact-value replacement across all exported strings; `trowel inspect`
  listing exchanges (later with their statements), always redacted.
- **Done when:** `inspect` output for the demo recording is a golden file; a CI search test
  proves that no password, token or cookie value of the scenario occurs in it.

### Step 7 — PostgreSQL relay and preflight

- **Goal:** a transparent TCP proxy the application cannot tell from the database.
- **Build:** `internal/dbtap`: relay, protocol-neutral interface, connection open and close
  recorded; `internal/dbtap/pg`: startup handling, cancel forwarding, detection of TLS-only
  clients with a message per driver family; preflight for both upstreams, including a
  server that demands TLS; `record` now starts the relay.
- **Done when:** `psql`, node-postgres and pgx connect with SCRAM, run queries and cancel
  one through the relay against PostgreSQL 13 and the newest release; a node-postgres
  client with TLS on gets the documented message; the demo scenario passes through the
  relay in the harness; preflight tests cover an unreachable upstream.

### Step 8 — Decoder: framing, queue, simple protocol

- **Goal:** see SQL sent with the simple protocol without ever slowing the relay.
- **Build:** message framing in the relay with timestamps and sequence numbers; bounded
  queue; one decoder goroutine per connection; `Query` to statement rows with command tag,
  row count, affected rows, error code; multi-statement splitting; `undecoded` state.
- **Done when:** integration tests assert stored statements for select, insert, update,
  delete, an empty query, a failing statement and a multi-statement query with an error in
  the second statement; with an artificially blocked decoder the session keeps working and
  the connection is marked `undecoded`.

### Step 9 — Decoder: extended protocol

- **Goal:** see parameterised queries, which is what most drivers send.
- **Build:** `Parse`, `Bind`, `Describe`, `Execute`, `Sync`, `Close`; statement map filled
  on `ParseComplete`; portal map; FIFO matching; skip to `Sync` after an error;
  `PortalSuspended`; `DEALLOCATE` and `DISCARD ALL`; text parameters.
- **Done when:** tests with node-postgres and pgx cover named and unnamed statements, a
  pipeline, an error before `Sync`, and a cursor with a row limit giving one statement row;
  every statement of the demo scenario is stored with its SQL.

### Step 10 — Decoder: transactions and parameters

- **Goal:** know which writes actually happened.
- **Build:** transaction tracking for both protocols (tag plus `ReadyForQuery` status,
  savepoint stack, `COMMIT` in a failed transaction, implicit batch rollback, disconnect in
  a transaction); `rolled_back` set when the outcome is known; binary parameter decoding
  for common types with hex fallback; `COPY` recorded as one statement.
- **Done when:** tests cover the four rollback cases named above plus a committed savepoint;
  the demo checkout and rollback requests are stored with correct flags; statement counts
  and SQL prefixes of the whole scenario equal `expected.yaml` when requests are sent one
  by one.

### Step 11 — Serial gate and idle signal

- **Goal:** one request at a time, and a precise definition of "finished".
- **Build:** gate in the HTTP recorder; idle signal from the tap (no pending operation, no
  open transaction, no client message during the quiet period); bypass list; gate timeout
  with a warning; window starts when the request passes the gate.
- **Done when:** two concurrent requests are observed strictly one after the other at the
  app; a bypassed asset request is not delayed; a hanging request triggers the timeout
  warning and releases the gate; the scenario still passes through the harness.

### Step 12 — Correlator, labels, `record` complete

- **Goal:** know which request caused which statement, and how sure we are.
- **Build:** `internal/correlate`: labels and both downgrade rules; `session` kind for
  driver housekeeping; summary on exit with label counts and the delay histogram; `inspect`
  shows statements under their exchange; `record` loses the `experimental` mark.
- **Done when:** unit tests cover every label and rule; for the scenario, statements per
  request equal `expected.yaml`; the interval job's statements and the post-response write
  are not high-confidence (criterion A2).

## Phase C — Understand

### Step 13 — SQL analysis I: library spike, fingerprint, write targets

- **Goal:** choose the analysis library on evidence, then get writes right.
- **Build:** corpus of at least 80 statements: the demo app, samples generated by
  Sequelize, Knex and Prisma, and hard cases (quoted mixed-case identifiers, upsert,
  `MERGE`, CTE write, `UPDATE … FROM`, comma joins, `EXTRACT(… FROM …)`). Measure
  `go-sqllexer` and `go-pgquery` on accuracy, binary size and speed; record the choice in
  the decision log. Then: fingerprint, operation, write targets by explicit rules,
  identifier normalisation.
- **Done when:** the spike result is in `04-decisions.md`; a golden file holds expected
  operation and write targets for the whole corpus and passes.

### Step 14 — SQL analysis II: reads, CTEs, session statements

- **Goal:** complete the facts the map needs.
- **Build:** tables read through joins, subqueries and CTEs; `INSERT … SELECT`; `RETURNING`;
  classification of session statements; `analysis` rows written for a store; `unknown`
  handling.
- **Done when:** the golden file covers tables read for the whole corpus; every statement
  of the demo recording is analysed and the tables equal `expected.yaml`.

### Step 15 — Endpoint model and `behaviour.json`

- **Goal:** group raw exchanges into endpoints and describe each one.
- **Build:** `internal/model`: path templating, `routes` overrides, aggregation of sample
  counts, parameter names, status codes, content types, tables read and written with
  operations and row counts, top fingerprints, late writes; union of several recordings;
  versioned, documented JSON schema; deterministic output.
- **Done when:** unit tests cover templating and overrides; `behaviour.json` for the demo
  recording is a golden file and matches `expected.yaml`; the model of two recordings
  equals their union.

### Step 16 — Findings and completeness notes

- **Goal:** tell the reader what is surprising and what the map cannot know.
- **Build:** findings (GET that writes, repeated fingerprint in one request, write without
  a session); optional catalogue query over an admin connection flagging tables with
  triggers or cascading foreign keys; "observed, not exhaustive" metadata.
- **Done when:** one test per finding; the demo model contains the seeded GET-write, the
  N+1 and the trigger table flag (criterion A3).

### Step 17 — Map renderer and `map` — milestone M1

- **Goal:** the document a person reads.
- **Build:** `internal/mapgen`: one `BEHAVIOUR.md` with header, endpoint index, endpoint
  sections, CRUD matrix, findings, completeness notes; `trowel map`; redaction applied; the
  demo map committed under `examples/legacy-shop`.
- **Done when:** output is covered by golden files; the committed map renders correctly on
  GitHub; the secret search test covers `trowel/behaviour/**` (criterion A4); the harness
  checks A1 to A3.

### Step 18 — Reality check I: map of a system we did not write

- **Goal:** find out what breaks outside the demo, before anything is announced.
- **Build:** run record and map on a copy of the pilot system and on one public open-source
  PostgreSQL web application. Report: setup friction, label shares, delay histogram,
  analysis misses, a manual audit of ten endpoints. Fix what blocks; file the rest. Publish
  the map of the public application as the showcase.
- **Done when:** criterion A5 is met on at least one of the two systems, or the release is
  held and the gap is recorded; the report is committed without any data from the pilot
  system; the showcase map is committed.
- **Precondition:** written permission to use a copy of the pilot system, or the public
  application alone is used.

### Step 19 — Packaging, release pipeline, `init`

- **Goal:** anyone can install it.
- **Build:** GoReleaser for Linux, macOS and Windows on amd64 and arm64 with checksums;
  image published to the GitHub container registry on tags; `trowel init` writing a starter
  `trowel.yaml` and Compose override; benchmark script for proxy overhead.
- **Done when:** a release-candidate tag produces binaries and an image; the Linux binaries
  and the image pass the harness; `init` output works unedited on the demo app (criterion
  A6); overhead numbers are produced by the script (criterion A8).

### Step 20 — Documentation and launch — milestone M2, v0.1.0 "Map"

- **Goal:** a stranger succeeds without help.
- **Build:** README with constraints first, quickstart, a short terminal recording, the
  showcase map; concept pages (how correlation works, labels, limitations); comparison page
  from the bench; "using the map with a coding agent" page; schema reference; maintenance
  statement; CHANGELOG; issue templates; tag `v0.1.0`.
- **Done when:** a person who has not seen the project reaches the demo map in ten minutes
  from the README alone (criterion A7); links and commands in the docs are checked in CI;
  the release is published.

## Phase D — Protect

### Step 21 — Assertion primitives: JSON path, JSON diff, matchers

- **Goal:** the comparison tools everything after this uses.
- **Build:** `internal/assert`: minimal JSON path; structural JSON diff with paths, ignores
  and `unordered`; typed matchers (timestamp, UUID, JWT, token); line diff for reports.
- **Done when:** table-driven tests cover added, removed and changed fields, reordered
  arrays and keys, and every matcher passing and failing; diffs name the JSON path.

### Step 22 — Flow schema, loader, writer

- **Goal:** a stable file format before anything generates it.
- **Build:** `internal/flow`: schema version 1 with validation and line-numbered errors;
  deterministic YAML writer; sidecar files; `unasserted` and `skip` markers; schema
  reference page.
- **Done when:** load-then-write is byte-identical for a hand-written fixture covering
  every field; invalid files are rejected with a line number.

### Step 23 — `generate`

- **Goal:** recordings become reviewable test files.
- **Build:** steps from exchanges; no static or bypassed exchange becomes a step; client
  identity by cookie lineage; cookie headers dropped; secrets to references and
  `.trowel/secrets.env`; typed matchers at generation time; HTML bodies marked
  `unasserted`; `sql.writes` from high-confidence statements, `unasserted` where an
  ambiguous or unanalysable write exists; `trowel generate` (`experimental` until step 32).
- **Done when:** the demo flow is a golden file; generating twice is byte-identical; the
  rotating login stays one client; the secret search test covers `trowel/flows/**`
  (criterion A13, first half).

### Step 24 — Value correlation and captures

- **Goal:** flows that survive fresh sessions, tokens and ids.
- **Build:** candidate extraction from responses; search in later requests of the same
  client; `capture` and `{{variable}}` emission; selectors for JSON path, header and
  regular expression on the body.
- **Done when:** unit tests cover each source and sink; the demo flow has captures for the
  CSRF token, the API token and the created order id; no recorded token is literal in any
  request.

### Step 25 — Snapshot and reset

- **Goal:** every replay starts from the state the recording started from.
- **Build:** admin connection and its preflight; `trowel snapshot create | list | drop`;
  schema and row-count checksum; tap pause; the reset sequence with owner, grants and
  settings re-applied; `reset.command` hook; readiness wait; snapshot at `record` start.
- **Done when:** scenario, reset, scenario yields identical generated ids; a database with
  a non-default owner and an `ALTER DATABASE … SET search_path` behaves the same after
  reset; a non-owner admin role and an open outside session each produce an error naming
  the cause; after reset the demo app (no pool error handler) serves again and the time to
  ready is printed.

### Step 26 — Runner I: HTTP replay with response assertions

- **Goal:** execute a flow against the running app and judge the responses.
- **Build:** `internal/replay`: flow loading, `origin` handling, no redirect following,
  per-client cookie jars, variables and captures with a clear "capture broken" failure,
  secret resolution, reset before the flow, status, header and JSON body assertions;
  `trowel replay` (`experimental`).
- **Done when:** the demo flow replays green on responses; a 302 step asserts 302; a seeded
  wrong status and a seeded wrong JSON field each fail at the right step; a missing secret
  fails before the first request with the list of names (criterion A13, second half).

### Step 27 — Runner II: tap in replay, step windows

- **Goal:** know what each replayed step did to the database.
- **Build:** replay owns both listeners (process model D15); each step runs in a window
  with the same gate and quiet-period code as recording; replay sessions and step ids in
  the store; mode switch documented in the Compose example.
- **Done when:** replay is started against an app that was running under `record` and the
  app serves without manual action; statements are stored per step; a late write of step N
  is not attributed to step N+1.

### Step 28 — SQL write assertions

- **Goal:** fail when a step writes something else than it did.
- **Build:** per-step aggregation of tables, operations and affected rows from
  high-confidence statements; rolled-back work excluded; zero-row entries dropped;
  CTE-write rule; hard comparison with `sql.writes`; late writes as warnings.
- **Done when:** tests cover a missing write, an extra write, a changed row count, a
  rolled-back write, an upsert, a zero-row write and a CTE write; the three harmless
  refactors of criterion A11 pass; the demo flow passes with SQL assertions on.

### Step 29 — End-of-flow state checksum

- **Goal:** fail when the database ends up different, including a different value.
- **Build:** after the last step, per written table: row count and per-column multiset
  hash over the admin connection; `state` block emitted by `generate` and checked by
  `replay`; size limit with visible fallback to row count; `state.tables: all`.
- **Done when:** changing one written value in the demo app fails the flow and names table
  and column; hashes are identical across two replays for every column type in the demo
  schema except the deliberately noisy ones; the trigger table's effect is caught with
  `state.tables: all`.

### Step 30 — `calibrate`

- **Goal:** find what legitimately changes between runs, and write it down.
- **Build:** reset, replay, reset, replay; noise rules for response fields and state
  columns; systematic-difference detection with quarantine; `--accept-baseline`.
- **Done when:** on the demo flow, calibration adds rules for the epoch number, the nonce
  and the noisy state columns and for nothing else; three consecutive replays pass
  (criterion A9); calibrating twice changes nothing; with a wrong snapshot calibration
  stops and adds no rule (criterion A12).

### Step 31 — Reporting: console, JUnit, exit codes

- **Goal:** results people and CI can use.
- **Build:** `internal/report`: per-step diffs, summary, "possibly consequential" marking,
  JUnit XML, exit codes by failure class; a GitHub Actions workflow in the demo that runs
  replay.
- **Done when:** the report for a failing demo run is a golden file; the JUnit file
  validates against the checked-in XSD; the demo workflow runs green (criterion A15).

### Step 32 — Approval and user rules — milestone M3

- **Goal:** live with intended changes.
- **Build:** `replay --update` for selected steps; user rules at global and step level
  (JSON path, header, regular expression, state column); `generate`, `calibrate` and
  `replay` lose the `experimental` mark.
- **Done when:** after an intended change, `--update` followed by replay passes and the
  flow diff is minimal; a global rule and a step rule each suppress exactly their target.

## Phase E — Ship

### Step 33 — Seeded regressions and negative controls

- **Goal:** prove the acceptance criteria automatically.
- **Build:** six regressions and three harmless refactors as environment switches in the
  demo app; harness runs the full sequence for each.
- **Done when:** each regression fails at the expected step with the expected kind of
  diff, each refactor passes (criteria A10, A11); the whole suite is green on `main`.

### Step 34 — Reality check II: replay on a system we did not write

- **Goal:** find out whether flows hold on real behaviour.
- **Build:** generate, calibrate and replay on the systems from step 18. Report: share of
  steps passing, quarantine reasons, reset time, what had to be configured by hand. Fix
  what blocks; file the rest.
- **Done when:** criterion A14 is met on at least one system, or the release is held and
  the gap is recorded; the report is committed without pilot data.

### Step 35 — Documentation and release — milestone M4, v0.2.0 "Protect"

- **Goal:** the MVP is complete and presentable.
- **Build:** docs for snapshot, generate, calibrate, replay; "what is and is not asserted"
  page; CI recipe; a short recording of a regression being caught; updated comparison page;
  CHANGELOG; tag `v0.2.0`.
- **Done when:** a person new to the project catches a seeded regression in the demo by
  following the docs; all acceptance criteria A1 to A15 are checked in CI or recorded in a
  report; the release is published.

---

## Phase F — After the MVP (not scheduled)

1. MySQL and MariaDB tap, `COM_QUERY` first, then prepared statements. Open core.
2. Normalised HTML body diff.
3. TLS termination for the database hop.
4. Limited concurrency through connection-lifetime correlation and optional SQL comment tags.
5. An MCP server over the map and flows for coding agents.
6. Row-level diff per request; static HTML audit report.
7. Export to Hurl; OpenAPI inference for JSON endpoints.
8. Optional LLM naming and summaries, after redaction is proven.

The order is a judgement, not a research finding. It is revisited after each reality check.

## Validation alongside the build

Not steps; they do not block steps.

- From step 2 on: talk to five developers or agencies who take over legacy systems about
  whether a behaviour report is worth a per-project fee.
- At v0.1.0: post the showcase map where people who maintain that application will see it.
