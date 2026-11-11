# 01 - Competitive landscape: "legacy code archaeologist"

Research date: 11 November 2026. Method: web search plus fetching vendor docs, pricing pages, third-party reviews, package registries and Hacker News mirrors. GitHub itself, Reddit and the HN search API were not reachable from this environment, so repository statistics come from third-party indexes (ecosyste.ms, dev.co, toolradar) and are marked accordingly. Section 7 lists everything that could not be verified.

---

## 1. Executive summary

- **Record-and-replay for API tests is a crowded, funded category.** Keploy (eBPF, open source), Speedscale/proxymock (proxy, free CLI), Tusk Drift (SDK, open-source CLI), HyperTest (SDK), AREX (Java agent) and Signadot SmartTests (Kubernetes) all turn recorded traffic into regression tests. Competing head-on as "another traffic-replay tool" is not viable for a solo developer.
- **Every one of them treats the database as something to mock away, not something to assert on.** They record the SQL conversation so the test can run without a database. None of the tools examined asserts on which rows actually changed. Speedscale comes closest with a statement-level "compare SQL between runs" feature, and its own documentation says it does not look at database state.
- **Nobody ships the behaviour map as the product.** AppMap is the only tool where "understand what this app does" (sequence diagrams, SQL per request) is first-class, and it needs a per-language agent (Ruby, Python, Java, Node.js; no PHP, no .NET). It has since repositioned towards "runtime evidence for AI-assisted development".
- **Old stacks are poorly served.** Keploy's own PHP page lists PHP 8.0+ and its capture needs Linux kernel 5.10+ or Docker. Tusk Drift is Node.js and Python only. HyperTest is Node.js and Java. AppMap has no PHP. Only proxymock claims PHP support, with an OpenSSL 3.x requirement that old PHP builds will not meet.
- **The lightweight "observe traffic, get documentation" segment has been vacated.** Optic was acquired by Atlassian (2024) and its repository was archived in January 2026; Akita became Postman Insights (Enterprise plans, Kubernetes/AWS only); Pythagora's test recorder is deprecated. This is both an opening and a warning: three teams left this segment without building a standalone business.
- **Demand is real but diffuse.** 62% of developers named technical debt their top frustration (Stack Overflow 2024). Every 2026 guide on AI-assisted legacy modernization says "write characterization tests first", and none of them describes a tool for capturing real behaviour. A zero-code-change SQL proxy viewer (SQL-tap) reached 233 points on HN.
- **The strongest substitute is not a product; it is a coding agent plus a prompt.** Claude Code, Cursor and Codex generate characterization tests from source code. Their known weakness is that the tests describe the code, not observed behaviour, and say nothing reliable about side effects. That is the gap an observation tool fills, and the tool should feed agents rather than compete with them.
- **Verdict: a narrow but defensible niche exists.** It is "understanding plus database truth for inherited LAMP-era apps, with zero code changes", not "test generation". It is defensible mainly because it is too small and too unglamorous for the funded players, not because it is technically hard to copy.
- **Sharpest positioning:** "Point it at the legacy app you inherited; after an afternoon of clicking through it you get a map of every endpoint with the tables it reads and writes, plus golden-master tests that fail when the database ends up different, not just when the response does."
- **Closest competitors:** Speedscale proxymock (same architecture), Keploy (same promise of zero code change), AppMap (same "understand it" goal). Tusk Drift is fourth.

---

## 2. Comparison table

Legend: OSS = open source. "Unverified" = could not be confirmed from a primary source in this session.

### 2a. Direct overlap: traffic to tests

