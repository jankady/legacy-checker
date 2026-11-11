# 03 — Replay, assertions, test format and behaviour map

Research date: November 2026. Scope: everything that happens after a recording (HTTP request/response pairs plus the SQL each request caused) exists. Capture itself is covered by another report.

Evidence labels used below:

- **[docs]** — read in the vendor's or project's own documentation or repository during this research.
- **[vendor claim]** — stated on a marketing page or by the author; not independently checked.
- **[unverified]** — from memory, from a third-party article, or inferred; treat as a lead, not a fact.

No tool was installed or run for this report. All performance figures are other people's numbers.

---

## 1. Executive summary — recommended MVP design

**The one design decision everything else follows from:** replay against the real app with its real database, reset to a snapshot taken when recording started. Do not mock the database from recordings. A characterization test exists to protect a refactor, and a refactor is allowed to change the SQL; a recorded-SQL mock breaks exactly then. Resetting the real database also makes auto-increment ids deterministic, which removes the hardest class of noise for free.

| Area | MVP recommendation |
|---|---|
| Unit of replay | One recording session = one **flow file**. Reset DB once, replay all steps sequentially in recorded order, one cookie jar per recorded client. |
| State reset | A user-supplied `reset` shell hook, plus two built-in helpers: Postgres template-database clone and MySQL dump restore. Snapshot is taken by the tool at `record` start. |
| Noise | Three layers: (1) built-in typed scrubbers applied at generation time, (2) a `calibrate` command that resets and replays twice and writes every unstable field into the test file as an explicit rule, (3) user rules (JSONPath, CSS selector, header name, regex) at global / endpoint / step level. |
| Sessions and CSRF | Cookie jar per client (recorded `Cookie` headers are never sent verbatim). Generation-time correlation finds response values that reappear in later requests and emits explicit `capture` + `{{var}}` pairs. |
| Assertions | Status exact; small header allowlist; JSON structural diff; HTML normalised-DOM diff with selector ignores; SQL asserted as **per-table write counts** (hard) and **tables read** (warn only). No assertion on SQL text, order or parameters. |
| SQL normalisation | Lexer-based fingerprinting with a pure-Go library (DataDog `go-sqllexer`), used for the behaviour map and for warn-level diffs, not for pass/fail. |
| Test format | Tool-native YAML flow files plus sidecar body snapshots, executed by the tool's own runner; JUnit XML and a readable diff as output; `--update` to approve changes. |
| Behaviour map | Markdown rendered from a `behaviour.json` model: endpoint index, per-endpoint page, table-by-endpoint CRUD matrix, small Mermaid diagrams, a "findings" list (writes on GET, N+1 patterns). No OpenAPI in the MVP. |
| LLM | Not in the MVP. Keep all artefacts as plain text so an LLM step can be added later as an optional, reviewable suggestion layer. |

What the user must provide: a non-production copy of the app and database, a database account allowed to create/drop databases (Postgres) or restore a dump (MySQL), and — if the app keeps state outside the database — a shell command that cleans it.

---

## 2. Non-determinism ("noise")

### 2.1 How existing tools do it

**Diffy (Twitter, 2015).** Every request is multicast to three instances: candidate (new code), primary (known-good) and secondary (the same known-good build). Primary-vs-secondary disagreement measures noise; primary-vs-candidate measures raw difference. A field is treated as noise when the two disagreement rates are about equal, aggregated over many requests rather than judged per request. The original repository is archived. Mutating verbs (POST/PUT/DELETE) are skipped unless `-allowHttpSideEffects=true` is set, which is the tell that Diffy does not solve state. **[docs]** The maintained `opendiffy` fork could not be fetched in this session; anything about its current features is **[unverified]**.

**Keploy.** Two descriptions exist and they do not fully agree:
- The feature docs say Keploy re-runs a captured request using the captured dependency mocks, compares the responses, and marks fields that differ as noisy. This is the "replay and diff" algorithm. **[docs]**
- A product page describes pattern-based detection at capture time (ISO-8601 timestamps, epoch values, UUIDs, Mongo ObjectIds, JWTs, bearer tokens, and positive integers used as ids), with flagged fields compared by type rather than by value. **[vendor claim]** The "positive integer means id" rule is too broad for our purposes.
- User rules live in `keploy.yml` under `test.globalNoise`, with a `global` scope and a per-test-set scope; each entry maps a body field or header name to a list of regexes, and an empty list ignores the field. `ignoreOrdering` turns off array-order comparison. **[docs]**
- Time freezing (`--freezeTime`) patches Go binaries or injects an `LD_PRELOAD` clock library for Node/Java/Python/Ruby; Linux only, documented under Keploy Cloud/Enterprise. **[docs]**

