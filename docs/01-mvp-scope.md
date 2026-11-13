# 01 — MVP scope

Status: revision 2, 11 November 2026. Based on the research reports in `docs/research/` and
revised after the two independent reviews in `docs/reviews/`.

## 1. Problem and user

A developer or a small team has inherited a web application they did not write. There is
little documentation and few or no tests. Before they refactor, upgrade or migrate it, they
need to know what each endpoint does to the database, and they need a safety net that tells
them when behaviour changed.

Primary user for the MVP: a developer maintaining an inherited web application **in any
language that talks to PostgreSQL over TCP**, who can run a non-production copy of it. The
first pilot system is Node.js + PostgreSQL.

Unvalidated buyer hypotheses (research report 01, nobody has confirmed willingness to pay):
freelancers and agencies who take over legacy applications, small in-house teams before a
migration, and developers who steer coding agents on legacy code and need behaviour
evidence as context.

## 2. Product in one sentence

> Put Legacy Checker between the web app you inherited and its PostgreSQL database. Click through a
> feature once and you get a committed map of which tables each endpoint you touched reads
> and writes, and replay tests against the real database that fail when it ends up
> different. No SDK, no agent, no code change.

"Ends up different" is meant literally: after a replayed flow, Legacy Checker compares which tables
were written, how many rows each operation affected, and a per-column checksum of the
written tables (F11). A changed stored value fails the test, not only a changed row count.

## 3. Positioning

The category "generate API tests from recorded traffic" is crowded and free (Keploy,
Speedscale proxymock, Tusk Drift). The MVP does not compete there. It claims three points:

| Point | Legacy Checker | Closest tools, as far as the research could read |
|---|---|---|
| Database | Real database stays in the loop; tests assert on written state | Record SQL in order to mock the database away; proxymock compares statement text between runs |
| Understanding | The behaviour map is a committed, diffable artefact | Tests and inventories; AppMap maps behaviour through a per-language agent |
| Setup | Network level only | SDK per language, or eBPF with kernel and platform limits, or a proxy with activation |

**This table is a hypothesis until step 3.** On a Dockerised Node.js + PostgreSQL app the
competitors are at their strongest, so the "Setup" row may not hold there. Step 3 runs
Keploy, proxymock, AppMap and Tusk Drift against the demo application and rewrites this
section from what actually happened. The decision rule is in the roadmap.

Order of messaging: **understanding first, tests second.**

## 4. Two releases

| Release | Contains | Purpose |
|---|---|---|
| **v0.1.0 "Map"** | `record`, `inspect`, `map`, packaging, documentation, one public showcase map | The first finished product. Useful on its own; exists even if the project stops here |
| **v0.2.0 "Protect"** | `snapshot`, `generate`, `calibrate`, `replay` | Completes the MVP |

## 5. User journey

1. `legacy-checker init` writes a config file and a Compose override. The app's database host points
   at Legacy Checker; the browser points at Legacy Checker's HTTP port.
2. `legacy-checker record` — click through one feature of the app, or run a script. Stop.
3. `legacy-checker map` — read `BEHAVIOUR.md`: endpoints you exercised, tables each one reads and
   writes, a table-by-endpoint matrix, and findings such as "this GET writes to `audit_log`".
4. `legacy-checker generate`, then `legacy-checker calibrate` — flow tests appear as YAML files. Everything
   that is not asserted is written down in the file.
5. Change the app. `legacy-checker replay` — a diff shows which step changed and how. Exit code and
   JUnit XML make it usable in CI.

## 6. In scope