| Tool | Captures | How | Output | Stacks | Licence / price | Maintained? | Known weaknesses |
|---|---|---|---|---|---|---|---|
| **Keploy** | Inbound HTTP/gRPC; outbound MySQL, Postgres, MongoDB, Redis, Kafka, HTTP | eBPF socket probes, no SDK or proxy | YAML test cases plus mocks; coverage reports | Language-agnostic in principle; PHP page says PHP 8.0+ (built-in server, PHP-FPM, FrankenPHP) | Apache-2.0 core. Free Playground; Pro $19/user/month plus usage (page headline says $24, card says $19); Enterprise custom | Yes, very active (about 17-18k stars per third parties) | Linux kernel 5.10+ or Docker; native macOS/Windows only understands HTTP, MySQL, MongoDB (Postgres/Redis need Docker). DB is mocked, never asserted. Replays go flaky on non-deterministic data; stubs go stale and need re-recording; time freezing and precise noise filtering are not in the OSS tier; Kubernetes and production capture are Enterprise. No documentation output. |
| **Speedscale proxymock** | Inbound and outbound HTTP, gRPC, GraphQL; Postgres, MySQL, MongoDB, Redis; many brokers | Local inbound/outbound proxy plus port mapping for databases; eBPF collector in Kubernetes | "RRPair" markdown files; SQL inventory; `.sql` export; SQL compare between two runs (new/removed/changed statements, count drift, DDL); MCP access for coding agents | Docs list .NET, Go, Java, Node.js, PHP, Python, Ruby, Rust; PHP needs OpenSSL 3.x | CLI free for local use with activation; CI use needs a paid licence. Cloud $0.01/MB ingested. Licence of the CLI unverified (appears closed) | Yes (docs and blog updated Oct-Nov 2026) | SQL comparison is statement text only; vendor states it does not check persistence, constraints or state. SQL mock matches on statement, not bound values. Positioned at Kubernetes microservice teams, not at legacy understanding. Transforms for tokens/ids/timestamps must be configured per flow. |
| **Tusk Drift** | Inbound requests plus outbound calls at library level (pg, mysql2, ioredis, psycopg, SQLAlchemy, HTTP clients, JWT) | In-process SDK, OpenTelemetry-style | Trace files in `.tusk/traces`; replay with sandboxed mocks; deviation report | Node.js and Python only (Python SDK is alpha, v0.1.29, May 2026) | CLI and SDKs Apache-2.0. Cloud: free tier; Team $50/active developer/month; Enterprise 200-seat minimum | Yes, but small (about 125-145 stars on the CLI) | Requires code change and a supported library version. No PHP/Java/.NET. No default PII redaction. Local traces must be re-recorded manually after schema changes. Vendor told an HN commenter it is not designed for cross-language rewrite verification. |
| **HyperTest** | Inbound requests, outbound calls | SDK | Regression report from replay | Node.js, Java | Commercial; pricing not public on pages read | Appears active | SDK per language; DB comparison behaviour unverified. |
| **AREX** (Trip.com) | Inbound plus dependency calls incl. DB | Java agent | Recorded cases, replay diff | Java only | Apache-2.0 | Last push Dec 2025 (ecosyste.ms) | Java-only; heavy platform (storage, scheduler, UI). |
| **Signadot SmartTests** | Requests made by Starlark tests against baseline and sandbox | Kubernetes sandboxes | Relevance-scored diff (red/yellow/green) | Kubernetes microservices | Free starter; Business $250/month; Enterprise | Yes | Needs Kubernetes and a test author; no DB state; irrelevant to a single legacy box. |
| **Pythagora (test recorder)** | Express requests, MongoDB | Node instrumentation | Jest-style integration tests | Node.js/Express | Apache-2.0 | **Deprecated**; README points to GPT Pilot; last push March 2025 | Dead for this use. |
| **Meticulous** | Browser sessions plus network responses; since July 2026 also backend spans (Postgres queries, outbound HTTP) for SSR apps | Browser snippet; backend mechanism not documented on pages read | Visual diffs on pull requests | React/Next/Vue/Angular front ends | Commercial; prices not shown | Yes | Front-end regression tool; backend is mocked by default; pixel-based. |

### 2b. Building blocks and partial substitutes

