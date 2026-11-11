# Trowel MVP plan — independent product review

Reviewed on 11 November 2026: `README.md`, `docs/01-mvp-scope.md`, `docs/03-roadmap.md`,
`docs/04-decisions.md`, `docs/research/01-competitive-landscape.md`; skimmed
`docs/02-architecture.md` and the two technical research reports for constraints.
No new web research. Findings are ordered most severe first. Where I name third-party
facts that are not in the research reports (candidate showcase apps), they are marked
"verify".

Severity: **blocker** = change the plan before step 1 (or before the step named);
**should-fix** = change before the milestone named; **minor** = cheap correction.

---

## Blockers

### 1. Blocker — the signature claim is not true for what the MVP builds

**Where:** `README.md` blockquote and "Why"; `01-mvp-scope.md` §2, §3 (row "Database"),
§5 F10, §6 (row "Row-level diff"), §8 A5, §9; `04-decisions.md` D8.

**What is wrong.** The README promises "golden-master tests that fail when the database
ends up different". F10 and D8 assert only *tables written and affected-row counts*, read
from `CommandComplete` tags on the wire. SQL parameters are explicitly never asserted. So a
regression that writes the wrong price, updates the wrong row, or changes what a trigger
does passes with a green result. That is the exact false negative a buyer of "database
truth" expects to be caught. The five seeded regressions in A5 conspicuously omit this case
(status, JSON field, HTML, missing write, extra write — no "same row count, different
value").

It also weakens the differentiation more than the plan admits. Research 01 §3(a) says
Speedscale's SQL compare already reports "new, removed and changed statements, count drift"
and that the way to differ from proxymock is to "assert on **state** (rows changed) rather
than statement text". The plan defers exactly that and labels it "first paid-tier
candidate". What is left against the closest competitor is a difference of degree
(per-request write counts against the real database) rather than of category. The scope
table's description of competitors ("Record SQL in order to mock the database away") leaves
the Speedscale feature out.

**Exact change — pick one and apply it everywhere:**

- (a) Recommended. Add one step after step 18, "End-of-flow state checksum": after the last
  step of a flow, compute an order-independent checksum per column for every table the flow
  wrote to (one aggregate query per table through the role that already performs the
  reset); `calibrate` marks columns that differ between its two replays as unstable; a
  differing stable column is a hard failure reported as `table.column`. This is valid
  precisely under the constraints the MVP already imposes (serial, resettable, small data)
  and research 02 §6 costs a naive snapshot diff at about a week. Add a sixth seeded
  regression to A5: "same tables and row counts, different written value". Change §6 row
  "Row-level diff" to "Per-row diff with before/after values" and remove "first paid-tier
  candidate" from it. Pay for the step with the cuts in finding 6.
- (b) If (a) is rejected: replace "fail when the database ends up different" in the README
  and §2 with "fail when a request stops writing to the same tables with the same row
  counts"; add to §7 a constraint "Changed values with unchanged row counts are not
  detected"; rewrite the §3 "Database" row to say "asserts on tables written and row counts;
  Speedscale compares statement text and counts between two recordings without a real
  database".

### 2. Blocker — the only test that can invalidate the plan is scheduled after the build

**Where:** `03-roadmap.md` "Validation to run alongside the build" (second bullet);
`01-mvp-scope.md` §3 table (rows "Understanding" and "Setup").

**What is wrong.** Research 01 §5 lists "run Keploy and proxymock against a sample app" under
"Cheap validation **before building much**" with an explicit consequence: "If either works
cleanly, narrow the scope". The roadmap moves it to "Before M3", declares it non-blocking,
and reduces its purpose to "feeds the comparison page".

The move to Node.js + PostgreSQL makes this test more important, not less. The research's
"old stacks are poorly served" finding is about PHP 5/7 on old kernels without Docker. On
the MVP's actual target the competitors are at their strongest: Keploy handles Postgres
under Docker, Tusk Drift instruments Node.js and `pg`, AppMap has a Node.js agent, proxymock
lists Node.js and Postgres. The MVP's own user journey starts with Docker Compose, so the
"no eBPF with kernel and platform limits" argument does not apply to its primary user.
Two of the three "unoccupied" points in §3 were therefore found unoccupied for a different
stack. In addition, research 01 §7 states that whether proxymock attributes SQL to the
inbound endpoint was *not confirmed*; if it does, the map differentiator shrinks too. §3
presents all three points as research findings without these caveats.

**Exact change.**

- Insert "Step 2a — Competitor bench" after step 2, time-boxed to two working days: run
  Keploy, proxymock, AppMap (Node.js agent) and Tusk Drift against `legacy-shop`; record for
  each whether it (i) yields a per-endpoint table view, (ii) detects the missing-write and
  changed-value regressions, (iii) needs a code change, (iv) is free in CI. Commit as
  `docs/research/04-competitor-bench.md`. Done when §3 of the scope is rewritten from the
  results.
- Write the decision rule into the step before running it: "If any tool gives (i) and (ii)
  with no code change, Phase D is reduced to the state checksum and the map becomes the whole
  product."
- In §3, replace the "Setup" row for now with: "Network-level; one Compose service, no agent
  inside the app. On Dockerised Node.js this is a convenience, not a capability gap; it
  becomes a capability gap on stacks without agents (PHP, .NET) and hosts without eBPF."
- Remove the roadmap bullet "Before M3: run Keploy and Speedscale proxymock…".

### 3. Blocker — the pilot is last, has no pass threshold, and its precondition is unasked

**Where:** `03-roadmap.md` step 24 and milestone list; `01-mvp-scope.md` §8 A8, §11
(questions 2 and 3); `04-decisions.md` D2.

**What is wrong.**

- v0.1.0 is launched publicly (step 23) before Trowel has ever run against anything other
  than a demo app written by its own author to be recordable. Strangers find the first
  real-world failures on launch day, which is the one day attention is available.
- A8 passes if *a* map exists and issues are filed. It passes with a largely wrong map and
  with generate/calibrate/replay never having worked on a real system. A "finished product"
  can be declared with its second half validated only on the demo.
- D2 justifies PostgreSQL-first with "pilot system is Node.js + PostgreSQL", but permission
  to use that system is an open question "needed by step 24", and the feasibility questions
  (TLS to the database, PgBouncer, background workers) are "needed by step 8". If the answer
  is no, the plan learns it after the decision it was meant to justify.
- Step 24 requires the pilot report to contain no data from the system. Correct, but it
  means the pilot produces no public evidence. Nothing in the plan replaces it; the public
  showcase is an optional bullet under "Validation".
- The research's showcase candidates (old WordPress, osCommerce, CodeIgniter) are all MySQL
  and cannot be recorded by the MVP. The roadmap copies the idea without naming an app that
  the MVP can actually handle.
- Not covered at all: who owns a tool developed around an employer's system, and whether the
  work may use employer time or code.

**Exact change.**

- §11: change "Needed by" for questions 2 and 3 to "Before step 1". Add a question: "Written
  confirmation from the employer that the tool is the author's own project and that a
  non-production copy may be used; needed before step 1."
- Delete step 24. Add "Step 12a — Real-system map" (after M1): record and map the pilot
  system *and* one public open-source PostgreSQL application; hand-check 20 endpoints
  against the source. Add "Step 20a — Real-system replay" (after M2): generate, calibrate and
  replay one flow of at least 10 steps including writes on both. Both precede step 23.
- Name the public application in the roadmap now. Candidates to verify: Redmine on
  PostgreSQL (server-rendered, old, widely known), Wiki.js or Umami (Node.js + PostgreSQL),
  Miniflux (small, PostgreSQL only).
- Replace A8 with:
  - A8a: on the pilot system at least 90% of 20 hand-checked endpoints list the correct
    tables read and written; label shares are reported; `ambiguous` plus `background` is
    under 5% of statements or the cause is documented.
  - A8b: on the pilot system one flow of at least 10 steps with writes replays green three
    times in a row, and one deliberately introduced regression is caught.
  - A9: the same two checks on the public application, with the map and flows committed
    under `examples/` so anyone can reproduce them.
- D2 "Reason": add "holds only if pilot permission is granted before step 1; otherwise the
  public application is the pilot".

### 4. Blocker (before any run on real data) — two unlisted constraints with legal weight

**Where:** `01-mvp-scope.md` §7; `03-roadmap.md` steps 9 and 13; `02-architecture.md` §2.7
and §4.

**What is wrong.**

- Constraint 6 says recordings are git-ignored. But the generated flows are *designed to be
  committed* (`trowel/flows/<name>/` with sidecar response bodies), and default redaction
  covers credentials only. Recorded against a copy of production, names, e-mail addresses
  and order data go into the repository. "Advanced redaction of personal data" is listed in
  §9 as a paid candidate, so the default workflow of the free tool writes personal data into
  git.
- Replay runs the real application and outbound services are not mocked (§6). Replaying a
  checkout or a registration therefore sends real e-mails and calls real payment or webhook
  endpoints, addressed to the people in the copied data. This is not in §7.

**Exact change.**

- §7, add: "7. Replay executes the application's real side effects. Point mail, payment and
  webhook settings at sandboxes before recording or replaying." and "8. Generated flow files
  contain request and response bodies as recorded. Record against synthetic or anonymised
  data, or do not commit the flows."
- Step 13 "Build": add "`generate` prints the list of sidecar files and a warning when
  bodies contain strings shaped like e-mail addresses or phone numbers". Step 9 "Done when":
  add "the README states which data classes are and are not redacted".
- Step 12a precondition: "outbound integrations of the pilot copy are disabled or sandboxed;
  confirmed in writing".

---

## Should-fix

### 5. Should-fix — no finished product exists until step 23 of 24; no time budget

**Where:** `03-roadmap.md` Rules 1–2, milestones, steps 22–23; `04-decisions.md` D12, D14.

**What is wrong.**

- M1 is an "alpha" without packaging, quickstart or comparison page. If the project stalls
  anywhere in Phase D — the hardest phase, and per the research the part where even funded
  tools stay flaky — nothing shippable exists. For a part-time solo developer that is the
  most likely place to stall.
- There are no hour estimates and no calendar. My own estimate: 24 steps at 10–20 focused
  hours each is 240–480 hours, that is 7 to 14 months at 8 hours a week, before overruns.
- Rule 2 claims equal step size, but steps 2, 7, 11, 14, 16 and 19 each bundle several
  concerns (step 14: five value sources and four selector types; step 16: JSON diff and a
  full HTML normalisation pipeline; step 19: calibration, quarantine and three rule levels).
  The real count is nearer 30.
- Rule 1 has no time-box: one stubborn step stops everything. D12 and D14 say "Revisit:
  Never", which removes the mechanism for reacting to finding 2 or to feedback after M1.
- First sight of the core value (a map) comes at step 12. The plan forbids a spike, so the
  riskiest assumption — that serial-gate correlation works on the pilot's pooled
  connections — is tested late.

**Exact change.**

- Reorder Phase E: move step 22 (packaging) and a reduced step 23 (README, quickstart,
  constraints, showcase map, comparison page) to directly after step 12a. Tag that
  **v0.1.0 = record + map** and treat it as a finished, launched product. Phase D ships as
  **v0.2.0**. Rename M1 accordingly; M3 becomes "v0.2.0 with tests".
- Add an "Estimate (hours)" and "Actual" column to the progress table and a target date per
  milestone.
- Add Rule 6: "A step that exceeds twice its estimate is cut down in this document, not
  extended."
- Add "Step 0a — Correlation spike", throwaway code outside `main`, one weekend: relay plus
  minimal `Parse`/`Query` decoding plus time-window linking against the pilot copy (or the
  public app). Done when the label shares are written down.
- Split steps 2, 7, 11, 14, 16, 19 into two each, or reduce them as in finding 6.
- D12 and D14 "Revisit when": replace "Never" with "result of step 2a or feedback after
  v0.1.0 contradicts it".
- Add a section "Cut order if time runs out" containing the list in finding 6.

### 6. Should-fix — the scope is not the smallest differentiated one

**Where:** `01-mvp-scope.md` §5 (F7, F10, F11, F12, F14), §8 A6; `03-roadmap.md` steps 2, 7,
9, 11, 12, 14, 16, 18, 19, 20, 22.

**What is wrong.** The differentiation rests on four things: request-to-statement
correlation with confidence labels, the committed map, replay against a real reset database,
and write assertions. Several in-scope items add cost without adding to any of them.

**Exact change — remove from the MVP, in this order (also the cut order if time runs out):**

1. A6: native macOS and Windows binaries as a *supported* target. Keep cross-compiling, but
   state "supported: Linux and the Docker image". As written, A6 checks that binaries build,
   not that they run.
2. F7/step 12: per-endpoint pages and Mermaid graphs. One `BEHAVIOUR.md` plus
   `behaviour.json` is the artefact.
3. Step 11: parameter type inference and "session requirement". Keep templating, tables,
   row counts, three findings.
4. Step 18: warn-level comparison of tables read and fingerprints.
5. F12/step 20: JUnit XML. Exit code and console diff are enough for CI at v0.2.
6. F10/step 16: the normalised HTML diff. Replace with status, content type and a list of
   CSS-selector text extractions the user opts into; add full HTML diff later. This is the
   largest single saving and the noisiest assertion.
7. F11/step 19: quarantine and endpoint-level rules. Keep global and step rules.
8. Step 9: `inspect`. Step 7: `COPY` accounting and pipelined FIFO matching — mark such
   connections `undecoded` (the fail-open path exists already).
9. Step 2: the token API login and the N+1 endpoint in the demo app, if step 14 is reduced
   to cookie and hidden-input captures.

**Do not cut — the MVP is unconvincing without them:** confidence labels and the label
summary; database snapshot and reset; `calibrate` (double replay); write assertions plus the
state checksum from finding 1; credential redaction and preflight messages; `trowel init`
and the ten-minute quickstart; a map and flows of a real public application (finding 3); a
copy-and-paste GitHub Actions example (finding 10).

### 7. Should-fix — the counter-evidence from the research is absent from the plan

**Where:** `01-mvp-scope.md` §1, §9; `README.md` "Why"; `03-roadmap.md` "After the MVP" and
"Validation".

**What is wrong.** Research 01 §4 "Counter-evidence (to be taken seriously)" and §5 "Honest
limits" do not appear anywhere in the plan:

- the need is episodic (weeks at takeover, then nothing);
- owners of small legacy systems are the least willing to pay;
- Optic, Akita and Pythagora all left the adjacent segment without a standalone business;
- community threads on the pain have low engagement;
- "the moat is focus, not technology": Speedscale could add an endpoint-to-table report in
  weeks;
- the strongest substitute is a coding agent with a prompt;
- the price points are "a judgement … not validated willingness-to-pay".

Instead §1 says "Buyers we expect later" and §9 lists paid add-ons. Specific overstatements:

- README: "Existing record-and-replay tools answer the second question only" — the research
  credits AppMap with understanding as first-class and proxymock with a SQL inventory.
- Roadmap: "Ordered by expected value, from research report 01" — the research contains no
  such ordering; it is the author's.
- §3: "three points the research found unoccupied" — the research says "none of the tools
  examined, on the pages read" (§7), and for the map "open, with one strong neighbour".
- The plan defines no success or stop criterion for the market goal.

**Exact change.**

- Add `01-mvp-scope.md` §12 "Reasons this may not work", listing the seven points above in
  one line each with the research section reference.
- §1: rename "Buyers we expect later" to "Unvalidated buyer hypotheses".
- §9: prefix with "No willingness to pay has been validated; the research's price points are
  its author's judgement."
- README "Why": replace the sentence with "Record-and-replay tools replace the database with
  recordings; tools that explain behaviour need an agent inside the application."
- Roadmap "After the MVP": change the lead-in to "Author's ordering".
- Roadmap "Validation": change "Any time: talk to five developers or agencies" to a dated
  item due before v0.1.0, and add the outcome measures: "after v0.1.0, within 60 days: three
  people outside the author's circle produce a map of their own application; if none do,
  Phase D is reconsidered".

### 8. Should-fix — PostgreSQL-first is defensible for finishing, not for market value, and the documents blur that

**Where:** `01-mvp-scope.md` §1, §6 (row MySQL), §9, §10; `04-decisions.md` D2, D13;
`README.md` blockquote; `03-roadmap.md` "After the MVP".

**What is wrong.**

- The decision is sound as an engineering and dogfooding choice (cheaper protocol, a system
  the author touches daily). As a market choice it selects the segment where competitors are
  strongest (finding 2) and drops the research's third condition, "own the unfashionable
  stack". §10 admits the niche tension but omits the research's second argument: correlation
  is the "single biggest technical risk" outside PHP's connection-per-request model, "so the
  MVP should support PHP/MySQL only". The plan chose the harder correlation case and the
  weaker market together and records only half of that.
- D13 avoids an untrue claim by naming no stack. The result is neither sharp nor fully
  honest: a reader with MySQL — the audience the research says matters most — learns the
  restriction only in the constraints. "Every endpoint" also overstates: the map covers
  exercised endpoints only.
- MySQL is "first milestone after the MVP" in §6 and §10, "not scheduled" in the roadmap, and
  a *paid* candidate ("MySQL support for old PHP stacks with commercial support") in §9.
  Three different statuses for the feature the market case depends on.
- The PostgreSQL-only tool is in fact language-agnostic on the application side (Rails,
  Django, Laravel on PostgreSQL), which is a real inherited-app population. The plan narrows
  the primary user to Node.js and does not use this.

**Exact change.**

- README blockquote and §2, if finding 1(a) is adopted:
  > "Put Trowel between the web app you inherited and its PostgreSQL database. Click through
  > the app once and you get a committed, diffable map of which tables each endpoint you
  > touched reads and writes, plus replay tests that run against the real database and fail
  > when it ends up different. No SDK, no agent in the app, no code change. MySQL is next."

  If 1(b) is adopted, replace "fail when it ends up different" with "fail when a request no
  longer writes what it wrote before".
- D13 "Decision": change to "Positioning names the database (PostgreSQL) and no application
  stack".
- §1: change the primary user to "a developer maintaining an inherited web application on
  PostgreSQL, in any language whose driver speaks the plain wire protocol (tested:
  node-postgres, libpq, pgx)".
- §10: add "The research also recommended PHP/MySQL because one connection per request makes
  correlation easy; the MVP accepts the harder pooled case and relies on the serial gate."
- §9: delete "MySQL support for old PHP stacks with" so that only "commercial support"
  remains; state in §6 that MySQL is part of the open core.
- Roadmap: turn "After the MVP" item 1 into "Phase F — MySQL" with four to five numbered
  steps and estimates, so that §6's "first milestone after the MVP" is true.
- Step 11 "Build": add "config list of query parameters that are part of endpoint identity
  (`index.php?action=`)", as research 03 advises; otherwise §10's "an addition, not a
  rewrite" does not hold for PHP routing.

### 9. Should-fix — several acceptance criteria are not measurable or prove less than they seem

**Where:** `01-mvp-scope.md` §8.

**What is wrong and exact change, per criterion:**

- **A2** is satisfied by construction: every statement receives one of five labels, and the
  criterion excludes only `ambiguous`. A statement attributed to the wrong request with the
  label `exclusive` passes. Replace with: "Every statement of the scripted scenario is
  attributed to the request listed in `EXPECTED.md`; none is `ambiguous`; the simulated
  background statement is labelled `background`."
- **A3** compares against a file written by the same author for an app written by the same
  author. Keep it, but it is a regression test, not evidence; A9 (finding 3) is the evidence.
- **A5** lacks the changed-value case (finding 1) and any negative control. Add: "Two seeded
  non-regressions — a rewritten query with the same effect, and a reordered JSON object —
  must pass." Add: "Calibration on the demo adds rules for the timestamp and UUID fields and
  nothing else" (currently only in step 19), so that over-masking is an acceptance failure.
- **A6** checks that binaries are built, not that they work. Replace with: "The Linux binary
  and the Docker image run the full demo sequence in CI; other targets are built and smoke
  tested with `trowel version`, and are documented as unsupported."
- **A7** is one unnamed person on the demo app. Replace with: "Three people who have not seen
  the project each reach the demo map from the README alone; median time at most ten minutes
  excluding image download; at least one on macOS with Docker Desktop; their notes are
  committed." Add **A7b**: "One of them produces a map of an application Trowel's author did
  not prepare, within 60 minutes."
- **Add A10:** "Measured overhead of the relay on the demo scenario (added latency per
  statement and per request, gate excluded) is published in the docs." The research notes
  that critics of SQL-tap raised added latency first.
