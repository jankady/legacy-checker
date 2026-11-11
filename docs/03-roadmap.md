# 03 — Roadmap

Status: accepted, 11 November 2026.

## Rules

1. **One step at a time.** A step is started only when the previous step meets every line of
   its "Done when" list, its checks are green in CI, and it is merged to `main`. No step is
   started early, and steps are not worked on in parallel.
2. **Steps are the same size.** Each step is one pull request with one concern: roughly
   300 to 600 lines of production code plus tests, or the equivalent in documentation or
   configuration. If a step turns out bigger, it is split in this document first, and only
   then continued.
3. **Every step leaves `main` releasable.** Tests pass, the binary builds with
   `CGO_ENABLED=0`, and nothing half-finished is reachable from the CLI.
4. **Scope changes go through the documents.** A change of scope or of a technical choice is
   written into `01-mvp-scope.md` or `04-decisions.md` before code follows.
5. **Tracking.** The table below is the single source of truth. A step is ticked in the same
   pull request that completes it.

## Progress

| # | Step | Phase | Status |
|---|---|---|---|
| 0 | Research, MVP scope, architecture, roadmap | Plan | Done |
| 1 | Repository scaffold and CI | A Foundations | Next |
| 2 | Demo application "legacy-shop" | A Foundations | |
| 3 | Capture store | B Capture | |
| 4 | HTTP recorder | B Capture | |
| 5 | PostgreSQL relay | B Capture | |
| 6 | PostgreSQL decoder: simple protocol | B Capture | |
| 7 | PostgreSQL decoder: extended protocol | B Capture | |
| 8 | Serial gate, correlation, `record` command | B Capture | |
| 9 | Redaction, preflight, `inspect` command | B Capture | |
| 10 | SQL analysis | C Understand | |
| 11 | Endpoint model and `behaviour.json` | C Understand | |
| 12 | Map renderer and `map` command — **milestone M1** | C Understand | |
| 13 | Flow format and `generate` command | D Protect | |
| 14 | Value correlation and captures | D Protect | |
| 15 | Replay runner core | D Protect | |
| 16 | Body assertions: JSON and HTML | D Protect | |
| 17 | Database snapshot and reset | D Protect | |
| 18 | SQL assertions | D Protect | |
| 19 | `calibrate` command | D Protect | |
| 20 | Reporting and approval workflow — **milestone M2** | D Protect | |
| 21 | End-to-end suite with seeded regressions | E Ship | |
| 22 | Packaging and release pipeline | E Ship | |
| 23 | Documentation and public launch — **milestone M3, v0.1.0** | E Ship | |
| 24 | Pilot on a real system | E Ship | |

Milestones:

- **M1 (after step 12):** `record` and `map` work end to end. First public alpha: a person
  can point Trowel at an app and get a behaviour map.
- **M2 (after step 20):** tests can be generated, calibrated, replayed and approved.
- **M3 (after step 23):** v0.1.0 released with binaries, image and documentation.

---

## Phase A — Foundations

### Step 1 — Repository scaffold and CI

- **Goal:** an empty but real project that builds, tests and lints on every push.
- **Build:** Go module; `cmd/trowel` with cobra root, `version` command and config loading
  from `trowel.yaml`; package skeleton from the architecture document; Makefile; golangci-lint
  configuration; GitHub Actions workflow (build, test, lint, `CGO_ENABLED=0`); pinned
  dependency versions with a note of the date checked; CONTRIBUTING; final product and
  repository name applied.
- **Done when:** `trowel version` prints version and commit; CI is green on `main`; the
  binary builds for Linux, macOS and Windows on amd64 and arm64 in CI.

### Step 2 — Demo application "legacy-shop"

- **Goal:** a realistic inherited system to develop against, with known quirks.
- **Build:** `examples/legacy-shop`: Node.js + Express + `pg` + PostgreSQL in Docker Compose
  with seed data. Session login with a cookie and a token-based API login; product list
  (JSON); one server-rendered HTML page with a form and a CSRF token; add to cart; checkout
  in a transaction touching three tables; one request that rolls back; one GET that writes
  to an audit table; one endpoint with an N+1 query pattern; one endpoint returning
  timestamps and UUIDs. A scripted scenario (`scenario.sh`) that exercises all of it. A
  hand-written `EXPECTED.md` listing each endpoint with the tables it reads and writes.