**Speedscale / proxymock.** Noise is handled by "transform chains": an extractor pulls a token out of a request or response, transforms run in order, and the result is written back. Relevant transforms include `jwt_resign`, `scrub_date`, and `smart_replace_recorded`, which registers a recorded-value → live-value mapping in a session-wide substitution table and then applies it across headers, body and URL of later request/response pairs. The body assertion is JSON-aware with `ignore` / `includeOnly` path lists and an `allowNew` flag (on by default) that tolerates added fields; unknown content types fall back to a hash comparison. **[docs]**

**Tusk Drift.** In-process SDK instrumentation (Node first), so not directly comparable to an outside-in tool. Per the authors: built-in dynamic-field rules for common UUID, timestamp and date formats, custom matching rules in `.tusk/config.yaml`, and recorded `jwt.verify()` results replayed so expired tokens still pass. Deviation classification (intended vs unintended) is a cloud feature that correlates the diff with the pull request. **[vendor claim, from the Show HN thread]**

**Meticulous.** Frontend-only: replays user sessions in a browser and answers network calls from the recording. Matching is sequence-aware (the Nth identical GET gets the Nth recorded response) and keyed on request shape rather than values. It explicitly does not test backend correctness. Useful only as a model for sequence-aware matching. **[docs]**

**Hoverfly.** Service-virtualisation proxy. Stateful capture records repeated identical requests as a sequence using a counter variable (`requiresState` / `transitionsState`). Relevant for mocking outbound HTTP later, not for noise. **[docs]**

**ApprovalTests scrubbers.** A scrubber is a function from string to string applied before comparison. The documented patterns are: replace troublesome text, replace while tracking duplicates, combine scrubbers, delete troublesome lines. **[docs]** "Tracking duplicates" means the first distinct GUID becomes `guid_1`, the second `guid_2`, so that equality relationships survive scrubbing; the exact placeholder naming is **[unverified]** (the same idea exists in Verify for .NET, also from memory).

**GoReplay.** A middleware process receives the original request, the original response and the replayed response, linked by a request id. The canonical example maps a production auth token to the token the test server issued and rewrites later requests. **[docs]**

### 2.2 The algorithms, reduced to their essentials

1. **Type/regex heuristics** — cheap, works on a single recording, false positives on short numeric values.
2. **Replay and diff** — replay the unchanged app from the same state; whatever differs is noise by definition. Needs a working state reset. One extra run catches most noise; a second catches values that happened to collide.
3. **Statistical (Diffy)** — needs live traffic and three deployments. Out of scope.
4. **Consistent placeholders** — replace each distinct dynamic value with a stable token so "the id in the Location header equals the id in the next URL" is still asserted.
5. **Recorded → live substitution** — required for values the client must send back (section 4), not just ignore.
6. **User rules** — always needed as the escape hatch.

### 2.3 Recommendation for the MVP

Three layers, all of which write their result into the test file so a reviewer can see what is not being asserted:

1. **Built-in scrubbers at generation time.** Always-ignored headers (`Date`, `Server`, `Content-Length`, `ETag`, `Last-Modified`, `X-Request-Id`, `Set-Cookie` values). Typed matchers for string values that look like ISO timestamps, UUIDs, JWTs, or long hex/base64 tokens: the replayed value must still match the type. Do **not** auto-ignore integers; with a reset database they are stable.
2. **`calibrate` command.** After generation: reset, replay, reset, replay. Any JSON path, HTML node or header that differs between the recording and either replay becomes an explicit `ignore` or typed-matcher entry in the step. Arrays whose elements match but whose order differs are marked `unordered`. Steps that still fail after calibration are quarantined with a reason instead of silently loosened.
3. **User rules** in the project config: global, per endpoint template, per step. Selectors: JSONPath for JSON, CSS selector (optionally `@attr`) for HTML, header name, and a regex-replace for free text such as "generated in 0.032 s".