- **Add A11:** "Trowel opens no network connection other than to the two configured
  upstreams; checked by an end-to-end test in a network-isolated container."

### 10. Should-fix — the launch package is incomplete for a tool that sits in the data path

**Where:** `03-roadmap.md` steps 1 and 23; `01-mvp-scope.md` §11.

**What is wrong.** Step 23 has a README, a terminal recording, concept pages, a comparison
page, a changelog and issue templates. Missing for a credible launch and for portfolio
value:

- a security statement (what Trowel stores, where secrets live, what redaction does not
  cover, how to report a vulnerability);
- an explicit telemetry stance;
- a stability promise for the flow schema and `behaviour.json`, which users commit;
- a CI example — "free in CI" is a concrete edge over proxymock (paid licence for CI per the
  research) and the plan never uses it;
- the coding-agent workflow and Tusk Drift in the comparison (the research calls the agent
  the strongest substitute and Tusk the fourth competitor);
- a launch plan and success measures;
- a statement of what maintenance the author commits to after release;
- a design write-up, which is what a hiring reviewer actually reads;
- the name check, which §11 schedules for step 1 without a method.

**Exact change.** Add to step 23 "Build": `SECURITY.md` with a short threat model; README
line "No telemetry, no update check, no network access beyond your two upstreams" (backed by
A11); "Compatibility" section (flow schema v1 and `behaviour.json` are stable within 0.x
minor releases, with a migration command otherwise); `examples/ci/github-actions.yml`;
comparison page extended with "coding agent plus prompt" and Tusk Drift, using the results
of step 2a; a 60–90 second recording that shows a seeded changed-value regression being
caught (not only a map being produced); a launch post built around the public showcase map
("what application X really does to its database"); a "Project status" paragraph stating the
maintenance commitment; one article on correlation and its failure modes. Add to step 23
"Done when": "launch channels and three numeric targets for the first 30 days are written
in the roadmap". Add to step 1 "Done when": "name checked against GitHub, the Go module
index, npm, Docker Hub and a trademark search; result recorded in the decision log".