- **Done when:** `docker compose up` starts the app; the scenario script passes; CI runs
  the scenario; `EXPECTED.md` is reviewed against the source.

## Phase B — Capture

### Step 3 — Capture store

- **Goal:** a place to put recordings.
- **Build:** `internal/store`: SQLite schema from the architecture document, versioned
  migrations, typed insert and query functions for sessions, exchanges, bodies, connections,
  statements and links; body deduplication by hash; size caps.
- **Done when:** unit tests cover a round trip for every table; a store file survives
  close and reopen; the binary still builds without CGO.

### Step 4 — HTTP recorder

- **Goal:** record every request and response that passes through.
- **Build:** `internal/httprec`: reverse proxy with `Rewrite`, body tees with caps,
  `Accept-Encoding: identity`, preserved `Host`, pass-through of upgrades and streaming,
  exchange rows written to the store. No gate yet.
- **Done when:** integration tests against a test server cover JSON, HTML, a large body,
  a chunked stream, a redirect and an error; the demo app is fully usable through the proxy
  and the scenario script produces one exchange row per request.

### Step 5 — PostgreSQL relay

- **Goal:** a transparent TCP proxy the application cannot tell from the database.
- **Build:** `internal/dbtap` relay; `internal/dbtap/pg` startup handling (`SSLRequest`
  and `GSSENCRequest` answered with `N`, `CancelRequest` forwarded, detection of a direct TLS
  hello with a clear error); connection open and close recorded; protocol-neutral tap
  interface defined; no decoding yet.
- **Done when:** `psql`, node-postgres and pgx connect, authenticate with SCRAM, run
  queries and cancel a query through the relay against PostgreSQL 14 and 17 in integration
  tests; the demo app runs through the relay; connection rows are stored.

### Step 6 — PostgreSQL decoder: simple protocol

- **Goal:** see SQL sent with the simple query protocol.
- **Build:** tap decoder with `pgproto3` on a copy of both byte streams; `Query` messages
  to statement rows with command tag, row count, affected rows, error code, timing and
  result hash; multi-statement queries; fail-open behaviour with the `undecoded` state.
- **Done when:** integration tests assert the stored statements for select, insert, update,
  delete, a failing statement and a multi-statement query; a deliberately corrupted decode
  path leaves the relayed session working.

### Step 7 — PostgreSQL decoder: extended protocol

- **Goal:** see parameterised queries, which is what node-postgres and most drivers send.
- **Build:** `Parse`, `Bind`, `Describe`, `Execute`, `Sync`, `Close` handling; prepared
  statement map per connection; FIFO matching for pipelined messages; parameter decoding
  (text, common binary types, hex fallback); transaction status from `ReadyForQuery` and the
  `rolled_back` flag; `COPY` relayed and counted.
- **Done when:** integration tests with node-postgres and pgx cover named and unnamed
  prepared statements, a pipeline, a rolled-back transaction and an error inside a
  transaction; all statements from the demo scenario are stored with their parameters.

### Step 8 — Serial gate, correlation, `record` command

- **Goal:** know which request caused which statement.
- **Build:** serial gate with quiet period, bypass list and gate timeout;
  `internal/correlate` producing links with labels; `trowel record` wiring both proxies, the
  store and a summary on exit (exchanges, statements, share of each label).
- **Done when:** unit tests cover every label; recording the demo scenario yields no
  `ambiguous` links and attributes every statement as listed in `EXPECTED.md`; a statement
  issued by a simulated background job is labelled `background`.

### Step 9 — Redaction, preflight, `inspect` command

- **Goal:** recordings that are safe by default and a setup that explains its own failures.
- **Build:** `internal/redact` with default rules and config overrides, secret table;
  preflight checks for both upstreams with plain instructions; `trowel inspect` listing
  exchanges with their statements from a store file.
- **Done when:** tests prove that passwords, tokens and cookies from the demo scenario do
  not appear in the store outside the secret table; preflight tests cover an unreachable
  upstream and a TLS-only client; `inspect` output for the demo recording is a golden file.

## Phase C — Understand

### Step 10 — SQL analysis

- **Goal:** turn SQL text into facts.
- **Build:** `internal/sqlinfo`: fingerprint, statement kind, tables read and written, with
  rules for `INSERT ... SELECT`, data-modifying CTEs, `RETURNING`, joins and subqueries;
  `analysis` rows written for a store; unknown statements kept.
