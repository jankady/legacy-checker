# Technical review of the Trowel plan

Reviewed: `docs/01-mvp-scope.md`, `02-architecture.md`, `03-roadmap.md`, `04-decisions.md`,
`research/02-capture-layer.md`, `research/03-replay-and-generation.md`.
Date: 11 November 2026.

Severity: **blocker** = the plan cannot meet its own acceptance criteria or a step cannot be
finished as written; **should-fix** = will cause wrong results or rework, fix before the step
is started; **minor** = wording, small gap.

Two facts were checked against primary sources, everything else is protocol and driver
knowledge that should be confirmed by the tests proposed below:

- PostgreSQL 14 manual, `DROP DATABASE` (https://www.postgresql.org/docs/14/sql-dropdatabase.html):
  `FORCE` does not terminate when prepared transactions, active logical replication slots or
  subscriptions exist; it only terminates sessions the current role may terminate with
  `pg_terminate_backend`; the command needs the database owner and cannot run while connected
  to the target database.
- `pg-connection-string` 2.12.0 README (https://cdn.jsdelivr.net/npm/pg-connection-string@2.12.0/README.md):
  without `uselibpqcompat=true`, `sslmode=prefer`, `require`, `verify-ca` and `verify-full`
  all set `ssl` to true; only `disable` sets it to false.

Findings are numbered once and grouped in the order requested. A proposed step list is in
section 3.

---

## 1. Technical errors and risky assumptions

**1. blocker — 02 §1 (mode table), §5; 03 steps 15, 19 — the process model for `replay` and `calibrate` is undefined.**
What is wrong: the Compose service runs `command: record`. `replay` and `calibrate` also need
the tap in the app's database path, but no document says which process owns the database
port then. `docker compose run trowel replay` does not get the `trowel` network alias or the
published ports by default, so the app cannot reach it. Stopping `record` to start `replay`
closes every pooled app connection. Criterion A4 (generate, calibrate, replay three times)
therefore restarts the tap several times under a running app.
Change: add decision D15 "Process model". Proposed text: each of `record`, `calibrate`,
`replay` owns both listeners for its lifetime; the Compose service command is
`${TROWEL_CMD:-record}`; a mode switch is `docker compose up -d --force-recreate trowel`; a
one-off run is `docker compose run --rm --use-aliases --service-ports trowel replay`. The
runner polls an app readiness URL (config `ready.path`, timeout) before the first step and
after every reset. Add a replay Compose example to 02 §5. Add to the replay step's "Done
when": "replay is started against an app that was already running under `record`; the app
serves without manual action, or replay stops with the documented instruction." Record the
rejected alternative (one long-lived daemon with a control socket).

**2. blocker — 02 §2.8, 01 §7.4, 03 step 17 — the administrative database connection is never specified.**
What is wrong: the tap passes authentication through and "never needs the application's
database password"; research 03 §3.2 assumed "the DSN the proxy already knows". No flag or
config key for an admin connection appears in 02 §5, in `trowel init` or in step 17. Missing
requirements: connect to a maintenance database, not the target; connect to the upstream
directly, not through the tap (otherwise the statements are recorded as `background`);
cloning a database that is not marked as a template needs superuser or the source owner plus
`CREATEDB`; `DROP DATABASE` needs the owner; `FORCE` has the limits quoted above; `FORCE`
exists from PostgreSQL 13.
Change: add `reset.admin_dsn` (env `TROWEL_ADMIN_DSN`) to 02 §2.8 and the §5 example. Reword
01 §7.4: "an admin role that owns the application database (or is superuser) and has
CREATEDB; PostgreSQL 13 or newer". Preflight checks server version, ownership, `CREATEDB`,
and absence of prepared transactions, replication slots and subscriptions. Step 17 "Done
when" adds: a test with a non-superuser owner role (must work) and with a non-owner role
(must print the missing privilege).

**3. blocker — 02 §2.8; 03 step 17 — `CREATE DATABASE … TEMPLATE` and the reset sequence fail or race while anything is connected.**
What is wrong:
- At record start, `CREATE DATABASE snap TEMPLATE app` fails if any session is connected to
  `app`: the app's pool through the tap, a `psql` window, an IDE, a migration tool. In the
  §5 Compose file the app starts before Trowel.
- At reset, between "tap drops connections", `DROP` and `CREATE`, a pool can reconnect. It
  then gets "database does not exist", or its session blocks the `CREATE`.
- A clone does not carry database-level properties: owner (becomes the admin role), database
  grants, `ALTER DATABASE … SET` and `ALTER ROLE … IN DATABASE … SET` (commonly
  `search_path`). After the first reset the app can behave differently from the recording.
Change: write the sequence into 02 §2.8: (1) gate closed; (2) tap enters `paused`: each
client connection is closed once it is at `ReadyForQuery` with status `I`, new client
connections are parked before their `StartupMessage` is forwarded; (3) admin connection:
`DROP DATABASE app WITH (FORCE)`, `CREATE DATABASE app TEMPLATE snap OWNER <recorded owner>`,
re-apply recorded grants and settings; (4) tap resumes; (5) readiness wait. The snapshot uses
the same pause, then `ALTER DATABASE snap ALLOW_CONNECTIONS false`. If sessions outside the
tap exist, the error lists them from `pg_stat_activity`. Step 17 "Done when" adds: a database
with `ALTER DATABASE … SET search_path` and a non-default owner behaves the same after reset;
an open `psql` session on the app database produces an error that names it.

**4. blocker — 02 §2.8 ("pools reconnect"); 03 steps 2, 17 — dropped idle connections crash a typical node-postgres app.**
What is wrong: `pg.Pool` emits `error` for an idle client whose connection dies. Without a
listener Node treats it as an uncaught error and the process exits. Inherited apps often have
no listener, and "zero code changes" forbids adding one. Step 17's check "the demo app
reconnects after reset without a restart" passes only if the demo app has the listener, which
hides the problem. Also: `reset.command` is a shell hook, but a scratch or distroless image
(research 02 §7) has no shell.
Change: step 2: the demo app deliberately has no `pool.on('error')` handler. The Compose
override sets `restart: unless-stopped` on the app. 02 §2.8: the runner waits for readiness
after reset (finding 1). 01 §7 gets a seventh constraint: "the app either survives losing its
database connections or is restarted by its supervisor; Trowel waits for it". 02 §3 states
the image base contains `/bin/sh`, or that hooks need the host binary. Step 17 "Done when"
becomes: "after reset the demo app (no pool error handler, restart policy) serves the next
step; time to ready is printed."

**5. blocker — 02 §2.4 (redaction); 03 steps 9, 13, 14 — redaction at write time conflicts with replay and cannot meet its own check.**
What is wrong:
- (a) Redaction by header and field name does not cover the same secret elsewhere: the
  session token as an SQL parameter (`INSERT INTO sessions`, shown in the flow example in
  02 §2.7), SQL text in the simple protocol, a URL query, an HTML hidden input. Step 9's
  check "do not appear in the store outside the secret table" fails on the demo's own login.
- (b) A token is written by SQL before it appears in `Set-Cookie`, so "before anything is
  written" is impossible without buffering.
- (c) Step 14 needs equal values across a response and a later request; step 13 derives
  client labels from cookie and `Authorization` values. Both only work if placeholders are
  derived from the value and applied everywhere.
- (d) The originals sit in the same SQLite file, so the file is no safer.
- (e) How `{{secret.NAME}}` is resolved at replay is undefined (research 03 §4.2: environment
  variables; 02 §2.4: secret table). How NAME is chosen is undefined.
- (f) Committed sidecar bodies and examples in `behaviour.json` contain personal data and
  literal tokens.
Change: add decision D16: the capture store is raw and local; redaction is applied at every
export boundary (`inspect`, `map`, `generate`) with a value dictionary (find secrets by
header and field rules, then replace the exact value in every exported string, including SQL
text and parameters). Delete "runs before anything is written" from 02 §2.4. `generate`
writes `.trowel/secrets.env` (git-ignored); replay resolves `{{secret.NAME}}` from
`TROWEL_SECRET_NAME`, then from that file, and fails with the list of missing names. Sidecar
files store a placeholder for every captured or typed value. Step 9 check becomes: "no secret
value of the demo recording occurs in `inspect` output, `trowel/behaviour/**` or
`trowel/flows/**` (grep test in CI)". 01 §7.6 adds: "flow files contain response data from
the recorded database".

**6. should-fix — 02 §2.2, §2.8 (SQL writes row); D8; 03 step 18 — a `CommandComplete` tag does not give "rows per table and operation" in common cases.**
What is wrong: there is one tag per statement.
- Data-modifying CTE: the tag belongs to the outer statement only
  (`WITH i AS (INSERT …) SELECT …` reports `SELECT n`); the CTE's row count is not on the wire.
- `INSERT … ON CONFLICT DO UPDATE` reports `INSERT 0 n` for inserted plus updated rows;
  `MERGE n` mixes operations.
- `CREATE TABLE AS` and `SELECT INTO` report `SELECT n`; `TRUNCATE` has no count.
- Zero-row writes: `UPDATE 0` followed by `INSERT 1` versus one upsert is a harmless refactor
  and must pass.
- Functions, `CALL`, triggers and cascades write without a matching tag (already out of
  scope, but the step then looks fully asserted when it is not).
Change: 02 §2.8: operation vocabulary `insert | update | delete | upsert | merge | truncate |
copy | unknown`; entries with count 0 are removed before comparison; a statement with CTE
writes asserts table and operation, count not compared; a write statement with
`parse_ok=false`, kind `unknown` or `call` makes the step's SQL block
`unasserted: <reason>` in the flow file. Add every case above to step 18 "Done when" and to
the step 10 corpus.

**7. should-fix — 02 §2.2 (`rolled_back`); 03 step 7 — "transaction that ends in ROLLBACK" is incomplete.**
What is wrong: missing cases are `ROLLBACK TO SAVEPOINT` (used by Sequelize, TypeORM and Knex
for nested transactions); `COMMIT` in a failed transaction, which returns the tag `ROLLBACK`;
the implicit transaction (an error in a multi-statement `Query`, or in an extended batch
before `Sync`, undoes the earlier statements of that batch); a connection closed inside a
transaction. The flag is only known at transaction end, so earlier rows must be updated,
possibly after their window closed. node-postgres sends `BEGIN` and `COMMIT` with the simple
protocol, so this is not an "extended protocol" topic.
Change: make transaction tracking its own step for both protocols (section 3). Rules: end of
transaction from the tag plus `ReadyForQuery` status; a savepoint stack; the implicit-batch
rule; disconnect counts as rollback. "Done when" lists these four cases.

**8. should-fix — 02 §2.2 (decoder) — the concurrency and timestamp model is missing.**
What is wrong:
- A decoder that reads through `io.Pipe` or `TeeReader` blocks the relay when it is slow or
  stuck. That is not fail-open.
- Two directions decoded independently: a server reply can be decoded before the client
  message is in the FIFO.
- `started_ns` taken when the decoder runs, not when the bytes arrive, puts statements into
  the wrong window.
- `pgproto3` message fields point into a reused buffer and are valid only until the next
  `Receive`.
- Not specified: portal map (`Bind` portal to statement), `PortalSuspended` (cursors, fetch
  size), skip-to-`Sync` after an error, adding to the statement map only on `ParseComplete`,
  `DEALLOCATE` and `DISCARD ALL`, and which SQL text each `CommandComplete` of a
  multi-statement `Query` gets.
Change: add to 02 §2.2: the relay goroutine frames messages itself (type byte plus length),
stamps each frame with the monotonic time and a per-connection sequence number, and puts it
on a bounded queue; overflow marks the connection `undecoded` and never blocks. One decoder
goroutine per connection consumes both directions in sequence order and uses `pgproto3` only
to decode message bodies; strings are copied. Multi-statement text is split with the lexer;
if the segment count differs from the `CommandComplete` count, the whole text is stored with
`parse_ok=false`. Steps 6 and 7 "Done when" add: with an artificially blocked decoder the
relayed session keeps its throughput and the connection is `undecoded`.

**9. should-fix — 02 §2.1 (gate), §2.3 (labels); D4 — `exclusive` is not proof when the app uses a pool.**
What is wrong:
- (a) Timers inside the Node process (session-store pruning, job-queue polling, `setInterval`
  jobs) cannot be stopped without a code change. They fire inside request windows, get
  `exclusive`, and feed hard assertions.
- (b) Work after the response that starts later than 50 ms (it first awaits mail or an HTTP
  call) lands in the next request's window as `exclusive`.
- (c) Connection set-up statements (`SET`, catalogue and type look-ups by ORMs) are attributed
  to whichever request opens a pool connection. After each reset the first steps differ from
  the recording.
- "Idle" is not defined.
Change: 02 §2.1: idle means every tap connection has an empty pending FIFO and transaction
status `I`, and no client frame arrived during the quiet period; a window starts when the
request passes the gate, not when it arrives. 02 §2.3 adds rules: a fingerprint seen at least
once as `background` in the session is downgraded to `ambiguous` inside windows; a statement
on a connection whose transaction was open before the window started is `ambiguous`; `SET`,
`SHOW` and catalogue-only statements get `kind=session` and are excluded from the map and
from assertions. Step 2 adds an env-enabled interval job and a write after the response.
Step 8 "Done when" adds: both are not high-confidence and are absent from generated
`sql.writes`; the summary prints a histogram of statement delay after the response (this is
research 02 spike item 3, which is not scheduled anywhere).

**10. should-fix — 02 §2.8, §7 ("skip reset after flows without writes"); 03 step 17 — the optimisation is wrong.**
What is wrong: a rolled-back insert and `nextval()` advance sequences; a `SELECT` can call a
writing function; the reset hook also covers non-database state. Skipping the reset then
shifts generated ids in the next flow.
Change: delete the optimisation from 02 §2.8, the §7 risk row and step 17.

**11. should-fix — 02 §2.8 (snapshot); 01 §4 step 5 — the snapshot is not portable and accumulates.**
What is wrong: flow files are committed, but `trowel_snap_…` exists only in the developer's
local server. A colleague or CI cannot replay, although 01 §4 promises CI use. Every
recording adds a full copy of the database; nothing removes them.
Change: `snapshot:` becomes a logical name. Add `trowel snapshot create | list | drop`
(create clones the current application database). CI recipe: seed, `trowel snapshot create
baseline`, replay. The flow stores a checksum of schema and per-table row counts; replay
warns on mismatch; `record` reuses a snapshot with a matching checksum.

**12. should-fix — 02 §2.7, §2.8; 03 step 15 — replay HTTP details that decide fidelity are unspecified.**
What is wrong: `Host` (the flow holds only `path`; the app builds redirects and cookie
domains from it); cookie jar origin and `Secure` cookies; redirects (Go's client follows them,
the recording has each hop as a step); the headers the app saw behind the proxy
(`Accept-Encoding: identity`, forwarding headers); window and quiet period per step; request
bodies above the 1 MiB cap cannot be replayed.
Change: 02 §2.7: top-level `origin:` with the recorded scheme and host; the runner builds
URLs from it and dials the upstream through `Transport.DialContext`; `CheckRedirect` returns
`http.ErrUseLastResponse`; `record` stores the request as sent to the app; the runner uses
the same window code as the gate, including the quiet period; request bodies have their own
limit (for example 32 MiB) and a step with a truncated request body is generated as
`skip: body-truncated`. Step 15 "Done when" adds: a 302 step asserts 302; a late write of
step N is not attributed to step N+1.

**13. should-fix — 02 §2.7 (client labels); 03 step 13 — session-id rotation at login splits one browser into two clients.**
What is wrong: the second client starts with an empty jar, so replay breaks right after login.
Change: client identity follows cookie lineage (a request belongs to the client whose earlier
response set a cookie it sends; without cookies, remote address plus `User-Agent`). Step 13
"Done when" adds: "a login that rotates the session cookie stays client A".

**14. should-fix — 02 §2.8 (calibrate); 03 step 19 — calibrate treats systematic replay errors as noise.**
What is wrong: "whatever differs between the recording and either replay becomes a rule".
If recording ≠ replay 1 = replay 2 (wrong snapshot, wrong `Host`), calibrate ignores real
fields, for example every id, and the test asserts nothing.
Change: replay 1 ≠ replay 2 gives a typed matcher, `ignore` or `unordered`. Recording ≠
replay 1 = replay 2 is reported as "systematic difference" and the step is quarantined unless
`--accept-baseline` rewrites the expectation to the replay value. A status or SQL-write
difference always quarantines. Step 19 "Done when" adds: with a wrong snapshot calibrate
fails and adds no rule.

**15. should-fix — 02 §2.5; D9; 03 step 10 — lexer-based table extraction is the least proven part and hard failures depend on it.**
What is wrong: typical lexer errors are CTE names reported as tables; `EXTRACT(… FROM …)`,
`SUBSTRING(… FROM …)`, `IS DISTINCT FROM`; comma joins; `UPDATE … FROM`, `DELETE … USING`;
quoted, mixed-case and schema-qualified identifiers (ORMs quote everything); functions in
`FROM`; `EXCLUDED`; SQL-level `PREPARE`/`EXECUTE`. The lexer's metadata is a flat table list,
not read versus written.
Change: before step 10, a spike of at most two days recorded in 04: run `go-sqllexer` and
`wasilibs/go-pgquery` on the corpus plus samples from Sequelize, Knex and Prisma; record
accuracy, binary size and latency (research 02 spike item 5). Whichever wins, write targets
come from explicit rules anchored on `INSERT INTO`, `UPDATE [ONLY]`, `DELETE FROM`,
`MERGE INTO`, `TRUNCATE`, `COPY … FROM`; identifiers are normalised (fold unquoted names,
strip quotes, drop the default schema). The corpus contains every case listed here.

**16. should-fix — 02 §5 (Compose, preflight); 03 steps 5, 9 — start order and TLS diagnostics.**
What is wrong:
- `trowel: depends_on: [app, db]` while the app uses Trowel as its database host: the app
  starts first and its first connection fails.
- "set `sslmode=prefer`" is wrong for node-postgres, the MVP's primary driver: `prefer` turns
  TLS on (see the checked fact above) and the client stops when the proxy answers `N`.
- A client that requires TLS can only be seen at run time in the tap, not in a start-up
  preflight.
Change: `trowel: depends_on: [db]`, `app: depends_on: [trowel]`; the HTTP upstream check
retries. Messages per driver: node-postgres "remove `ssl` or use `sslmode=disable`"; libpq
"use `sslmode=prefer` or `disable`". Move the TLS-only-client test from step 9 to step 5 and
run it with node-postgres. Preflight instead probes the upstream for a server that demands
TLS.

**17. should-fix — 02 §2.4 (store); 03 step 3 — writer model and schema gaps.**
What is wrong: many goroutines write one SQLite file; without a single writer this gives
"database is locked", and synchronous inserts slow the relay. The schema cannot store a
`background` statement (a `link` needs an exchange), has no `secret` table, and has no way
to mark replay sessions or map an exchange to a flow step ("replay statements stored per
step"). "One file per session" contradicts the `session` table.
Change: step 3 adds one writer goroutine with batched transactions and WAL mode; `label`
moves to `statement` or `link.exchange_id` becomes nullable; add `session.kind` and
`exchange.step_id`; state whether a file holds one or several sessions.

**18. minor — 02 §2.2 — `result_sha256` has no consumer.** D8 excludes it from assertions, the
map does not use it, and row order without `ORDER BY` is unstable. Change: remove it from the
MVP schema and step 6, or name the feature that reads it.

**19. minor — 02 §2.1 — nested self-calls.** An app that calls its own URL through the proxy
blocks until the gate timeout. Research 02 §5.1 lists detection. Change: add the rule (a
request arriving while the gate is held from the app's address passes and is attributed to
the outer exchange) or list it under limitations.

**20. minor — 03 step 5; 01 §7 — PostgreSQL version range.** Step 5 tests 14 and 17; research
02 asks for 13–18 and names protocol 3.2. Change: test the minimum supported version and the
newest release; state the minimum in 01 §7.

**21. minor — 02 §3 — missing choices.** No line-diff implementation is named (HTML diff,
console diff). "The common JUnit schema" is not identified. Change: add both to the
technology table, with the validator used in CI.

**22. minor — 01 §6/§7 — flows age.** Snapshot rows with dates (expiry, "last 24 hours") make
a flow fail weeks later; clock freezing is out of scope. Change: add to the limitations page
and to 01 §7.

---

## 2. Contradictions

**23. should-fix — 02 §2.3 versus research 02 §5.2, 01 A2 and 02 §7 — the `late` label.**
02 §2.3 uses `late` links for tests. Research 02 says tests use only `tagged`, `exclusive`
and `exclusive-conn`. A2 lists `late` apart from "high-confidence". 02 §7 says "tests use
high-confidence links only". Change: `late` becomes "warn only", emitted as
`sql.late_writes`, never a hard failure.

**24. should-fix — 02 §2.8 versus research 03 §3.2 — snapshot mechanism.** The research
proposes a dump (portable; template created from the dump); the architecture clones with SQL
only. No decision records the change or its cost (finding 11). Change: add the decision.

**25. should-fix — D9 versus research 02 §4 and research 03 §5.3 — SQL analysis.** Research 02
recommends `go-pgquery` for analysis and a lexer only for capture-time classification.
Research 03 recommends `go-sqllexer` for fingerprints and marks lexer table extraction as
unverified. D9 mentions neither. Change: amend D9 after the spike in finding 15.

**26. should-fix — 03 step 13 versus step 19 — who handles timestamps and UUIDs.** Step 13
applies typed scrubbers for ISO timestamps and UUIDs at generation. Step 19 then expects
calibration to add "rules for the timestamp and UUID endpoint and nothing else", which
cannot happen. Change: step 2 adds noise the scrubbers cannot type (epoch-milliseconds
number, random numeric nonce, "rendered in N ms" in HTML); step 19 names those.

**27. should-fix — 03 rule 3 versus steps 4–7 and 15.** Rule 3: nothing half-finished is
reachable from the CLI. Step 15 ships `replay` that ignores the `body` and `sql` blocks
already present in flow files and has no reset. Steps 4–7 have no CLI entry at all, yet their
checks run the demo app through the proxy. Change: see findings 33, 36 and 37.

**28. minor — 02 §1 versus 03 — command count.** "Five commands" versus `version`, `inspect`,
`init` in the roadmap (eight; nine with `snapshot`). `inspect` and `init` are not in 01 §5,
which rule 4 requires. Change: update 02 §1 and the feature table.

**29. minor — 01 §11 — pilot timing.** Pilot facts are needed "by step 8", permission "by
step 24". Change: permission is needed by the pilot checkpoint (finding 34).

**30. minor — 02 §2.2 — "must never see different bytes because of Trowel".** The HTTP side
sets `Accept-Encoding: identity` and reset closes connections. Change: limit the sentence to
the database relay.

---

## 3. Step sizing

Estimates are production lines of Go (my judgement). Target: 300–600.

| Step | Estimate | Verdict | Proposal |
|---|---|---|---|
| 1 Scaffold | ~250 | small, acceptable | Add Dockerfile and unit tests on macOS and Windows runners |
| 2 Demo app | ~500 (JS, SQL) | at the limit | Keep; add the items from findings 4, 9, 26; `expected.yaml` |
| 3 Store | ~500 | fits | Finding 17 |
| 4 HTTP recorder | ~350 | fits | Add experimental `record`, Compose override, CI harness |
| 5 Relay | ~350 | fits | Add preflight of upstreams |
| 6 Simple protocol | ~350 | fits | Add framing and queue (finding 8) |
| 7 Extended protocol | ~800 | **too big** | Split: 7a protocol core; 7b transactions, savepoints, `COPY`, binary parameters |
| 8 Gate, correlation, `record` | ~750, three concerns | **too big** | Split: 8a gate and idle signal; 8b correlator, labels, summary |
| 9 Redaction, preflight, `inspect` | ~700, three unrelated concerns | **too big** | Split: redaction dictionary with `inspect` (early); preflight joins the relay step |
| 10 SQL analysis | ~600, highest risk | **too big** | Split: 10a spike, fingerprint, kind, write targets; 10b reads, CTE and subquery rules, session statements |
| 11 Endpoint model | ~750 | **too big** | Split: 11a templating, routes, basic aggregation; 11b parameters, session requirement, findings |
| 12 Map | ~450 | fits | — |
| 13 Flow format, `generate` | ~850 | **too big** | Split: 13a schema, loader, deterministic writer; 13b generator |
| 14 Value correlation | ~550 | fits | — |
| 15 Runner | ~800 | **too big** | Split: 15a HTTP runner; 15b tap wiring and step windows |
| 16 Body assertions | ~950 | **too big** | Split: 16a JSON path, JSON diff, matchers; 16b HTML and other bodies |
| 17 Snapshot, reset | ~450, dense | fits | Remove skip-reset; add `snapshot` command |
| 18 SQL assertions | ~400 | fits | — |
| 19 Calibrate | ~700 | **too big** | Split: 19a calibrate; 19b user rules (global, endpoint, step) |
| 20 Reporting, `--update` | ~650 | slightly big | Split: 20a console, JUnit, exit codes; 20b `--update` |
| 21 End-to-end | tests | fits | Harness moves to step 4; this step keeps the regressions |
| 22 Packaging | ~250 plus config | small | Release pipeline moves before M1; `init` stays |
| 23 Docs, 24 Pilot | — | fit | Pilot gets an earlier checkpoint |

**31. should-fix — 03 (whole) — proposed sequence, 35 steps, strict order.** Each line gives
the main verifiable check.

1. Scaffold, CI, Dockerfile — `trowel version`; image builds in CI.
2. Demo app, `expected.yaml` — scenario passes in CI.
3. Capture store — round trip per table; concurrent-writer test.
4. HTTP recorder, experimental `record`, Compose override, CI harness — scenario through the
   proxy gives one exchange per request.
5. Redaction dictionary, `inspect` — golden `inspect` output without secret values.
6. PostgreSQL relay, start-up diagnostics, preflight — existing step 5 checks plus TLS-only
   node-postgres client.
7. Decoder: framing, queue, simple protocol — existing step 6 checks plus blocked-decoder test.
8. Decoder: extended protocol core — named and unnamed statements, pipeline, error to `Sync`.
9. Decoder: transactions, savepoints, `COPY`, binary parameters — four cases of finding 7.
10. Serial gate and idle signal — two concurrent requests are serialised; bypass; timeout.
11. Correlator, labels, `record` final — every label; counts match `expected.yaml`.
12. Release pipeline (snapshot builds, image).
13. SQL analysis I: spike, fingerprint, kind, write targets — write-target corpus golden.
14. SQL analysis II: reads, CTE and subquery rules, session statements — full corpus golden.
15. Endpoint model I — `behaviour.json` golden; tables match `expected.yaml`.
16. Endpoint model II — one test per finding.
17. Map renderer, `map` — **M1**; A1–A3 checked by the harness.
18. Pilot checkpoint: record and map on the pilot or a stand-in open-source Node.js +
    PostgreSQL app — report committed; decisions on D9, reset and TLS updated.
19. Assertions I: JSON path, JSON diff, matchers.
20. Assertions II: HTML normaliser and diff, other bodies.
21. Flow schema, loader, deterministic writer — round trip is byte-identical.
22. `generate` — golden demo flow.
23. Value correlation and captures.
24. Snapshot, reset, `snapshot` command — scenario, reset, scenario gives identical ids.
25. Runner I: HTTP, status, header and body assertions — seeded wrong status and wrong JSON
    field fail at the right step.
26. Runner II: tap wiring, step windows — statements stored per step.
27. SQL assertions.
28. `calibrate`.
29. User rules.
30. Reporting: console, JUnit, exit codes.
31. `--update` — **M2**.
32. Seeded regressions, A4 and A5.
33. `trowel init`, release final (A6).
34. Documentation, launch — **M3**.
35. Pilot II: generate and replay (A8).

---

## 4. Ordering and missing dependencies

**32. blocker — 03 steps 4–8, 12, 22 — M1 is a "public alpha" before any image or binary exists.**
What is wrong: the user journey is Compose with `ghcr.io/OWNER/trowel`, but the Dockerfile,
the image and the binaries are built in step 22. Step 12 claims A1, whose Compose override is
written in step 22, and A2 and A3, whose end-to-end harness is step 21. The checks of steps
4–8 already need the demo app in Compose with Trowel in between.
Change: Dockerfile in step 1; Compose override and CI harness in step 4; release pipeline
before M1 (sequence above, steps 1, 4, 12).

**33. blocker — 03 steps 4–7 — no entry point to run what the checks describe.** `record`
arrives in step 8, yet step 4 requires "the demo app is fully usable through the proxy".
Change: create `trowel record` in step 4 (HTTP only, marked experimental in help), extend it
in each capture step, remove the mark in the correlator step.

**34. should-fix — 03 step 24 — the first contact with a real system comes after the public release.**
What is wrong: the largest unknowns (ORM-generated SQL, pool behaviour at reset, in-process
timers, TLS) are tested only after 23 steps.
Change: add the pilot checkpoint after M1 (sequence step 18) as a blocking step.

**35. should-fix — 03 step 8 — check depends on step 10.** "Attributes every statement as
listed in `EXPECTED.md`" needs tables, which SQL analysis produces two steps later; a
Markdown file is not machine-checkable. Change: step 2 writes `expected.yaml` with statement
count and SQL prefix per scenario request (used in the correlator step) and tables per
endpoint (used from SQL analysis on); `EXPECTED.md` is rendered from it.

**36. should-fix — 03 step 13 — depends on step 16.** Research 03 §5.1 stores HTML sidecars in
normalised form; typed matchers and JSON paths are emitted in step 13 and first implemented
in step 16. The minimal JSON path implementation (02 §3) is assigned to no step. Change:
assertion primitives come before flow generation (sequence steps 19–22).

**37. should-fix — 03 steps 15, 17 — runner before reset.** Step 15 has to re-seed by hand to
pass. Change: reset before the runner; its check needs no runner (sequence step 24).

**38. should-fix — 03 step 9 — redaction after four steps that already write.** Change: with
D16, redaction and `inspect` come directly after the HTTP recorder; `inspect` is then
available as a debugging tool for the decoder steps.

---

## 5. Missing steps and missing "Done when" checks

**39. should-fix — things the documents require that no step builds.**
- `covering flows` in `behaviour.json` (02 §2.6): the map is built before flows exist and is
  never regenerated. Drop the field or add it to the `generate` step.
- `map` over several recordings: 01 §4 has one feature per recording, no merge rule exists.
  Add to the endpoint model step: "the map of two recordings equals their union".
- Minimal JSON path; line diff; readiness wait; snapshot clean-up (findings 1, 11, 21, 36).
- Body assertions wired into `replay`: step 16's checks are unit tests only.
- A6 builds for macOS and Windows but nothing runs there. Add unit tests on both runners and
  decide how `reset.command` runs on Windows.

**40. should-fix — missing "Done when" lines, by current step number.**
- Step 3: 20 goroutines write concurrently without a lock error.
- Step 4: a request body above the cap is stored up to the request limit; a client abort
  closes the exchange.
- Step 6: multi-statement `Query` with an error in the second statement; empty query.
- Step 7: cursor with a row limit (`PortalSuspended`) gives one statement row.
- Step 10: corpus includes quoted mixed-case identifiers, `EXTRACT(… FROM …)`, upsert,
  `MERGE`, CTE write, `UPDATE … FROM`, comma join.
- Step 13: a step with an `ambiguous` statement is generated with `sql: unasserted`; no
  static-asset exchange becomes a step.
- Step 15: missing secret fails before the first request with the list of names.
- Step 16: demo flow replays with body assertions on; a changed JSON field fails at the
  right step.
- Step 17: findings 2, 3 and 4.
- Step 18: upsert, zero-row write, CTE write, unanalysable write statement.
- Step 19: findings 14 and 26; calibrate keeps hand-written comments in `flow.yaml` or the
  documentation says it does not.
- Step 20: names the JUnit schema.
- Step 21: regressions are env switches in the demo app, not patch files that go stale.

**41. minor — 03 step 2 — "`EXPECTED.md` is reviewed against the source" is not verifiable in CI.**
Change: replace with "`expected.yaml` is validated by the harness from the correlator step on".