Prefer "must still be a UUID" over "ignore". Over-normalisation hides regressions, and the test file should make every loosened field visible in a diff.

Clock-dependent output (relative dates, "valid until" fields) is handled by regex rules in the MVP. A documented `libfaketime`/`LD_PRELOAD` recipe is the cheap next step; building it in is deferred.

---

## 3. State management for replay

### 3.1 Options compared

| Approach | How it works | Fit for an outside-in tool | Cost / caveats |
|---|---|---|---|
| **Mock the DB from recordings** (Keploy, proxymock, Tusk) | A fake server speaks the wire protocol and returns recorded results. Keploy parses Postgres traffic with `pgproto3`; proxymock matches a SQL mock on the statement text, not on bound values. **[docs]** | Poor for refactoring. Any change in query text, order or count is a mock miss. Also the largest engineering item: a faithful MySQL and Postgres server emulation including handshake, TLS and prepared statements. | Fast and hermetic, which is why CI-focused tools choose it. Hides constraint, default-value and transaction behaviour that only a real database shows. |
| **Restore dump before each suite** | `mysql < dump.sql` or `pg_restore`. | Works for every database and every app. | Seconds to minutes depending on size; fine once per flow file, too slow per request. |
| **Postgres template database** | `CREATE DATABASE run TEMPLATE snapshot`. pgtestdb reports roughly 10–20 ms per clone on a RAM-backed server; another author measures about 30 ms. **[author claims]** | Very good. Sequences are copied with the data, so ids repeat. | Requires no open connections to the template and a role with CREATEDB. The app holds a pool to the old database, so connections must be cut and the app must reconnect. Clone time grows with data size. |
| **MySQL equivalents** | No template feature. Options are drop + restore a dump, truncate + reload, or a container with the data directory on tmpfs and init scripts. **[third-party article]** | Workable. Legacy MySQL data sets are often small enough for a dump restore per flow. | Truncation alone does not reset AUTO_INCREMENT on every engine/version combination **[unverified]**; restoring a dump does. |
| **Transaction rollback wrapper** | From outside the app this needs a proxy that funnels all connections into one real transaction and rewrites `BEGIN`/`COMMIT`/`ROLLBACK` to savepoints. `pgrollback` (Go, needs cgo for its SQL parser) does this for Postgres. **[docs, read via a mirror]** | Tempting because the tool already has a DB proxy. | Changes concurrency and isolation semantics, an error aborts the outer transaction, DDL commits implicitly on MySQL, and non-transactional MyISAM tables (common in old PHP apps) cannot be rolled back at all. |
| **Ephemeral containers (Testcontainers style)** | Start a fresh database container with the dump preloaded. | Good for CI, but it is orchestration the user can already do with docker compose. | Seconds per start; ties a single-binary CLI to Docker. |
| **Point-in-time recovery / filesystem snapshots** | Restore point or ZFS/LVM snapshot. | Only worthwhile for very large databases. | Heavy operational setup. |

### 3.2 Recommendation for the MVP

- **Reset granularity: once per flow file**, then replay every step in recorded order. This reproduces the recording exactly, including cross-session dependencies (an admin creates a product, a customer then sees it). Per-request reset is wrong because steps depend on each other; per-flow isolation inside one recording needs dependency analysis and is deferred.
- **Snapshot ownership:** `record` takes the snapshot before proxying begins (`pg_dump` / `mysqldump` via the DSN the proxy already knows) and stores a reference in the flow file. A recording without a matching snapshot cannot be replayed deterministically; say so loudly at record time.
- **Reset mechanism:** a `reset.command` hook is the contract. Ship two helpers that implement it: `reset pg-template` (create the template once from the dump, then drop-with-force and clone per flow) and `reset mysql-dump`. The DB proxy drops the app's connections at reset so pools reconnect.
- **Non-database state** (PHP file sessions, uploads, cache directories, Redis): the same hook. Document typical recipes for PHP and Node.
- **Cheap optimisation that falls out of the recording:** the proxy sees whether a flow performed any write during replay. If it did not, skip the next reset.
- **Encourage short recordings.** One feature per recording session gives small, independent, fast flow files, and avoids the need for dependency analysis.