| ID | Feature | Release | Notes |
|---|---|---|---|
| F1 | HTTP recording reverse proxy | 0.1 | Request and response pairs, capped bodies, streaming-safe |
| F2 | PostgreSQL tap proxy | 0.1 | Relay raw bytes, decode a copy; simple and extended protocol, transactions |
| F3 | Request-to-statement correlation | 0.1 | Serial gate plus time window; a confidence label on every statement |
| F4 | Capture store | 0.1 | Local SQLite file, raw, never committed |
| F5 | Redaction at every export | 0.1 | Secret values are replaced wherever they occur in exported text |
| F6 | Preflight and `inspect` | 0.1 | Plain instructions for unsupported setups; a way to look into a recording |
| F7 | SQL analysis | 0.1 | Statement kind, fingerprint, tables read and written |
| F8 | Behaviour map | 0.1 | `behaviour.json` and one `BEHAVIOUR.md`: endpoint index, per-endpoint sections, CRUD matrix, findings, completeness notes |
| F9 | Distribution | 0.1 | Docker image and Linux binaries supported; macOS and Windows binaries built and smoke-tested; `legacy-checker init` |
| F10 | Snapshot and reset | 0.2 | Named snapshots; reset before every flow |
| F11 | Flow tests | 0.2 | YAML flows, cookie jars, captured variables; assertions on status, headers, JSON body, table writes, end-of-flow state checksum |
| F12 | Noise handling | 0.2 | Built-in typed matchers, `calibrate` (double replay), user rules at global and step level |
| F13 | Reporting and approval | 0.2 | Console diff, JUnit XML, exit codes, `--update` |
| F14 | Demo application | 0.1 | A small "legacy" Node.js + PostgreSQL shop used for tests, docs and the demo |

## 7. Out of scope for the MVP

| Not included | Why | When |
|---|---|---|
| MySQL / MariaDB | Protocol costs two to three times more; pilot is on PostgreSQL | Phase F, in the open core |
| Normalised HTML body diff | Large, and not needed for the differentiation; HTML responses are asserted on status, headers and database effects, and the flow file says the body is not compared | After 0.2 |
| Per-endpoint pages, Mermaid diagrams, parameter type inference | Presentation extras | After 0.2 |
| Warnings on tables read and statement fingerprints during replay | Signal is weak; the map already shows them | After 0.2 |
| TLS between app and database | Needs TLS termination | After 0.2 |
| Concurrent requests while recording | Correlation without code changes relies on serialisation | After 0.2 |
| Mocking the database or outbound services | Opposite of the product's point | Not planned for the core |
| Row-level diff per request | Needs change data capture; the end-of-flow checksum covers the claim at flow level | Later, paid-tier candidate |
| Production capture, load testing, Kubernetes | Other products own this | Not planned |
| OpenAPI export, static HTML report, code generation for test frameworks | Useful, not core | Backlog |
| Clock freezing, JWT re-signing | Rules and a login flow cover the MVP | Backlog |
| Any LLM feature | Pass or fail must be deterministic; recordings contain personal data | After redaction is proven |
| WebSockets | Passed through, handshake recorded only | Backlog |

## 8. Constraints the user must accept

These go at the top of the README. They are the real adoption cost.

1. Legacy Checker runs against a **non-production copy** of the application.
2. While recording and replaying, requests are processed **one at a time**.
3. The connection between the app and the database is **plain TCP**.
4. PostgreSQL 13 or newer. For replay, an **admin role** that owns the application database
   (or is superuser) and may create databases.
5. Background workers and cron jobs that use the same database should be stopped. Timers
   inside the app process cannot be stopped; Legacy Checker labels what it can detect.
6. The app must **survive losing its database connections or be restarted by its
   supervisor**; Legacy Checker waits until it is ready again after a reset.
7. **Replay sends real requests.** Outbound e-mail, payments and other side effects must be
   sandboxed by the user before replay.
8. Recordings contain credentials and personal data and stay local. **Generated flow files
   contain response data from the recorded database**; they are meant to be committed, so
   record against test data.
9. Flows that depend on the current date (expiry, "last 24 hours") age and need re-recording.
10. Effects of triggers, functions and cascades are not attributed to requests. The map
    lists tables that have them, and the state checksum can be widened to all tables.

## 9. Acceptance criteria

### v0.1.0 "Map"

| ID | Criterion | How it is checked |
|---|---|---|
| A1 | The demo app is recorded with its image unmodified; only the Compose override is added | End-to-end harness in CI |
| A2 | For the scripted scenario, statement count and SQL prefix per request equal `expected.yaml`; statements of the interval job and the post-response write are not high-confidence | End-to-end harness |
| A3 | Tables read and written per endpoint equal `expected.yaml`; the seeded GET-that-writes and N+1 appear as findings | End-to-end harness |
| A4 | No secret value of the demo recording occurs in `inspect` output or in `legacy-checker/behaviour/**` | Search test in CI |
| A5 | On one system we did not write: at least 90 % of statements are analysed, at least 95 % of in-window statements are high-confidence, and a manual audit of ten endpoints finds the table lists right for at least nine | Reality-check report (step 18) |
| A6 | Linux amd64 and arm64 binaries and the Docker image pass the end-to-end harness; macOS and Windows binaries build and pass unit tests | Release pipeline |
| A7 | A person new to the project reaches the demo map in ten minutes from the README alone | Manual run, recorded in the release notes |
| A8 | Measured latency overhead of both proxies on the demo scenario is published in the docs | Benchmark script in the repository |