- **Done when:** a corpus of at least 60 statements (demo app plus hand-picked hard cases)
  has a golden file of expected results; every statement of the demo recording is analysed
  with the tables listed in `EXPECTED.md`.

### Step 11 — Endpoint model and `behaviour.json`

- **Goal:** group raw exchanges into endpoints and describe each one.
- **Build:** `internal/model`: path templating, `routes` overrides in config, aggregation of
  parameters with inferred types, status codes, content types, session requirement, tables
  read and written with row counts, top fingerprints, findings (GET that writes, repeated
  fingerprint within one request, write without session); deterministic JSON output.
- **Done when:** unit tests cover templating and each finding; `behaviour.json` for the
  demo recording is a golden file and matches `EXPECTED.md`.

### Step 12 — Map renderer and `map` command — milestone M1

- **Goal:** the document a person reads.
- **Build:** `internal/mapgen`: `BEHAVIOUR.md` with header, endpoint index, CRUD matrix and
  findings; one page per endpoint with a Mermaid graph; `trowel map` command; the demo map
  committed under `examples/legacy-shop`; a short alpha README section for record and map.
- **Done when:** rendered output is covered by golden files; the committed demo map renders
  correctly on GitHub; acceptance criteria A1, A2 and A3 hold; tag `v0.1.0-alpha.1`.

## Phase D — Protect

### Step 13 — Flow format and `generate` command

- **Goal:** recordings become reviewable test files.
- **Build:** `internal/flow`: schema version 1 with validation, deterministic YAML writer,
  sidecar body files, client labels from sessions, cookie headers dropped, secret
  references, built-in typed scrubbers applied at generation time; `trowel generate`.
- **Done when:** the generated flow for the demo recording is a golden file; generating
  twice gives byte-identical output; loading rejects invalid files with a line number.

### Step 14 — Value correlation and captures

- **Goal:** flows that survive fresh sessions, tokens and ids.
- **Build:** candidate extraction from responses (`Set-Cookie`, hidden inputs, meta tags,
  JSON leaves, `Location`), search in later requests of the same client, `capture` and
  `{{variable}}` emission; capture selectors for JSON paths, CSS selectors with attribute,
  headers and regex.
- **Done when:** unit tests cover each source and sink; the demo flow contains captures for
  the CSRF token, the API token and the created order id, and no recorded token remains
  literal in any request.

### Step 15 — Replay runner core

- **Goal:** execute a flow against the running app.
- **Build:** `internal/replay`: flow loading, per-client cookie jars, variable substitution,
  capture evaluation with a clear "capture broken" failure, sequential execution, status and
  header allowlist assertions, exit codes; `trowel replay` running the tap alongside so
  statements are recorded per step.
- **Done when:** the demo flow replays with correct status and header results on a freshly
  seeded database; a deliberately wrong expected status fails the right step; replay
  statements are stored per step.

### Step 16 — Body assertions: JSON and HTML

- **Goal:** compare what the app returned in a way that tolerates formatting and nothing else.
- **Build:** `internal/assert`: JSON structural diff with paths, ignores, typed matchers and
  `unordered`; HTML normalisation pipeline and line diff with selector ignores; hash
  comparison for other content types.
- **Done when:** table-driven tests cover added, removed and changed fields, reordered
  arrays, whitespace and attribute-order changes in HTML, and matcher failures; diffs name
  the JSON path or HTML node.

### Step 17 — Database snapshot and reset

- **Goal:** every replay starts from the state the recording started from.
- **Build:** snapshot at the start of `record` by cloning the application database;
  `reset.command` hook contract; built-in PostgreSQL helper (drop with force, clone from
  snapshot); the tap closes application connections at reset; skip reset after a flow
  without writes; loud warning when a recording has no snapshot.
- **Done when:** an integration test proves that ids produced by inserts are identical
  across two replays; the demo app reconnects after reset without a restart; a missing
  privilege produces a clear error.

### Step 18 — SQL assertions

- **Goal:** fail when the database would end up different.
- **Build:** per-step aggregation of tables written and affected rows per operation from
  the replay statements, rolled-back work excluded; hard comparison with the flow's `writes`;
  warn-level comparison for tables read and fingerprints; `sql` section emitted by `generate`.