| Tool | What it does | Relevance | Limits |
|---|---|---|---|
| **GoReplay** | Captures live HTTP from the network interface and replays it elsewhere | Shadow/load testing | HTTP only in the free edition (LGPLv3); PRO $2,950/year adds binary protocols, keep-alive sessions. No assertions, no DB, no test artefacts. Last push Jan 2026. |
| **Diffy / opendiffy** | Proxy that sends each request to primary, secondary and candidate and subtracts the primary-vs-secondary noise | Best prior art for automatic noise handling | Writes are triplicated; database drift between instances; maintenance status of opendiffy unverified. |
| **Hoverfly** | HTTP(S) capture and simulate proxy | Outbound service virtualisation | HTTP only; no GUI; Apache-2.0; v1.12.10 June 2026 per dev.co. |
| **WireMock record mode / WireMock CLI** | Records HTTP through a proxy into stubs; Cloud can derive OpenAPI from a recording | Outbound stubs | Stubs dependencies; does not test the app itself; no DB. |
| **mitmproxy** | Interactive HTTP/1-3, WebSocket proxy; raw TCP pass-through | Capture layer; `mitmproxy2swagger`/`mitm2openapi` derive OpenAPI from captures | No database protocol parsing; no server replay for TCP/WebSocket; no test generation. |
| **VCR family (vcr, vcrpy, php-vcr)** | Records outbound HTTP inside an existing test suite | Only useful once tests exist | Outbound only; in-language; latest php-vcr needs PHP 8. |
| **ApprovalTests / snapshot libraries** | Golden-master assertion with scrubbers for dates and GUIDs | The assertion half of the idea | You must write the harness and inputs yourself. |
| **AppMap** | Records HTTP requests, SQL, function calls per request; sequence diagrams, dependency maps, "Gold Traces" compared at review | **Closest on the behaviour-map goal** | Per-language agent: Ruby, Python, Java, Node.js. No PHP, no .NET. Now marketed as runtime evidence for AI coding agents, with an enterprise tier. Java agent repo last pushed March 2025 (ecosyste.ms). |
| **Postman Insights (ex-Akita)** | Passive BPF agent infers endpoints, errors, latency | Endpoint discovery | Enterprise plans only; Kubernetes, ECS, EC2, Elastic Beanstalk; REST only; no SQL; no tests. |
| **Optic** | OpenAPI diff/lint and capture | Was the OSS "traffic to spec" option | Acquired by Atlassian April 2024; repo archived January 2026. |
| **SQL-tap** (new, 2026) | Transparent MySQL/Postgres wire-protocol proxy with a terminal UI and EXPLAIN | Proves the DB-proxy half is buildable by one person and wanted | Viewer only: no HTTP correlation, no tests, no map. HN critics raised added latency and TLS handling. |
| **APMs (Datadog, New Relic, Sentry, Tideways, Blackfire)** | Per-endpoint traces with SQL spans | The incumbent "which endpoint runs which query" answer | Needs an agent or extension per language, ongoing subscription, and produces dashboards rather than tests or a durable document. |
| **PHP-specific prior art** | `de-legacy-fy` (characterization tests from Xdebug traces; archived 2017), `Asis` (prototype) | Shows the idea is old in PHP land | Both dead; both function-level and in-process. |

### 2c. AI-agent-based "tests for legacy code"

| Tool | Approach | Limits for this use case |
|---|---|---|
| **Claude Code / Cursor / Codex with a characterization-test workflow** | Agent reads source, writes golden-master tests, human reviews | Tests are derived from the code under judgement; guides warn the agent "writes tests that describe its own refactored code" unless goldens are recorded first and locked. Needs a runnable test harness, which old PHP apps lack. No side-effect evidence. |
| **Diffblue Cover** | Autonomous unit tests for Java (reinforcement learning) | Java only, unit level, enterprise pricing. |
| **Rebuild Dossier** (arXiv, Sept-Oct 2026) | MCP server extracting interface contracts via static analysis and a Playwright crawl for agentic rebuilds | Author withdrew the "mechanically enforced" claims; no traffic or DB capture; status codes and validation rules not captured. |
| **Mechanical Orchard Imogen** | Captures real data flows on mainframes, generates tests, rewrites until outputs are byte-equivalent | Validates "observe behaviour, then modernize" at the top of the market. Mainframe only, outcome-priced, sold via integrators. Not a competitor for PHP/MySQL. |
| **Meta-level:** Moderne/OpenRewrite, vFunction, CAST, AWS Transform, GitHub Copilot app modernization | Static analysis and automated refactoring | Java/.NET/COBOL enterprise focus; quote-based pricing; none observes runtime behaviour of a small web app. |

---

## 3. Gap analysis

### (a) Database side-effect capture and assertion - **largest and clearest gap**

