# 01 — MVP scope

Status: accepted, 11 November 2026. Based on the three reports in `docs/research/`.

## 1. Problem and user

A developer or a small team has inherited a web application they did not write. There is
little documentation and few or no tests. Before they refactor, upgrade or migrate it, they
need to know what each endpoint does to the database and they need a safety net that tells
them when behaviour changed.

Primary user for the MVP: a developer maintaining an inherited **Node.js + PostgreSQL** web
application who can run a non-production copy of it. This matches the first pilot system.

Buyers we expect later (see research report 01): freelancers and agencies who take over
legacy applications, small in-house teams before a migration, and developers who steer
coding agents on legacy code and need behaviour evidence as context.

## 2. Product in one sentence

Trowel observes a running web application from the outside and produces (a) a behaviour map
of what every endpoint reads and writes, and (b) golden-master tests that replay recorded
requests against the real application and fail when the response or the database writes
differ.

## 3. Positioning

The category "generate API tests from recorded traffic" is crowded and free (Keploy,
Speedscale proxymock, Tusk Drift). The MVP does not compete there. It differs on three
points the research found unoccupied:

| Point | Trowel | Closest tools |
|---|---|---|
| Database | Real database stays in the loop; tests assert on what was written | Record SQL in order to mock the database away |
| Understanding | The behaviour map is a first-class, committed, diffable artefact | Tests only; AppMap maps behaviour but needs a per-language agent |
| Setup | Network-level, no SDK, no eBPF, no code change | SDK per language, or eBPF with kernel and platform limits |

Order of messaging: **understanding first, tests second.** The first thing a new user gets,
after half an hour of clicking through their app, is the map.

## 4. User journey in the MVP

1. Add Trowel to the app's Docker Compose setup with an override file. The app's database
   host points at Trowel; the browser points at Trowel's HTTP port.
2. `trowel record` — click through one feature of the app (or run a script). Stop.
3. `trowel map` — read `BEHAVIOUR.md`: endpoints, tables read and written per endpoint,
   a table-by-endpoint matrix, and findings such as "this GET writes to `audit_log`".
4. `trowel generate` then `trowel calibrate` — flow tests appear as YAML files with
   everything that is not asserted written down explicitly.
5. Change the app. `trowel replay` — a readable diff shows which step changed and how;
   exit code and JUnit XML make it usable in CI.

## 5. In scope

| ID | Feature | Notes |
|---|---|---|
| F1 | HTTP recording reverse proxy | Request and response pairs, capped bodies, streaming-safe |
| F2 | PostgreSQL tap proxy | Relay raw bytes, decode a copy; simple and extended query protocol |
| F3 | Request-to-statement correlation | Serial gate plus time window; every link carries a confidence label |
| F4 | Capture store | One SQLite file per recording session |
| F5 | Redaction and preflight checks | Default redaction of credentials; clear errors for unsupported setups |
| F6 | SQL analysis | Statement kind, fingerprint, tables read and written |
| F7 | Behaviour map | `behaviour.json`, `BEHAVIOUR.md`, per-endpoint pages, CRUD matrix, findings |
| F8 | Flow test generation | YAML flow files with sidecar bodies, cookie jars, captured variables |
| F9 | Replay runner | Sequential replay against the real app, database reset per flow |
| F10 | Assertions | Status, header allowlist, JSON structural diff, normalised HTML diff, per-table write counts |
| F11 | Noise handling | Built-in typed scrubbers, `calibrate` (double replay), user rules |
| F12 | Reporting | Console diff, JUnit XML, `--update` approval workflow |
| F13 | Demo application | A small "legacy" Node.js + PostgreSQL shop used for tests, docs and the demo |
| F14 | Distribution | Static binaries for Linux, macOS, Windows; Docker image; quickstart |

## 6. Out of scope for the MVP