- **Done when:** tests cover a missing write, an extra write, a changed row count, a
  rolled-back write and a rewritten query with the same effect (which must pass); the demo
  flow passes with SQL assertions on.

### Step 19 — `calibrate` command

- **Goal:** find what legitimately changes between runs, and write it down.
- **Build:** reset, replay, reset, replay; diff of each replay against the recording;
  rules written into the flow as typed matchers, ignores or `unordered`; quarantine of steps
  that stay unstable, with a reason; user rules at global, endpoint and step level.
- **Done when:** on the demo flow, calibration adds rules for the timestamp and UUID
  endpoint and nothing else; three consecutive replays pass (acceptance criterion A4);
  calibrating twice changes nothing.

### Step 20 — Reporting and approval workflow — milestone M2

- **Goal:** results people and CI can use.
- **Build:** `internal/report`: console output with per-step diffs and a summary,
  "possibly consequential" marking after a failed writing step, JUnit XML, `--update` to
  rewrite expectations for selected steps, non-zero exit codes by failure class.
- **Done when:** report output for a failing demo run is a golden file; the JUnit file
  validates against the common schema; `--update` followed by replay passes and produces a
  minimal diff in the flow files.

## Phase E — Ship

### Step 21 — End-to-end suite with seeded regressions

- **Goal:** prove the acceptance criteria automatically.
- **Build:** `test/e2e`: the full sequence record, map, generate, calibrate, replay on the
  demo app in GitHub Actions; five patches to the demo app (changed status, changed JSON
  field, changed HTML, missing write, extra write), each expected to fail replay at a named
  step.
- **Done when:** the suite is green on `main`; each seeded regression fails at the expected
  step with the expected kind of diff (acceptance criteria A4 and A5).

### Step 22 — Packaging and release pipeline

- **Goal:** anyone can install it.
- **Build:** GoReleaser configuration for six targets with checksums; Docker image
  published to the GitHub container registry; release workflow on tags; `trowel init`
  writing a starter `trowel.yaml` and Compose override; example override for the demo app.
- **Done when:** a release candidate tag produces binaries and an image; the image runs the
  demo recording; `trowel init` output works unedited on the demo app (criterion A6).

### Step 23 — Documentation and public launch — milestone M3

- **Goal:** a stranger succeeds without help.
- **Build:** README with constraints first, quickstart, a short terminal recording, the
  demo map as a showcase; concept pages (how correlation works, what is and is not asserted,
  limitations); comparison page with Keploy, proxymock and AppMap; CHANGELOG; issue
  templates; tag `v0.1.0`.
- **Done when:** a person who has not seen the project reaches the demo map in ten minutes
  from the README alone (criterion A7); all links and commands in the docs are checked in CI.

### Step 24 — Pilot on a real system

- **Goal:** find out what breaks outside the demo.
- **Build:** run record and map, then generate and replay, against a non-production copy
  of the pilot Node.js + PostgreSQL system; write a pilot report (what worked, what failed,
  correlation label shares, analysis misses); file issues; fix the blocking ones in patch
  releases.
- **Done when:** a behaviour map exists for the pilot system; the pilot report is committed
  without any data from that system; blocking issues are closed or scheduled (criterion A8).
- **Precondition:** permission from the system's owner to use a copy for this purpose.

---

## After the MVP (not scheduled)

Ordered by expected value, from research report 01:

1. MySQL and MariaDB tap, `COM_QUERY` first, then prepared statements.
2. Row-level database diff (snapshot of touched tables, later change data capture).
3. Static HTML audit report.
4. TLS termination for the database hop.
5. Limited concurrency through connection-lifetime correlation and optional SQL comment tags.
6. Plain-file access for coding agents (and later an MCP server).
7. Export to Hurl; OpenAPI inference for JSON endpoints.
8. Optional LLM naming and summaries, after redaction is proven.

## Validation to run alongside the build

These cost little and can change priorities. They are not steps and do not block steps.

- After M1: publish the behaviour map of a well-known open-source application and see
  whether the artefact alone gets attention.
- Before M3: run Keploy and Speedscale proxymock against the demo app and write down where
  each succeeds or fails; this feeds the comparison page.
- Any time: talk to five developers or agencies who take over legacy systems about whether
  a behaviour report is worth a per-project fee.