What the user provides: a resettable non-production database, credentials with create/drop rights, and optionally a clean-up command for files and caches. That is a real adoption cost and should be the first thing the README says.

---

## 4. Sessions, auth and request sequences

### 4.1 Prior art

- **Hurl:** requests in one file run in order and share cookie storage; `[Captures]` extract values by XPath, JSONPath, regex, header or cookie and reuse them as `{{variables}}`. The documentation's own example captures a CSRF token from a `<meta>` tag and sends it in a header on the next POST. Captures can be marked `redact`. **[docs]**
- **Speedscale:** detects sessions automatically for common patterns (the OAuth2 access token becomes the session id) or via a manual `tag_session` chain; `smart_replace_recorded` carries live values forward. **[docs]**
- **GoReplay:** token mapping in middleware, as above. **[docs]**
- **Load-testing tools (JMeter/BlazeMeter correlation recorder):** when a replay fails, the wizard lists values from earlier responses that were used in later requests and offers to generate extractor/replacement rules. The vendor page does not disclose the algorithm. **[docs]** A practitioner article describes the standard approach as diffing recordings to find changing values and then searching backwards for where each first appeared, and notes that it produces false positives needing human review. **[third-party]**
- **Hoverfly / Meticulous:** sequence counters for repeated identical requests (relevant to mocks only).

### 4.2 Recommended model

- **Flow** = ordered list of steps from one recording session. Each step carries a `client` label derived from the recorded session cookie or Authorization value, so interleaved users keep separate jars.
- **Cookies:** every client gets an empty jar at flow start. Recorded `Cookie` request headers are dropped and regenerated from the jar. Assertions check cookie names and attributes, never values.
- **Correlation at generation time** (deterministic, reviewable):
  1. Collect candidate values from each response: `Set-Cookie` values, hidden `<input>` values, `<meta>` content, JSON string/number leaves, ids in `Location`.
  2. Keep candidates that are token-like (length ≥ 8 and mixed characters) or that come from a `Location` header or a JSON key named like an id.
  3. Search later requests of the same client for the exact value in URL path segments, query, headers, form fields and JSON body.
  4. For each hit emit a `capture` on the source step and replace the value with `{{name}}` in the sink step.
- **Fallback at replay time:** if a captured selector matches nothing, fail the step with "capture broken" rather than a confusing downstream 403.
- **Login:** the recording must include the login request, or the config defines a `login` flow that is prepended. Recorded bearer tokens that expire are the main case this does not cover; MVP answer is a config-level header override or a login flow. JWT re-signing is deferred.
- **Secrets:** passwords and tokens in request bodies are replaced by `{{secret.NAME}}` references resolved from environment variables, so flow files can be committed.
- **Failure cascades:** after the first failed step that performed writes, mark later failures in the flow as "possibly consequential" in the report.

---

## 5. What to assert

### 5.1 HTTP

- **Status:** exact.
- **Headers:** allowlist only — `Content-Type` (media type and charset), `Location` (host normalised, variables substituted), cookie names/attributes, `Cache-Control`, `Content-Disposition`. Everything else is recorded for the map but not asserted.
- **JSON bodies:** parse and diff structurally; report by path. Strict by default (an added field is a behaviour change in a golden master). Offer `allow_new: true` per endpoint, which is Speedscale's default behaviour. Arrays ordered unless calibrated otherwise.
- **HTML bodies** (the common case for the target stacks). Byte comparison is useless; text-only comparison loses forms and links. Prior art for a middle path:
  - AngleSharp.Diffing (used by bUnit) ignores insignificant whitespace, attribute order, class order and comments, and supports per-node `diff:ignore`, `diff:ignoreChildren`, `diff:ignoreAttributes` and regex matching on text or attributes. **[docs]**
  - open-wc `semantic-dom-diff` normalises whitespace, removes comments, strips `style`/`script`/SVG contents, prints one tag or attribute per line for readable diffs, and takes `ignoreAttributes` / `ignoreTags` / `ignoreChildren`. **[docs]**

  Recommended pipeline in Go (`golang.org/x/net/html`): parse → drop comments → collapse whitespace in text nodes → sort attributes and class tokens → replace `script`/`style` contents with a hash → strip cache-busting query strings on asset URLs → apply selector ignores and scrubbers → serialise one node per line → line diff. Store the normalised expected output as a sidecar `.html` file so pull-request diffs are readable.