- Keploy, Tusk Drift, proxymock and HyperTest all record database traffic in order to *replace* the database at replay time. A test passes when the HTTP response matches while the app is fed recorded query results. What the app would have written is not checked against reality.
- Speedscale's SQL compare (July 2026) is the nearest thing: it fingerprints statements and reports new, removed and changed queries between two recordings. The vendor's FAQ is explicit that this is a comparison of recorded SQL text and does not validate persistence, constraints or query plans.
- Diffy cannot handle writes without triplicating them. GoReplay has no assertions at all.
- Row-level assertion exists only as hand-written checks: Rostyman's "DB Verify" tab, `jest-mysql-diff`, Elixir's `delta_check`, DBUnit-style comparisons. None is generated from observation.
- No tool found captures effects that never appear in the SQL text: triggers, cascades, `ON UPDATE CURRENT_TIMESTAMP`, stored procedures. Those are exactly the surprises in inherited systems.
- **Implication for the MVP (own analysis):** offer two levels. Level 1, wire-protocol parsing: statement fingerprints and affected-row counts per request. Level 2, true row diffs from the MySQL binlog (ROW format) or Postgres logical decoding, or a before/after snapshot of touched tables. Level 2 is the feature no competitor has and the one worth charging for.

### (b) Behaviour map as a first-class product - **open, with one strong neighbour**

- Test-generation tools emit YAML or trace files meant for machines. Keploy and proxymock have coverage or inventory views, but no "endpoint X reads tables A, B and writes C, and calls service D" document.
- AppMap does this well and in more depth (function-level), but only where its agents run. The DEV article on inheriting an undocumented API recommends log diving, reading route files, mitmproxy and an APM; none of those yields table-level or side-effect information.
- APMs hold the raw data (SQL spans per endpoint) but present it as live dashboards behind a subscription, not as a versionable artefact.
- **Implication:** the map should be a committed, diffable file (markdown plus JSON) and should be readable by coding agents (MCP or plain files). AppMap's own repositioning shows the buyer increasingly is "a developer steering an agent".

### (c) Zero-code-change setup for PHP 5/7 + MySQL - **open, but check Keploy in a lab first**

- Keploy is zero-code-change in principle, but its PHP page lists PHP 8.0+, capture requires a modern Linux kernel or Docker, and TLS capture relies on OpenSSL uprobes. Old apps commonly run on old distributions, shared hosting or Windows/XAMPP, where eBPF is unavailable. Whether Keploy works against PHP 5.6 with mod_php was not verified.
- proxymock is the same architecture as the proposed product and lists PHP, with an OpenSSL 3.x caveat.
- Tusk Drift, HyperTest, AppMap, AREX: no PHP at all.
- A plain reverse proxy plus a MySQL port proxy runs anywhere the app can be pointed at a different host and port, including a decade-old box. That is a real, unglamorous advantage.
- **Technical risk (own analysis):** attributing a query to the HTTP request that caused it. In PHP each request normally opens its own connection, so time-window correlation works when requests are recorded one at a time. With pooled connections (Node.js, Java, .NET) concurrency breaks naive correlation; the recorder must serialise requests or accept an optional correlation hint (for example an SQL comment). Also to solve: TLS to the database, MySQL prepared-statement binary protocol, `caching_sha2_password` authentication, persistent connections.

### (d) Non-determinism - **partly solved elsewhere; table stakes, not a differentiator**

- Diffy's primary-versus-secondary subtraction remains the cleanest idea. Signadot scores diffs by relevance with a model. Keploy compares fields across multiple recordings and freezes the clock at replay (not in the OSS tier, as far as the pricing table shows). Tusk ships built-in rules for UUIDs and timestamps. ApprovalTests has scrubbers. Speedscale requires per-flow transforms and warns that blanket ignore rules hide regressions.
- Third-party reviews still list flaky replays on non-deterministic data as Keploy's top weakness, so the problem is managed rather than solved.
- Nobody applies noise detection to *database writes* (auto-increment ids, `created_at`, session rows, password hashes with random salts), because nobody asserts on writes.
- **Implication:** replay each recorded request twice against the unchanged app from the same database snapshot; anything that differs between the two baseline runs is noise and is masked automatically, in both the response and the row diff. This needs a resettable database, which is a reasonable requirement for a staging copy.

### What the gap is *not*

- It is not "generate API tests from traffic". That is done, open source, and free.
- It is not microservices, Kubernetes, load testing or production capture. Leave those to Speedscale and Keploy.

---

## 4. Demand evidence

**Who has the problem**

