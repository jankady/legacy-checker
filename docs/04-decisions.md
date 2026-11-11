# 04 — Decision log

Each entry: the decision, the reason, and what would make us revisit it. New decisions are
appended; old ones are superseded, never edited away.

| # | Date | Decision | Reason | Revisit when |
|---|---|---|---|---|
| D1 | 2026-11-11 | Implementation language is Go; one static binary | Easy to drop next to someone else's system; mature PostgreSQL and MySQL protocol libraries; no verified Node library decodes both protocol directions | Never for the core |
| D2 | 2026-11-11 | PostgreSQL is the only database in the MVP | Pilot system is Node.js + PostgreSQL; the protocol is self-describing and has a production-grade decoder; MySQL costs two to three times more | MVP released; then MySQL `COM_QUERY` first |
| D3 | 2026-11-11 | Database proxy relays raw bytes and decodes a copy; decoder errors never affect the relay | The product promise is observation without changing behaviour | Only if TLS termination forces a terminating design |
| D4 | 2026-11-11 | Correlation by serial gate and time window, with a confidence label on every link | The only approach that needs no application change and also works with connection pools, which Node.js uses | Users need concurrency; then add connection-lifetime rules and optional SQL comment tags |
| D5 | 2026-11-11 | Capture store is SQLite through a pure-Go driver; HAR and JSONL are export formats at most | Correlation is a join; HAR cannot hold SQL and cannot be appended to | Never for the MVP |
| D6 | 2026-11-11 | Replay runs against the real application and the real database, reset from a snapshot; the database is never mocked | A characterization test must survive a refactor that changes SQL; a reset database also makes generated ids deterministic | A user group needs hermetic CI without a database |
| D7 | 2026-11-11 | Tests are tool-native YAML flow files run by Trowel's own runner | Legacy apps often have no test framework; SQL assertions need the tap in the loop; one person cannot maintain several code generators | Demand for export to Hurl or a test framework |
| D8 | 2026-11-11 | SQL assertions: tables written and affected rows per table are hard failures; tables read and statement fingerprints are warnings; SQL text, order and parameters are never asserted | Write effects are behaviour; query shape is implementation | Row-level diff becomes available |
| D9 | 2026-11-11 | SQL fingerprinting and table extraction use a pure-Go lexer behind an interface | Keeps the binary static and covers two dialects; a parser can replace it | Table extraction is wrong on real systems more than rarely |
| D10 | 2026-11-11 | No LLM feature in the MVP; artefacts stay plain text with optional `name` and `description` fields | Pass or fail must be deterministic; recordings contain personal data; offline single binary | Redaction is proven; then optional naming and summaries |
| D11 | 2026-11-11 | Open core under Apache-2.0; everything in the MVP scope is open | A tool in the data path needs readable source; portfolio and adoption value | A paid add-on is actually built |
| D12 | 2026-11-11 | The behaviour map ships before the tests (milestone M1 before M2) | Research: lead with understanding; it is the unoccupied part of the market and gives a usable release early | Never |
| D13 | 2026-11-11 | Positioning names no stack ("the web app you inherited") although research points at PHP + MySQL as the sharpest niche | MVP supports PostgreSQL only; claiming the PHP niche before MySQL works would be untrue | MySQL support ships |
| D14 | 2026-11-11 | Work proceeds in strictly sequential steps of comparable size; a step starts only after the previous one meets its definition of done | Keeps the project finishable by one person and every commit releasable | Never |