- **Other bodies:** content type plus SHA-256 and length; downgrade to content type only if calibration shows the hash is unstable (PDFs with embedded dates).

### 5.2 Database-level assertions — robust versus brittle

A ladder from weakest to most brittle:

| Level | Assertion | Verdict |
|---|---|---|
| 1 | Set of tables written, with operation (insert/update/delete) | Robust. A refactor that changes this changed behaviour. |
| 2 | Rows affected per table and operation, summed over the request | Robust and still cheap: the count comes from the server's reply on the wire. Survives rewriting ten single-row inserts as one multi-row insert. |
| 3 | Set of tables read | Useful signal, but caching and eager loading change it legitimately. Warn only. |
| 4 | Set of statement fingerprints | Breaks on harmless query rewrites. Warn only, show in the diff. |
| 5 | Fingerprint counts, order, or literal parameters | Brittle. Never assert by default. |
| 6 | Row-level diff of database state after the request | The truest golden master for writes, but needs before/after table snapshots. Deferred. |

**MVP: hard-assert levels 1–2, warn on 3–4.** Two implementation details matter:
- Track transaction state per connection and discard writes that were rolled back.
- Attribute SQL to a request by time window. During replay the runner sends one request at a time, so attribution is exact unless the app has background workers; calibration will surface those as unstable statement sets.

### 5.3 SQL normalisation / fingerprinting

- **pt-fingerprint (Percona Toolkit):** regex-based. Replaces string, number, hex and NULL literals with `?`, collapses `IN()` and `VALUES()` lists to one placeholder, strips comments, collapses whitespace, lowercases, and also abstracts digits inside identifiers so `users_2009` and `users_2010` group together. **[docs]** MySQL-oriented, Perl; reference for the rules rather than a dependency.
- **pg_query fingerprint (libpg_query):** walks the real Postgres parse tree, ignores constants, parameter references, aliases and locations, deduplicates and sorts lists such as target lists and `IN` operands, and hashes the token stream with XXH3. It fingerprints the raw tree, so the result is stable across servers, unlike `pg_stat_statements` query ids. **[docs]** Most accurate for Postgres, but it is a C library: using it from Go means cgo, which complicates a statically linked cross-compiled binary.
- **DataDog `go-sqllexer`:** a hand-written lexer, not a parser, with an obfuscator and a normaliser; pure Go with no external dependencies; dialect flags for MySQL, Postgres, SQL Server, Oracle and Snowflake; the normaliser can return statement metadata (tables, commands, comments) and collapses `IN (?, ?)` to `IN (?)`. **[docs]** Table extraction from a lexer is heuristic around CTEs and subqueries **[unverified, inferred]**.
- **sqlcommenter:** a convention for ORMs to append key/value comments (route, controller, `traceparent`) to statements. The tool cannot add these without code changes, but it must strip comments before fingerprinting, and when an app already emits them they give exact request attribution for free. **[spec not fetched in detail; unverified]**

Recommendation: `go-sqllexer` for the MVP because it keeps the build pure Go and covers both MySQL and Postgres. Keep the fingerprint function behind an interface so a pg_query-based build can replace it later.

---

## 6. Output format for generated tests

| Option | Language-agnostic | CI | PR reviewability | Can express SQL asserts, reset, HTML diff, noise rules |
|---|---|---|---|---|
| **Tool-native YAML + own runner** | Yes | One binary, JUnit XML out | Good if bodies live in sidecar files and key order is stable | Yes |
| **Generated code (PHPUnit / Jest / pytest)** | No — one generator per framework | Fits existing pipelines | Verbose; regenerating overwrites hand edits | Only by calling back into the tool |
| **Hurl files** | Yes | Single binary; JUnit, TAP, HTML, JSON reports | Excellent, plain text | No: no DB reset, no SQL assertions, no normalised HTML diff |
| **Postman / Bruno collections** | Yes | Via their CLIs | JSON collections diff poorly; Bruno's text format is better **[unverified]** | No |