| Not included | Why | When |
|---|---|---|
| MySQL / MariaDB | Protocol costs two to three times more; pilot is on PostgreSQL | First milestone after the MVP |
| TLS between app and database | Needs TLS termination and breaks SCRAM channel binding | After the MVP |
| Concurrent requests while recording | Correlation without code changes relies on serialisation | After the MVP, per connection-lifetime rules |
| Mocking the database or outbound services | Opposite of the product's point; largest engineering item | Not planned for the core |
| Row-level diff of database state | Needs change data capture or snapshots; strongest future differentiator | First paid-tier candidate |
| Effects of triggers and stored procedures | Invisible on the wire | With row-level diff |
| Production traffic capture, load testing, Kubernetes | Other products own this | Not planned |
| OpenAPI export, static HTML report, sequence diagrams | Useful, not core | Backlog |
| Code generation for Jest, PHPUnit, pytest | One generator per framework is not maintainable solo | Backlog |
| Clock freezing, JWT re-signing | Regex rules and a login flow cover the MVP | Backlog |
| Any LLM feature | A golden master must be deterministic; recordings contain personal data | After redaction is solid |
| WebSockets | Passed through, handshake recorded only | Backlog |

## 7. Constraints the user must accept

These are stated at the top of the README, because they are the real adoption cost.

1. Trowel runs against a **non-production copy** of the application.
2. While recording, requests are processed **one at a time**.
3. The connection between the app and the database is **plain TCP** during recording and replay.
4. The database must be **resettable**: the role used by Trowel may create and drop databases.
5. Background workers and cron jobs that use the same database should be stopped while recording.
6. Recordings contain credentials and personal data. They are git-ignored by default and must
   not be shared.

## 8. Acceptance criteria — the MVP is done when all of these hold

| ID | Criterion | How it is checked |
|---|---|---|
| A1 | The demo app is recorded with zero changes to its source code; only a Compose override is added | Review of the example directory |
| A2 | After recording the scripted demo scenario, every statement is linked to a request with a high-confidence label or is explicitly labelled `background` or `late` | End-to-end test |
| A3 | The generated behaviour map lists every exercised endpoint with the correct tables read and written | Compared with a hand-written expected file |
| A4 | Generate, calibrate and replay pass three times in a row on the unchanged demo app | End-to-end test in CI |
| A5 | Five seeded regressions in the demo app (changed status, changed JSON field, changed HTML, missing write, extra write) each make replay fail with a diff that names the right step | End-to-end test in CI |
| A6 | Static binaries for Linux, macOS and Windows on amd64 and arm64 are built with CGO disabled; a Docker image is published | Release pipeline |
| A7 | A new user reaches a behaviour map of the demo app in ten minutes by following the README | Manual run on a clean machine |
| A8 | Trowel produces a behaviour map for one real Node.js + PostgreSQL system; problems found are filed as issues | Pilot report |

## 9. Open-core boundary

Everything in section 5 is Apache-2.0 and stays open. The tool sits in the data path of
someone's application, so trust requires readable source.

Candidates for a later paid add-on, sold per project or per year rather than per seat:
row-level database diffs, an HTML or PDF audit report for clients, advanced redaction of
personal data, CI integrations with history, MySQL support for old PHP stacks with
commercial support. None of this is built or promised in the MVP.

## 10. Known tension, decided

Research report 01 finds the sharpest market niche in old PHP + MySQL applications. Research
report 02 finds PostgreSQL the far easier first protocol, and the pilot system runs on
Node.js + PostgreSQL. Decision: the MVP ships PostgreSQL only and is described as "for the
web app you inherited", without naming a stack. MySQL is the first milestone after the MVP.
The capture layer hides the database protocol behind an interface from the first step so
that this is an addition, not a rewrite.

## 11. Open questions

| Question | Needed by |
|---|---|
| Final product name and repository name (Trowel is a working name; conflicts not checked in depth) | Step 1 |
| Does the pilot system use TLS to its database, connection pooling middleware (PgBouncer) or background workers? | Step 8 |
| May a copy of the pilot system and its data be used for this project, and under which conditions? | Step 24 |