- Stack Overflow's 2024 survey: about 62% of developers cite technical debt as their top frustration at work, roughly double the next item.
- W3Techs figures quoted by ZenRows (early 2025): PHP runs about 74.5% of websites with a known server-side language, and about 45% of PHP sites were still on PHP 7, which is out of security support. The long tail of old PHP/MySQL applications is large. (Could not fetch W3Techs directly; no PHP 5 figure obtained.)
- "Ask HN: How to best document large, legacy systems?" drew advice to record typical inputs and outputs as regression tests by hand and to trace how data moves through the system. It also drew only 8 points and 4 comments. A later thread on recovering the "why" behind old code shows the same pain with no tooling answers beyond git blame and ADRs.
- A DEV Community article on inheriting an API with zero documentation describes an outage caused by removing an endpoint nobody knew was in use; its remedies are access logs, route files, mitmproxy and an APM.

**Signals that the mechanism is wanted**

- SQL-tap (a zero-code-change MySQL/Postgres proxy viewer, solo project) got 233 points and 44 comments on HN in 2026; one commenter used it to discover that a WordPress site issued hundreds of queries per request.
- Keploy has roughly 17-18k GitHub stars and a $1.3M seed (2022, per NeuronFeed). Speedscale raised a $2.2M first round in 2020 (later rounds not checked). Tusk is YC-backed and has done two Show HN launches for Drift.
- AppMap now sells "runtime evidence for AI-assisted development", with committed baseline traces that agents check changes against.

**The AI-agent tailwind**

- Every 2026 guide read on agent-assisted legacy modernization (developertoolkit.ai, amux, tianpan.co, Frenchy Digital, Unblocked) puts characterization tests first and names verification, not code generation, as the bottleneck. One states that teams skipping this step consistently report higher defect rates.
- None of those guides describes capturing real traffic or database effects with a tool; one mentions "anonymized production requests" as input and "the rows a job writes" as a seam, with no method. The demand for behaviour evidence is rising while the tooling described is still "ask the agent to write tests".

**What people pay for today**