Context: Keploy stores YAML test cases (`kind: Http`, `spec.req`, `spec.resp`) and YAML mocks per dependency **[docs/third-party]**; proxymock stores request/response pairs as editable files **[docs]**. Both chose native declarative files with their own runner. Hurl's feature list (ordered entries, shared cookie store, captures, XPath/JSONPath/regex asserts, variables) is the right mental model for the HTTP half. **[docs]**

**Recommendation: tool-native YAML, own runner.** Reasons: legacy apps frequently have no test framework to generate into; the SQL assertions need the DB proxy in the loop anyway; a solo developer cannot maintain several code generators. Design rules:

- One flow per file, one directory per flow; large or HTML bodies in sidecar files.
- Deterministic serialisation so re-recording produces minimal diffs.
- Everything that is not asserted is visible (`ignore`, typed matchers, `unordered`).
- `replay --update` rewrites expectations after an intended change (approval-testing workflow); `replay --junit out.xml` for CI; non-zero exit on failure.
- Later: `export hurl` for teams that only want the HTTP layer.

Illustrative shape (not a final schema):

```yaml
version: 1
name: login-and-add-to-cart
snapshot: baseline-2026-11-10
steps:
  - id: s1
    client: A
    request: { method: GET, path: /login.php }
    capture:
      csrf: { html: "input[name=csrf_token]", attr: value }
    expect:
      status: 200
      headers: { content-type: "text/html; charset=utf-8" }
      body: { kind: html, file: s1.html, ignore: ["input[name=csrf_token]@value"] }
      sql: { writes: {} }
  - id: s2
    client: A
    request:
      method: POST
      path: /login.php
      form: { user: demo, pass: "{{secret.DEMO_PASS}}", csrf_token: "{{csrf}}" }
    expect:
      status: 302
      headers: { location: /dashboard.php }
      cookies: { PHPSESSID: { set: true } }
      sql:
        writes: { users: { update: 1 } }
        reads: [users]          # warn-only
```

---

## 7. Behaviour map

### 7.1 Prior art and what it teaches

- **AppMap:** in-process agent. Its open data format records `http_server_request` events (method, `path_info`, optional `normalized_path_info` such as `/orders/{id}`) and `sql_query` events (database type, SQL text) in a call tree. **[docs]** Its viewer offers a dependency map, sequence diagrams and a trace view **[unverified, from memory]**. Lesson: the HTTP → SQL link is the valuable part, and it is the part an outside-in tool can also produce.
- **Optic:** captured traffic to create and verify OpenAPI. The repository was archived on 12 January 2026 according to a third-party write-up. **[third-party]** Lesson: do not depend on it.
- **Akita → Postman Insights:** an agent infers endpoints by replacing dynamic path segments with parameters, and lets users correct the inference with per-segment regex rules and exceptions. **[docs]** The Akita lineage is **[unverified, from memory]**. Lesson: path-template inference is never fully right; ship an override mechanism from day one.
- **mitmproxy2swagger:** two passes. The first writes suggested path templates prefixed `ignore:`; the user edits the list; the second pass generates the spec. Accepts HAR files. **[docs via documentation index]** Same lesson, simpler mechanism.
- **traffic2openapi (Go library):** infers `{id}`-style parameters from UUID, numeric, hash, date and slug segments and infers JSON schemas with required/optional tracking. **[docs]** A candidate dependency if OpenAPI output is added later.

### 7.2 What a useful document contains

1. **Header:** what was observed (number of requests, recording dates, flows) and an explicit statement that unobserved behaviour is not listed.
2. **Endpoint index table:** method, path template, sample count, status codes seen, content type, whether a session was required, tables read, tables written, link to the flows that cover it.
3. **Per-endpoint section:** observed query/form/JSON parameters with inferred types and scrubbed examples; responses by status; redirects; cookies set; tables read and written with row counts; top statement fingerprints with counts.
4. **Table → endpoint matrix (CRUD matrix):** for every table, which endpoints create, read, update or delete rows. This is the page people planning a migration or a strangler-fig extraction actually need.
5. **Findings:** GET requests that write; the same fingerprint executed many times in one request (N+1); writes without a session; statements without a `WHERE` clause.
6. **Diagrams:** Mermaid, embedded in the Markdown. One small endpoint → tables graph per endpoint and one per table. A whole-application graph is unreadable beyond a few dozen nodes; the matrix replaces it.