### 11. Should-fix — the agent angle is treated as backlog although it costs nothing

**Where:** `03-roadmap.md` "After the MVP" item 6; `01-mvp-scope.md` §1, §3.

**What is wrong.** The research concludes that the tool "should feed agents rather than
compete with them" and lists "files designed to be read by coding agents" in its implied MVP
scope. The plan mentions agents once as a later buyer and schedules "plain-file access for
coding agents" sixth after the MVP, although `behaviour.json` and `BEHAVIOUR.md` are already
plain committed files. The strongest current demand signal in the research is left out of
the messaging.

**Exact change.** Delete "Plain-file access for coding agents" from "After the MVP" (keep
"MCP server"). Add to step 12 "Build": "a documented, versioned `behaviour.json` schema and
a docs page 'Using the map as context for a coding agent' with a ready snippet for
`AGENTS.md`/`CLAUDE.md`". Add to §3 a fourth row: "Agents | Map and goldens are observed
behaviour an agent can be checked against | Agent-written tests describe the code, not
observed behaviour".

### 12. Should-fix — the map can look complete when it is not

**Where:** `01-mvp-scope.md` §4 step 3, §6 (rows "Effects of triggers", "Mocking … outbound
services"); `03-roadmap.md` steps 9, 11, 12; `README.md` blockquote.

**What is wrong.**

- "Every endpoint" means every endpoint exercised, and each only along the branches
  exercised. The map gives no indication of coverage, so "this endpoint only reads" may be
  an artefact of one click.
- Trigger, cascade and stored-procedure effects are out of scope, which is acceptable, but
  the map will then present an incomplete write list as fact. In inherited systems these are
  "exactly the surprises" (research 01 §3a).
- The research's implied MVP map includes outbound calls. The plan drops them without
  listing the omission in §6, which only mentions *mocking* outbound services.

**Exact change.**

- Step 9 preflight: add "query the catalog for triggers, rules, foreign keys with cascading
  actions and views; store the result in the session".
- Step 11 findings: add "table written has triggers or cascades — effects not observed" and
  "endpoint observed N times" with a low-sample marker when N is 1.
- Step 12: `BEHAVIOUR.md` header states "Observed behaviour from N requests on DATE; not
  exhaustive".
- §6: add row "Outbound HTTP calls in the map | Needs an egress proxy | Backlog".
- README and §2: "every endpoint" → "every endpoint you exercise".

---

## Minor

### 13. Minor — decision log lacks the two decisions this review turns on

**Where:** `04-decisions.md`.

**What is wrong.** There is no entry for "state checksum in or out of the open core"
(finding 1), none for "v0.1.0 is map-only" (finding 5), and none recording that the
competitor bench is a gate (finding 2). Rule 4 of the roadmap requires scope changes to pass
through this log.

**Exact change.** Append D15 (database assertion level and what stays open), D16 (release
split: v0.1.0 record + map, v0.2.0 tests), D17 (step 2a is a gate with the decision rule
quoted), each with a "Revisit when".

### 14. Minor — small inconsistencies

**Where and exact change.**

- `01-mvp-scope.md` §7 says the constraints "are stated at the top of the README"; the README
  has none. Add a "Limits" list under the blockquote now, starting with "PostgreSQL only".
- `01-mvp-scope.md` §3 says "after half an hour of clicking"; the research sentence says "an
  afternoon". Use one figure, and only after A7b has measured it.
- `README.md` command table lists five commands; the roadmap adds `inspect` and `init`.
  Align after the cuts in finding 6.
- `03-roadmap.md` step 23 "comparison page with Keploy, proxymock and AppMap" — add Tusk
  Drift and the coding-agent workflow (finding 10).
- `01-mvp-scope.md` §8 A1 "Review of the example directory" — make it a CI check: "the
  `legacy-shop` source tree is byte-identical with and without the override".
