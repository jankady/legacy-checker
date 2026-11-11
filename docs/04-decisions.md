# 04 — Decision log

Each entry: the decision, the reason, and what would make us revisit it. New decisions are
appended. An older decision that no longer holds keeps its row and is listed under
"Superseded and amended" at the end.

| # | Date | Decision | Reason | Revisit when |
|---|---|---|---|---|
| D1 | 2026-11-11 | Implementation language is Go; one static binary | Easy to drop next to someone else's system; mature PostgreSQL and MySQL protocol libraries; no verified Node library decodes both protocol directions | Not expected |
| D2 | 2026-11-11 | PostgreSQL is the only database in the MVP | Pilot system is Node.js + PostgreSQL; the protocol is self-describing and has a production-grade decoder; MySQL costs two to three times more | v0.2.0 released; then Phase F |
| D3 | 2026-11-11 | Database proxy relays raw bytes and decodes a copy; decoder errors never affect the relay | The product promise is observation without changing behaviour | TLS termination forces a terminating design |
| D4 | 2026-11-11 | Correlation by serial gate and time window, with a confidence label on every statement | The only approach that needs no application change and also works with connection pools | Users need concurrency; then connection-lifetime rules and optional SQL comment tags |
| D5 | 2026-11-11 | Capture store is SQLite through a pure-Go driver | Correlation is a join; HAR cannot hold SQL and cannot be appended to | Not expected |
| D6 | 2026-11-11 | Replay runs against the real application and the real database, reset from a snapshot; the database is never mocked | A characterization test must survive a refactor that changes SQL; a reset database makes generated ids deterministic | A user group needs hermetic CI without a database |
| D7 | 2026-11-11 | Tests are tool-native YAML flow files run by Trowel's own runner | Legacy apps often have no test framework; SQL assertions need the tap in the loop; one person cannot maintain several code generators | Demand for export to Hurl or a test framework |
| D8 | 2026-11-11 | SQL assertions: tables written and affected rows per table are hard failures; SQL text, order and parameters are never asserted | Write effects are behaviour; query shape is implementation | — |
| D9 | 2026-11-11 | SQL fingerprinting and table extraction use a pure-Go lexer behind an interface | Keeps the binary static and covers two dialects | Amended by D19 |
| D10 | 2026-11-11 | No LLM feature in the MVP; artefacts stay plain text with optional `name` and `description` fields | Pass or fail must be deterministic; recordings contain personal data; offline single binary | Redaction is proven |
| D11 | 2026-11-11 | Open core under Apache-2.0; everything in the MVP scope is open | A tool in the data path needs readable source; portfolio and adoption value | A paid add-on is actually built |
| D12 | 2026-11-11 | The behaviour map ships before the tests | Research: lead with understanding; gives a usable release early | Amended by D21 |
| D13 | 2026-11-11 | Positioning names no stack | MVP supports PostgreSQL only | Superseded by D22 |
| D14 | 2026-11-11 | Work proceeds in strictly sequential steps of comparable size; a step starts only after the previous one meets its definition of done | Keeps the project finishable by one person and every commit releasable | Not expected |
| D15 | 2026-11-11 | Process model: `record`, `calibrate` and `replay` each own both listeners; one runs at a time; mode switch recreates the container; the runner waits for app readiness | Review finding: nothing defined who owns the database port during replay. A long-lived daemon with a control socket was rejected as more moving parts | Mode switches prove too slow or too disruptive in the reality check |
| D16 | 2026-11-11 | The capture store is raw and local; redaction happens at every export boundary with a value dictionary; replay secrets come from the environment or `.trowel/secrets.env` | Review finding: write-time redaction cannot cover the same secret in SQL parameters, breaks value correlation, and the originals would sit in the same file anyway | — |
| D17 | 2026-11-11 | Flows end with a state checksum: per written table, row count and a per-column hash over the multiset of values | Review finding: counts alone do not make "fails when the database ends up different" true, and a competitor already reports count drift. Column-wise hashing needs no primary key and lets calibration ignore single noisy columns | The check is too slow or unstable on real schemas |
| D18 | 2026-11-11 | Snapshots are SQL template clones with logical names, managed by `trowel snapshot`; not dumps as research 03 proposed | No external `pg_dump` binary, milliseconds instead of seconds. Cost: a snapshot is local to a server, so CI seeds and creates its own, and a checksum warns on mismatch | Users need portable snapshots; then add dump export |
| D19 | 2026-11-11 | The SQL analysis library is chosen by a measured spike at the start of step 13 (lexer `go-sqllexer` against parser `go-pgquery`); write targets always come from explicit rules; unsure means `unasserted` | The two research reports disagree and hard failures depend on this part | — |
| D20 | 2026-11-11 | `late` statements never feed hard assertions; they are shown and warned about | Aligns the plan with research 02; a time window is not proof with a pool | — |
| D21 | 2026-11-11 | Two releases: v0.1.0 "Map" (record, inspect, map, packaging, docs, showcase) and v0.2.0 "Protect" (tests) | Review finding: otherwise no finished product exists until the last step. v0.1.0 stands on its own if the project stops | — |
| D22 | 2026-11-11 | Positioning names PostgreSQL in the first sentence; MySQL is Phase F and stays in the open core | A stack-neutral sentence over a PostgreSQL-only tool misleads; MySQL as paid feature would contradict the adoption goal | MySQL ships |
| D23 | 2026-11-11 | Cut from the MVP: normalised HTML diff, per-endpoint pages, Mermaid diagrams, parameter type inference, replay warnings on reads and fingerprints, endpoint-level user rules | Not needed for the differentiation; HTML bodies are marked `unasserted` in flows | After v0.2.0, by demand |
| D24 | 2026-11-11 | A competitor bench runs at step 3 with a stop rule; reality checks on a system we did not write are blocking steps after M1 and before v0.2.0 | Review finding: the kill test and the first contact with a real system were both after launch | — |
| D25 | 2026-11-11 | Each step has a budget of about 6 to 12 focused hours; at twice the budget the step is stopped and split in the roadmap before work continues | Keeps steps comparable in practice, not only on paper | Budgets prove systematically wrong after phase B |
| D26 | 2026-11-11 | No telemetry; no network connections other than the configured upstreams | Trust for a tool in the data path | Not expected |

## Superseded and amended

| Decision | Status | By |
|---|---|---|
| D8 | Extended: reads and fingerprints are no longer warned about during replay; state checksum added | D17, D23 |
| D9 | Amended: library open until the spike | D19 |
| D12 | Amended: the map is not just earlier, it is its own release | D21 |
| D13 | Superseded | D22 |