| What | Price point |
|---|---|
| Keploy Pro | $19/user/month plus usage |
| Tusk Team | $50/active developer/month |
| KushoAI | $49-$249/month by endpoint count |
| Signadot Business | $250/month |
| GoReplay PRO | $2,950/year |
| Speedscale cloud | $0.01/MB ingested; managed tiers quoted |
| Postman Insights | Enterprise plans only |
| DIY agent sprint (amux estimate) | $400-$1,600 in tools, versus $150K+ for a consultancy |
| Consultancy discovery phase (Frenchy Digital's own bands) | $9k-$22k |
| Mechanical Orchard | Outcome-based, enterprise |

**Counter-evidence (to be taken seriously)**

- Owners of small legacy systems are the least willing to pay for tooling; the app is in "do not touch" mode by definition.
- Optic, Akita and Pythagora all left the adjacent segment. The need is episodic: a team uses such a tool intensely for a few weeks at takeover, then stops. Subscriptions fit poorly.
- Community threads on this exact pain have low engagement. The pain is widely shared but rarely searched for as a product category.

**Plausible buyers and pricing for a small open-core tool**

1. **Freelancers and agencies that take over legacy applications** - the best buyer. They face the problem repeatedly, bill the discovery phase to a client, and can pass through a per-project cost. A polished "system audit" report (endpoint/table map, risk hot spots) is something they can hand to the client.
2. **Small in-house teams before an upgrade or migration** (PHP 5/7 to 8, MySQL to Postgres, framework rewrite) - one-off purchase tied to a project budget.
3. **Developers driving coding agents on legacy code** - want the map and goldens as agent context; price-sensitive, large in number, good for adoption.

Suggested model: open-source core (recorder, map, replay CLI, statement-level DB assertions) to earn trust, since the tool sits in the data path. Paid add-on sold **per project or per year rather than per seat**: row-level diffs via binlog/logical decoding, automatic noise masking, PII redaction, HTML/PDF audit report, CI runner, multi-service correlation. Indicative: around EUR 150-300 per project licence or EUR 20-30 per developer per month, with an agency tier. Fixed-price "we map your legacy app" engagements are a realistic early revenue source and the best customer research. These figures are a judgement anchored on the table above, not validated willingness-to-pay.

---

## 5. Positioning recommendation

### Blunt verdict

There is a defensible niche for a solo MVP, with three conditions.

1. **Lead with understanding, not testing.** The first deliverable a user sees should be the behaviour map after 30 minutes of clicking through their app. Tests are the second act. "Test generation from traffic" invites comparison with Keploy, which is free and has 17k stars.
2. **Make database truth the signature feature.** "Fails when the database ends up different" is a one-line claim none of the competitors can make today.
3. **Own the unfashionable stack.** PHP 5/7 with MySQL on an old box, no Docker, no eBPF, no SDK. The funded players have no commercial reason to care about it.

Honest limits: the moat is focus, not technology. Speedscale already has the proxy, the MySQL/Postgres parsers and a SQL diff; adding an endpoint-to-table report is weeks of work for them if they chose to. Keploy could do the same. The expectation should be a useful open-source tool with modest revenue from agencies and project licences, not a venture-scale business. The single biggest technical risk is request-to-query correlation outside PHP's one-connection-per-request model, so the MVP should support PHP/MySQL only and say so.

### One-sentence positioning

> **"Put it in front of the legacy app you inherited: it watches the HTTP requests and the SQL they cause, then hands you a map of what every endpoint reads and writes, and golden-master tests that fail when the database ends up different - no code changes, works on PHP 5."**

### The three closest competitors and how to differ

| Competitor | Why it is close | How the MVP should differ |
|---|---|---|
| **Speedscale proxymock** | Same architecture (HTTP proxy plus DB port proxy), free CLI, SQL inventory, SQL compare, MCP | Open source with no activation or CI licence; assert on **state** (rows changed) rather than statement text; correlate SQL to the inbound endpoint and publish that as the map; aim at one legacy monolith, not Kubernetes fleets. |
| **Keploy** | Same promise (zero code change, any language), open source, large community | Run where eBPF cannot (old kernels, Windows, shared boxes); keep the **real database** in the loop and diff it instead of mocking it; ship automatic noise masking in the free core; produce documentation, which Keploy does not. |
| **AppMap** | Same goal (understand the app; per-request SQL; sequence diagrams; baseline traces for agents) | Network-level, so PHP, .NET and anything else works without an agent; shallower (no function calls) but universal; output is a committed map plus executable goldens rather than IDE visualisations. |

Fourth: **Tusk Drift** - differ by needing no SDK and by supporting stacks beyond Node.js and Python; Tusk's own founder pointed cross-language rewrite verification elsewhere.

### MVP scope implied by the research

- PHP + MySQL only; reverse proxy plus MySQL wire-protocol proxy; recording in a staging copy with a resettable database.
- Output 1: `behaviour-map.md` and `.json` - endpoints, parameters seen, tables read/written, statement shapes, outbound calls, per-endpoint examples.
- Output 2: replayable golden-master suite asserting on status, normalised body and DB effects (statement fingerprints first, row diffs second).
- Automatic noise mask from a double baseline run.
- Files designed to be read by coding agents; an MCP server can come later.
- Explicit non-goals: production capture, load testing, Kubernetes, mocking the database.

### Cheap validation before building much

- Run Keploy and proxymock against a PHP 5.6 + MySQL 5.7 sample app and write down exactly where each fails or succeeds. If either works cleanly, narrow the scope to the map and row-level assertions on top of the reality that capture is solved.
- Post the behaviour map of a well-known open-source legacy app (old WordPress, osCommerce, a classic CodeIgniter app) and see whether the artefact alone gets attention.
- Talk to five agencies that do PHP takeovers about whether a client-facing audit report is worth a per-project fee.

---

## 6. Sources

Vendor documentation and pricing
- Keploy pricing: https://keploy.io/pricing
- Keploy eBPF page: https://keploy.io/ebpf-testing
- Keploy platform requirements: https://keploy.io/docs/concepts/platform-requirements.md
- Keploy common errors: https://keploy.io/docs/keploy-explained/common-errors/
- Keploy PHP page: https://keploy.io/testing/php
- Keploy vs Tusk (vendor comparison): https://keploy.io/compare/tusk
- Speedscale pricing: https://www.speedscale.com/pricing
- proxymock overview: https://speedscale.com/proxymock/
- proxymock MySQL guide: https://docs.speedscale.com/proxymock/guides/mysql/
- Speedscale technology support: https://docs.speedscale.com/reference/technology-support/
- Speedscale "compare SQL between runs": https://speedscale.com/blog/compare-sql-between-runs/
- Speedscale traffic replay guide: https://speedscale.com/blog/definitive-guide-to-traffic-replay/
- Speedscale on DIY replay pitfalls: https://speedscale.com/blog/ai-intern-trap-diy-traffic-replay-scalability-nightmare/
- Tusk Drift Python SDK: https://pypi.org/project/tusk-drift-python-sdk/
- Tusk Drift CLI summary: https://openapps.pro/apps/tusk
- HyperTest: https://hypertest.co/how-it-works and https://docs-v2.hypertest.co/overview/how-it-works
- Signadot SmartTests: https://www.signadot.com/docs/concepts/smart-tests-and-jobs
- Signadot pricing: https://www.signadot.com/pricing
- Meticulous architecture: https://app.meticulous.ai/docs/concepts/architecture-overview
- Meticulous changelog (backend record and replay): https://app.meticulous.ai/changelog/2026-07-06
- Meticulous pricing: https://meticulous.ai/pricing/
- AppMap home: https://appmap.io/
- AppMap reverse-engineering guide: https://appmap.io/docs/reference/guides/reverse-engineering.html
- Postman Insights overview: https://learning.postman.com/docs/insights/overview
- Postman Insights FAQ: https://learning.postman.com/docs/insights/faq
- Atlassian acquires Optic: https://www.atlassian.com/blog/announcements/optic-acquisition
- WireMock CLI recording: https://www.wiremock.io/post/local-api-recording-with-wiremock-cli
- mitmproxy protocols: https://docs.mitmproxy.org/stable/concepts/protocols/
- GoReplay README: https://raw.githubusercontent.com/probelabs/goreplay/master/README.md
- Mechanical Orchard platform: https://www.mechanical-orchard.com/platform
- Rostyman DB assertions: https://rostyman.pages.dev/blog/database-assertions-in-api-tests/

Third-party reviews and indexes
- Keploy review (Aug 2026): https://makerstack.co/reviews/keploy-review/
- Keploy alternatives (Oct 2026): https://qodex.ai/blog/keploy-alternatives
- AI API testing tools compared (Apr 2026): https://awesomeagents.ai/tools/best-ai-api-testing-tools-2026/
- Keploy company profile: https://neuronfeed.com/startups/keploy
- Speedscale seed round: https://techcrunch.com/2020/10/16/atlanta-based-speedscale-now-has-2-2-million-more-to-grow-its-api-test-automation-business
- GoReplay pricing summary: https://toolradar.com/tools/goreplay
- GoReplay repo stats: https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fprobelabs%2Fgoreplay
- Pythagora repo stats: https://awesome.ecosyste.ms/api/v1/projects/github.com%2FPythagora-io%2Fpythagora
- Tusk Drift CLI repo stats: https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fuse-tusk%2Ftusk-drift-cli
- AREX agent repo stats: https://awesome.ecosyste.ms/api/v1/projects/github.com%2Farextest%2Farex-agent-java
- AppMap Java agent repo stats: https://awesome.ecosyste.ms/projects/github.com%2Fgetappmap%2Fappmap-java
- Optic repo stats: https://awesome.ecosyste.ms/projects/github.com%2Fopticdev%2Foptic
- "Optic is dead" (2026): https://dev.to/peter_zsobrk_50d5c4ac7de/optic-is-dead-alternatives-for-openapi-breaking-change-detection-dmp
- Hoverfly summary: https://dev.co/testing/open-source/hoverfly
- php-vcr summary: https://dev.co/testing/open-source/php-vcr and https://awesome.ecosyste.ms/projects/github.com%2Fphp-vcr%2Fphp-vcr
- Diffy explainer: https://helpmetest.com/blog/diffy-shadow-mode-testing/
- de-legacy-fy stats: https://awesome.ecosyste.ms/projects/github.com%2Fsebastianbergmann%2Fde-legacy-fy
- Asis: https://github.com/zavg/Asis
- Legacy modernization tools overview (Nov 2026): https://toolradar.com/blog/best-legacy-code-modernization-tools

Community and demand
- Show HN: Tusk Drift (first thread, mirror): https://hn.jakechampion.name/item/45887536
- Show HN: Tusk Drift (second thread, mirror): https://hn.jakechampion.name/item/46637322
- Show HN: SQL-tap: https://news.ycombinator.com/item?id=47011567
- Ask HN: documenting large legacy systems: https://hn.svelte.dev/item/32429194
- HN: finding the "why" behind old code: https://ask.live.com.de/46726249
- Inherited API with zero docs: https://dev.to/techresolve/solved-inherited-a-legacy-project-with-zero-api-docs-any-fast-way-to-map-all-endpoints-36hm
- r/ClaudeAI legacy refactor post (snapshot): https://reddit.sentinel-team.org/posts/1qokrqa/snapshots/2026-01-27T20%3A21%3A41.937566Z
- Stack Overflow 2024 survey results: https://stackoverflow.blog/2024/07/24/developers-want-more-more-more-the-2024-results-from-stack-overflow-s-annual-developer-survey
- PHP usage statistics (quoting W3Techs): https://www.zenrows.com/blog/php-usage-statistics
- Legacy modernization statistics roundup: https://www.dreamfactory.com/hub/legacy-system-modernization-statistics

AI-agent legacy workflows
- Characterization tests before agents: https://developertoolkit.ai/en/workflows/test/characterization-tests/
- AI coding agents on brownfield code (Apr 2026): https://tianpan.co/blog/2026-04-19-ai-coding-agents-brownfield-legacy-code
- DIY modernization guide (Oct 2026): https://amux.io/guides/legacy-code-modernization-ai-agents/
- Evidence review (Aug 2026): https://frenchydigital.com/blog/legacy-system-modernization-ai-agents-2026
- Unblocked modernization guide (June 2026): https://getunblocked.com/blog/legacy-code-modernization/
- Rebuild Dossier paper: https://arxiv.org/pdf/2608.23616

---

## 7. Not verified / caveats

- **GitHub data.** github.com and its API were blocked. Stars, last-push dates and archive status come from ecosyste.ms, dev.co, toolradar and similar; several of those indexes sync months late. No GitHub issue trackers were read, so "known weaknesses" rest on vendor troubleshooting docs, third-party reviews and HN threads rather than on issues.
- **Keploy on PHP 5/7 with mod_php.** Not tested and not documented either way. The PHP page lists 8.0+. The eBPF marketing page says kernel 4.15+, the docs say 5.10+; the docs figure is used here.
- **Keploy Pro price.** The pricing page shows both $19 and $24 per user per month.
- **Keploy tier gating** of time freezing was inferred from a table whose check marks did not render.
- **proxymock licence** (open or closed source) and whether it attributes SQL statements to the inbound endpoint that triggered them: not confirmed.
- **HyperTest:** whether it compares database queries between versions, its language list beyond Node.js and Java, and pricing.
- **Meticulous:** prices, and how backend spans are captured.
- **Optic archive date** (12 January 2026) comes from one DEV article by a competing vendor; ecosyste.ms shows last push May 2025 without an archive flag.
- **php-vcr:** dev.co reports v1.10.0 in July 2026; ecosyste.ms shows last push July 2024. Conflict unresolved.
- **Hoverfly, GoReplay PRO price:** from third-party pages only; toolradar's own GoReplay page is internally inconsistent about tiers.
- **opendiffy/Diffy maintenance status, mitmproxy current version, WireMock Cloud pricing, ApprovalTests latest release:** not checked against primary sources. Capabilities described are long-standing and stable.
- **Postman Insights** pricing beyond "Enterprise plans".
- **Tusk Drift first Show HN** point count; Tusk and Speedscale funding beyond what is cited.
- **Reddit.** r/PHP and similar threads could not be opened; no Reddit evidence is used apart from one r/ClaudeAI snapshot. The Hacker News thread 47167058 (84 comments) could not be fetched.
- **W3Techs** was not reachable; the PHP figures are second-hand and from early 2025. No current PHP 5 share was obtained.
- **Market-size and budget statistics** (Mordor Intelligence, GAO, CISQ) are quoted via a vendor roundup and describe enterprise services spend, not the addressable market for this tool. They are context only.
- **Vendor-authored sources** (Keploy, Speedscale, AppMap, amux, Frenchy Digital, Unblocked) have an interest in their framing; overhead and accuracy numbers from them are omitted or flagged.
- **Pricing recommendation and technical-risk notes** are my own analysis, not sourced findings.
- **Completeness.** "None of them does X" means none of the tools examined, on the pages read. A small or very new project doing row-level assertions from observed traffic may exist and not have surfaced.