Endpoint templating: numeric, UUID and long-hex segments become parameters; a `routes` section in the config overrides or pins templates (the Postman/mitmproxy2swagger lesson). Old PHP apps often route by query parameter (`index.php?action=...`), so allow a config list of query parameters that are part of the endpoint identity.

### 7.3 Format recommendation

- **MVP:** `behaviour.json` as the model, rendered to Markdown (`BEHAVIOUR.md` plus per-endpoint files) with Mermaid blocks. Markdown lives in the repository, renders on the common Git hosts, and diffs in pull requests, so the map doubles as a change log of behaviour.
- **Deferred:** static HTML report with search and filtering; OpenAPI export for JSON endpoints only (it fits form-posting, HTML-returning apps badly); sequence diagrams per flow.

---

## 8. Where an LLM could add value later

| Use | Value | Risk |
|---|---|---|
| Name flows and steps ("customer logs in and adds an item to the cart") | High for readability, zero effect on pass/fail | Low |
| Summarise what an endpoint does from its parameters, responses and SQL | High for the behaviour map | Plausible but wrong prose; must be labelled as generated |
| Cluster requests into endpoints where path heuristics fail | Medium | Must end up as explicit `routes` config, not a hidden decision |
| Propose noise rules from a failing calibration | Medium | Over-ignoring; proposals must be diffs a human approves |
| Explain a failing diff / classify intended vs unintended change | High; this is what Tusk sells as a cloud feature **[vendor claim]** | Needs the code diff as context; a wrong "intended" verdict is costly |

**Not in the MVP**, for four reasons:
1. A golden master must be deterministic; nothing probabilistic may decide pass/fail or what is ignored.
2. Recorded traffic from legacy systems contains personal data and credentials. Sending it to a hosted model is a blocker for many of the intended users; redaction would have to be solid first.
3. It breaks "single binary, works offline" and adds cost and configuration.
4. Scope: none of the core value depends on it.

Design for it anyway: keep `behaviour.json` and the flow files as plain text, and reserve `name` / `description` fields that are optional and never read by the runner.

---

## 9. Explicitly deferred past MVP

- Mocking the database (or outbound HTTP, mail, queues) from recordings.
- Transaction-rollback proxy mode as a faster reset.
- Per-flow isolation inside one recording via table read/write dependency analysis; parallel replay.
- Built-in clock freezing; JWT re-signing.
- Row-level database state diff after each request.
- Parser-grade SQL analysis (pg_query, a MySQL parser).
- Code generation for PHPUnit/Jest/pytest; Hurl/Postman/Bruno export.
- OpenAPI inference; static HTML report; flow sequence diagrams.
- Statistical (Diffy-style) noise detection on live shadow traffic.
- Any LLM feature.
- Docker/Testcontainers orchestration beyond documented recipes.
- Dead-table detection (needs the schema, not just traffic).

---

## 10. Things not verified in this research

- The current `opendiffy/diffy` repository (fetch blocked); only the archived Twitter repository and the 2015 engineering post were read.
- Which of Keploy's two noise descriptions matches the shipping open-source behaviour, and whether time freezing is available outside paid tiers.
- How Keploy and proxymock match database mocks in detail beyond "statement, not bound values" (proxymock).
- Tusk Drift internals: only the CLI README and the authors' forum answers were read, not `docs/drift/architecture.md`.
- Exact placeholder behaviour of ApprovalTests' and Verify's GUID/date scrubbers.
- AppMap viewer features; the Akita → Postman history; Bruno's file format.
- MySQL AUTO_INCREMENT behaviour under TRUNCATE across engines and versions.
- Accuracy of lexer-based table extraction in `go-sqllexer` on complex statements.
- All timing figures (template clone times, Keploy CI claims).

---

## 11. Sources