### v0.2.0 "Protect"

| ID | Criterion | How it is checked |
|---|---|---|
| A9 | Generate, calibrate and replay pass three times in a row on the unchanged demo app | End-to-end harness |
| A10 | Six seeded regressions (changed status, changed JSON field, missing write, extra write, changed row count, changed written value) each fail at the named step with the expected kind of diff | End-to-end harness |
| A11 | Three harmless refactors pass: two single-row inserts rewritten as one multi-row insert, reordered JSON keys, update-then-insert rewritten as an upsert | End-to-end harness |
| A12 | With a wrong snapshot, `calibrate` stops and adds no rule | End-to-end harness |
| A13 | No secret value occurs in `legacy-checker/flows/**`; replay with a missing secret fails before the first request and lists the names | Search test and unit test |
| A14 | On one system we did not write: after calibration at least 80 % of generated steps pass replay and every other step is quarantined with a reason | Reality-check report (step 34) |
| A15 | The demo repository contains a working GitHub Actions workflow that runs replay | CI |

Thresholds in A5 and A14 are targets set before any measurement. If a reality check misses
one, the release is held and the cause is fixed or the limitation is documented and the
threshold change is recorded in the decision log.

## 10. Open-core boundary

Everything in section 6 is Apache-2.0 and stays open, and so will MySQL support. The tool
sits in the data path of someone's application, so trust requires readable source. Legacy Checker
sends no telemetry and opens no network connections other than the two upstreams it is
configured with.

Ideas for a later paid add-on, sold per project or per year: row-level database diffs per
request, an HTML or PDF audit report for clients, advanced redaction of personal data,
CI history. None of this is built or promised.

## 11. PostgreSQL first — decided, with its cost

Research report 01 finds the sharpest market niche in old PHP + MySQL applications. Research
report 02 finds PostgreSQL the far easier first protocol, and the pilot system runs on
Node.js + PostgreSQL. Decision: the MVP supports PostgreSQL only and says so in its first
sentence. This is the right choice for finishing; it is not the strongest choice for the
market, because on PostgreSQL with Docker the competitors work too. MySQL is scheduled as
Phase F. The capture layer keeps the database protocol behind an interface from the start.

## 12. Reasons this may not work

Stated plainly so that the plan is judged with them in view (research report 01, section 4):

- **The need is episodic.** A team uses such a tool for a few weeks at takeover and then
  stops. Subscriptions fit poorly.
- **Owners of small legacy systems rarely pay for tooling.**
- **Three teams left the neighbouring segment** (Optic, Akita, Pythagora's recorder) without
  building a standalone business there.
- **The moat is focus, not technology.** Speedscale has the proxy and the parsers already.
- **The strongest substitute is a coding agent with a prompt.** The answer is to feed agents
  with observed behaviour, not to compete with them; the map and flows are plain files for
  that reason.

Realistic expectation: a useful open-source tool with strong portfolio value and modest
revenue potential from agencies and project work. Not a venture-scale business.

## 13. If time runs out — cut in this order

1. macOS and Windows binaries (Docker and Linux only).
2. JUnit XML (exit code and console output remain).
3. User rules at step level (global rules remain).
4. `--update` (re-generate instead).
5. The whole v0.2.0 release. v0.1.0 remains a finished product.

Never cut: confidence labels, redaction, preflight messages, database reset, calibration,
write assertions, the state checksum, the public showcase map.

## 14. Open questions

| Question | Needed by |
|---|---|
| May a copy of the pilot system be used, with which data, and who owns a tool built partly in connection with that job? | Before step 1; blocks step 18 |
| Does the pilot system use TLS to its database, PgBouncer, an ORM, background workers or in-process timers? | Step 7 |