Noise and replay tools
- Diffy engineering post: https://blog.x.com/engineering/en_us/a/2015/diffy-testing-services-without-writing-tests
- Diffy archived repository: https://github.com/twitter-archive/diffy
- Keploy features: https://keploy.io/docs/concepts/what-are-keploy-features
- Keploy configuration file: https://keploy.io/docs/running-keploy/configuration-file
- Keploy noise and secrets (product page): https://keploy.io/noise-secret-management
- Keploy time freezing: https://keploy.io/docs/keploy-cloud/time-freezing
- Keploy common errors: https://keploy.io/docs/keploy-explained/common-errors/
- Keploy PostgreSQL support: https://keploy.io/docs/dependencies/postgres.md
- Keploy vs Hurl (vendor comparison): https://keploy.io/compare/hurl
- Keploy vs Tusk (vendor comparison): https://keploy.io/compare/tusk
- Keploy guide (third party): https://qaskills.sh/blog/keploy-api-test-generation-guide
- Speedscale transforms: https://docs.speedscale.com/concepts/transforms
- Speedscale smart_replace_recorded: https://docs.speedscale.com/guides/transformation/transforms/smart_replace_recorded/
- Speedscale sessions: https://docs.speedscale.com/guides/transformation/sessions/
- Speedscale non-idempotent requests: https://docs.speedscale.com/mocks/idempotent
- Speedscale assertions: https://docs.speedscale.com/reference/configuration/assertions/
- Speedscale response body assertion: https://docs.speedscale.com/reference/configuration/assertions/httpresponsebody/
- proxymock Postgres guide: https://docs.speedscale.com/proxymock/guides/postgres/
- Tusk CLI repository: https://github.com/Use-Tusk/tusk-cli
- Tusk Drift Show HN thread (mirror): https://hn.jakechampion.name/item/45887536
- Meticulous network recording: https://app.meticulous.ai/docs/concepts/network-recording-and-patching
- Hoverfly stateful sequences: https://docs.hoverfly.io/en/latest/pages/tutorials/basic/capturingsequences/capturingsequences.html
- ApprovalTests.cpp scrubbers: https://approvaltestscpp.readthedocs.io/en/latest/generated_docs/explanations/Scrubbers.html
- GoReplay middleware: https://github.com/buger/goreplay/wiki/Middleware

State management
- pgtestdb: https://github.com/peterldowns/pgtestdb
- Database test isolation comparison: https://eradman.com/posts/database-test-isolation.html
- pgrollback (mirror): https://gh.r-mj.com/asfixia/pgrollback
- MySQL reset methods (third party): https://oneuptime.com/blog/post/2026-03-31-mysql-reset-database-to-clean-state/view
- Argument against database mocks: https://www.shayon.dev/post/2024/365/database-mocks-are-just-not-worth-it/

Sessions and correlation
- Hurl capturing responses: https://hurl.dev/docs/capturing-response.html
- Hurl repository: https://github.com/Orange-OpenSource/hurl
- BlazeMeter auto-correlation: https://help.blazemeter.com/docs/guide/performance-jmeter-auto-correlation-rules.html
- Correlation practitioner article: https://dev.to/davidcampbelldc/why-ai-correlation-is-harder-than-you-think-and-what-20-years-of-pain-taught-me-16o4

Assertions and SQL
- bUnit semantic HTML comparison: https://bunit.dev/docs/verification/semantic-html-comparison.html
- open-wc semantic-dom-diff: https://open-wc.org/testing/semantic-dom-diff.html
- pt-fingerprint: https://docs.percona.com/percona-toolkit/pt-fingerprint.html
- libpg_query fingerprinting: https://github.com/pganalyze/libpg_query/wiki/Fingerprinting
- DataDog go-sqllexer: https://github.com/DataDog/go-sqllexer
- sqlcommenter specification (not read in detail): https://google.github.io/sqlcommenter/spec/

Behaviour map
- AppMap data specification: https://github.com/applandinc/appmap
- Optic archived (third party): https://dev.to/peter_zsobrk_50d5c4ac7de/optic-is-dead-alternatives-for-openapi-breaking-change-detection-dmp
- Postman Insights customisation: https://learning.postman.com/docs/insights/customize
- mitmproxy2swagger (documentation index): https://docsearch.algolia.com/mcp/docs/repo/alufers/mitmproxy2swagger
- traffic2openapi inference package: https://grokify.github.io/traffic2openapi/go-packages/inference
