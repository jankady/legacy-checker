# 02 — Capture layer feasibility: HTTP proxy, DB wire proxy, correlation

Research date: 11 November 2026. Scope: the capture layer of a "legacy code archaeologist" (HTTP reverse proxy + database wire-protocol proxy + request-to-query correlation), to be built in Go as a single binary by one junior-to-mid developer.

**How to read the evidence labels**

- **[V]** verified in this session against a primary source (repository file, official docs page). The source is listed in section 9.
- **[U]** unverified: from general protocol/ecosystem knowledge, not re-checked in this session. Treat as a hypothesis to confirm with a test.
- **[E]** my own estimate or design judgement.

Environment note: GitHub API, `proxy.golang.org` and `pkg.go.dev` were not reachable by command line from the research sandbox, so versions were read from `CHANGELOG`/`go.mod` files on the default branches and from documentation pages. Star counts and "last commit" dates could not be checked.

---

## 1. Executive summary

### Verdict

The proxy-based capture layer is feasible for a solo MVP, **provided the MVP accepts three constraints**:

1. Recording runs against a dev/staging instance with **requests serialised** (one in flight at a time). This is what makes correlation reliable without touching the app.
2. The app-to-DB hop is **plaintext TCP** during recording (TLS off between app and proxy). TLS-required setups are a post-MVP feature.
3. **One database first.** PostgreSQL is the easier wire protocol by a wide margin; MySQL/MariaDB follows second with a deliberately narrow scope.

### Recommended MVP architecture

```
                       one Go process, one monotonic clock
 browser / test  ┌───────────────────────────────────────────────┐
 ───────────────▶│ HTTP recorder  (net/http + httputil.ReverseProxy)│──▶ web server / app
      :8080      │   - serial gate (1 request in flight)            │      (nginx+php-fpm,
                 │   - request/response tee, capped bodies          │       node, rails ...)
                 │                                                  │            │
                 │ correlator  (windows + connection lifetimes)     │            │ DB_HOST=archaeo
                 │                                                  │            ▼
                 │ DB tap proxy (TCP relay + protocol decoder)      │◀── app DB connections
                 │   - handshake handled, TLS/compression refused   │      :5432 / :3306
                 │   - raw bytes forwarded untouched, copy decoded  │──▶ real database
                 │                                                  │
                 │ store: one SQLite file (pure-Go driver)          │
                 └───────────────────────────────────────────────┘
```

| Concern | Recommendation | Why |
|---|---|---|
| HTTP capture | Go standard library `httputil.ReverseProxy` with `Rewrite`, bodies captured by wrapping `Body` readers (never `ReadAll`) | No dependency, handles streaming and upgrades already |
| DB capture | Own TCP relay that forwards raw bytes and decodes a *copy* of the stream; fail open if decoding breaks | A decoder bug must never change what the app sees |
| First database | **PostgreSQL**, decoded with `pgproto3` from `jackc/pgx` v5 | Self-describing messages, row counts in the protocol, mature decoder for both directions |
| Second database | MySQL/MariaDB with `go-mysql-org/go-mysql` packet framing; `COM_QUERY` first, prepared statements second | Context-dependent protocol, larger test matrix |
| Correlation | **Serialised time-window** as the base, **connection-lifetime containment** as a confidence booster; every link stored with a confidence label | The only strategy that needs zero app changes and works for pooled connections too |
| Storage | **SQLite** as the system of record (`modernc.org/sqlite`, no CGO), HAR 1.2 and JSONL as export formats | Correlation is a join; HAR cannot hold SQL and cannot be appended to |
| SQL parsing | Not in the capture hot path. Offline: `wasilibs/go-pgquery` (PostgreSQL, no CGO) and the TiDB parser (MySQL) | Keeps the binary static and the proxy fast |
| Packaging | One container/binary added through a Compose override file; the user changes one DB host variable and uses one new port | Smallest change that is easy to undo |

Rough effort for the capture layer (PostgreSQL only) **[E]**: 5–7 working weeks for one developer, of which the DB tap is 2–3 weeks. MySQL adds another 3–6 weeks.

---

## 2. HTTP capture

### 2.1 Reverse proxy in Go

`net/http/httputil.ReverseProxy` is enough. Facts checked in the Go source on the `master` branch **[V]**:

- `Rewrite func(*ProxyRequest)` is the current hook. `Director` is marked deprecated and described as insecure (hop-by-hop header removal happens after it runs, and inbound `X-Forwarded-*` headers are kept). New code should use `Rewrite` with `ProxyRequest.SetURL` and `SetXForwarded`.
- `FlushInterval`: zero means no periodic flush, negative means flush after every write. The value is ignored for responses the proxy recognises as streaming (`text/event-stream`) or with `ContentLength == -1`; those are flushed immediately.
- `ModifyResponse` runs for any backend response, after hop-by-hop headers are removed. If it returns an error, `ErrorHandler` runs.
- Protocol upgrades (the doc comment names WebSocket) are forwarded: after a `101` response the bytes are relayed unmodified. Upgrades to `h2c` are not forwarded.

Go toolchain: the `go.mod` files of TiDB, Vitess and Keploy declare `go 1.27.x`, so Go 1.27 is current in November 2026 **[V, inferred]**. `pgx` 5.9+ and `go-mysql` 1.16 need Go 1.25 or newer **[V]**.

### 2.2 Recording pattern

| Topic | What to do | Notes |
|---|---|---|
| Request body | Replace `r.Body` with a reader that tees into a capped buffer | Cap in memory (for example 1 MiB), beyond that spill to a temp file or keep only length + SHA-256 **[E]** |
| Response body | In `ModifyResponse`, wrap `resp.Body` with a tee `ReadCloser`; finalise the record on EOF/`Close` | Do not read the whole body inside `ModifyResponse`: it breaks streaming and holds everything in memory |
| Streaming (SSE, chunked) | Leave to `ReverseProxy`; record incrementally, stop at the cap | Immediate flushing is already built in **[V]** |
| Compression | MVP: set `Accept-Encoding: identity` on the outbound request and record the original header value | Bodies are then stored plain. Alternative: store raw bytes plus `Content-Encoding` and decode offline (gzip in stdlib, `andybalholm/brotli`, `klauspost/compress` for zstd) **[U for library choice]** |
| Host header | `SetURL` rewrites `Host` to the upstream; set `pr.Out.Host = pr.In.Host` to preserve it | Legacy apps build absolute URLs, redirects and cookie domains from `Host` **[U, standard Go behaviour]** |
| WebSockets | Out of scope: pass through, record only the handshake | Supported for pass-through by `ReverseProxy` **[V]** |
| TLS termination | Prefer to sit **behind** the existing TLS terminator (between nginx/Apache-as-TLS and the app) so the recorder sees plain HTTP. If that is impossible, serve TLS with a user-supplied certificate | Avoids certificate work in the MVP **[E]** |
| PHP-FPM setups | Put the recorder in front of the web server (HTTP), not between nginx and php-fpm | That hop is FastCGI, not HTTP |
| Timeouts | No `WriteTimeout` on the server for streaming routes; generous `ResponseHeaderTimeout` on the transport | The serial gate (section 5) can make requests wait |
| Exchange id | Generate a monotonically increasing id per exchange in the proxy; optionally forward it as a header | Forwarding a header is a (tiny) behaviour change, keep it opt-in |

### 2.3 Alternatives considered

| Tool | Language / licence | Fit |
|---|---|---|
| `httputil.ReverseProxy` | Go stdlib, BSD-style | **Chosen.** |
| Hoverfly | Go, Apache-2.0 **[V licence]** | API simulation tool with its own JSON "simulation" format; oriented to mocking outbound dependencies, not to recording inbound traffic with DB correlation |
| mitmproxy | Python | Excellent reverse-proxy recorder; HAR import/export since 10.1 **[V]**; not embeddable in a Go binary |
| GoReplay | Go, LGPLv3 with commercial "pro" files **[V]** | Passive capture by sniffing; avoid copying code because of the licence |
| `elazarl/goproxy`, `google/martian` | Go | Forward/MITM proxies; not needed for a reverse proxy **[U]** |
| Keploy | Go, Apache-2.0 **[V]** | Closest product. Uses eBPF on Linux to redirect traffic into its own proxy, stores test cases and mocks as YAML **[V]**. Worth reading for ideas, too large to embed |

### 2.4 Storage format

| Format | Used by | Strengths | Weaknesses for this product |
|---|---|---|---|
| HAR 1.2 (JSON) | Browser dev tools, mitmproxy export | Widely supported; binary bodies as base64 with `encoding`; custom fields allowed with `_` prefix **[V]** | HTTP only, no place for SQL; one JSON document, not appendable; tools interpret the spec differently and the W3C standardisation effort was abandoned **[V, mitmproxy blog]** |
| YAML files | go-vcr cassettes, Keploy tests/mocks **[V]** | Human-readable, diff-friendly | Slow and awkward for large/binary bodies; no joins |
| Custom JSON | Hoverfly simulations **[U: format not re-checked]** | Simple | Same as YAML |
| SQLite | (this proposal) | Appendable, transactional, one file, joins between exchanges and statements, queryable by later pipeline stages | Not diff-friendly; needs an export step for humans |

**Recommendation:** SQLite as the system of record, with `export har` (HTTP only, exchange id in a `_archaeo` custom field) and `export jsonl`. Use `modernc.org/sqlite` (v1.62.0, 7 Nov 2026, BSD-3-Clause, CGO-free, bundles SQLite 3.54.1) **[V via pkg.go.dev; the page noted a newer module version may exist]**. Avoid `mattn/go-sqlite3` because it needs CGO **[U]**.

Minimal schema sketch **[E]**:

```
exchange(id, started_ns, finished_ns, method, url, status, req_headers, resp_headers,
         req_body_id, resp_body_id, gate_mode)
body(id, sha256, size, truncated, content BLOB)
db_conn(id, proto, client_addr, opened_ns, closed_ns, db_user, db_name, decode_state)
statement(id, conn_id, started_ns, finished_ns, kind, sql, params_json, param_formats,
          row_count, affected_rows, columns_json, result_sha256, error_code, error_msg)
link(exchange_id, statement_id, method, confidence)   -- the correlation result
```

`result_sha256` (a hash over the row bytes) is cheap to compute while relaying and gives later characterization tests a result fingerprint without storing the rows.

---

## 3. Database wire-protocol proxying

### 3.1 Libraries

**PostgreSQL**

| Library | Version / licence | What it gives | Status |
|---|---|---|---|
| `github.com/jackc/pgx/v5/pgproto3` | pgx **v5.12.0** (30 Oct 2026), MIT **[V]** | Encoder/decoder for protocol v3 messages. `Backend` decodes what a client sends, `Frontend` decodes what a server sends. Built-in `Trace` output similar to libpq's `PQtrace`. README names proxies as an intended use | Actively maintained. Protocol 3.2 support, SCRAM-SHA-256-PLUS and PostgreSQL 18 OAuth were added in v5.9.0 (21 Mar 2026) **[V]**. The old standalone `jackc/pgproto3` v2 module was merged into pgx v5 **[V]** |
| `encr.dev/pkg/pgproxy` (Encore) | v1.58.8 (20 Oct 2026), MPL-2.0 **[V]** | A working proxy built on pgproto3: split startup handling, optional TLS on either side, cancel-request routing, then byte shuffling | Good reference implementation. MPL is file-level copyleft: read it, do not paste from it |
| `jeroenrinzema/psql-wire` | Apache-2.0 **[V]** | Framework for writing PostgreSQL-compatible *servers* | Not a proxy; skip |
| `jackc/pglogrepl` | MIT **[U licence]** | Logical replication client on top of `pgconn` **[V]** | Relevant for section 6 (CDC) |

pgx 5.12.0 fixed two high-severity advisories (one SQL-injection case in simple-protocol batches, one authentication bypass affecting 5.9.0–5.11.0) **[V]**. They concern pgx as a client, not the message codec, but pin 5.12.0 or newer anyway.

**MySQL / MariaDB**

| Library | Version / licence | What it gives | Status |
|---|---|---|---|
| `github.com/go-mysql-org/go-mysql` | **v1.16.0** (13 Jul 2026), MIT **[V]** | `packet` (framing, sequence ids, zlib/zstd compressed protocol), `mysql` (constants, result types), `server` (server-side handshake plus a `Handler` interface), `client`, `replication`/`canal` (binlog) | Active: three releases in 2026, CI on MySQL 9.7 **[V]**. README states the `server` package is meant for building proxies, supports `mysql_native_password`, `caching_sha2_password` and `sha256_password`, and auto-generates TLS certificates **[V]** |
| `vitess.io/vitess/go/mysql` | Apache-2.0 **[V licence]**, release lines up to 25.0 exist in the changelog directory **[V]**, exact latest tag **[U]** | Server-side protocol implementation used by vtgate | Importing the Vitess module drags in a very large dependency graph **[U]** |
| `dolthub/go-mysql-server` | Apache-2.0 **[V]** | A whole SQL engine with a MySQL-compatible server | Not a proxy library; overkill |
| Keploy MySQL integration | Apache-2.0 **[V]** | A recording MySQL proxy inside Keploy | Reference only. Its own README says SSL is not supported and asks users to connect with `useSSL=false&allowPublicKeyRetrieval=true` **[V]**, which confirms the TLS constraint below |

The go-mysql `server.Handler` interface (checked in source **[V]**): `UseDB`, `HandleQuery(query)`, `HandleFieldList`, `HandleStmtPrepare(query)`, `HandleStmtExecute(context, query, args []any)`, `HandleStmtClose`, `HandleOtherCommand`. The library decodes binary prepared-statement arguments for you.

### 3.2 Two proxy designs

| | A. Relay and tap (recommended) | B. Terminate and re-originate |
|---|---|---|
| How | Handle only the first packets (TLS refusal, capability masking), then forward raw bytes both ways; a decoder reads a copy | Proxy is a full server to the app and a full client to the DB (for MySQL: go-mysql `server` + `client`) |
| Credentials | Not needed: authentication passes through | Proxy must know or capture the DB password |
| Transparency | Bytes are unchanged, so results, types, server version and session state are exactly what the DB sent | Proxy re-encodes results; version string, capabilities, charset and type details can differ |
| Failure mode | Decoder error: mark the connection "undecoded", keep relaying | Any library gap becomes an application error |
| Effort | PostgreSQL low, MySQL medium-high (own state machine) | MySQL low-medium (library decodes arguments), PostgreSQL not needed |

For a tool whose promise is "observe without changing behaviour", design A is the right default. Design B with go-mysql is a legitimate shortcut for a MySQL prototype **[E]**.

### 3.3 Work breakdown for design A

**PostgreSQL** (protocol facts from the PostgreSQL protocol documentation on the `master` branch **[V]** unless marked)

1. Startup: read the first packet. `SSLRequest` or `GSSENCRequest`: answer `N` and read again. `CancelRequest`: open a connection to the server, forward it, close. `StartupMessage`: forward and continue.
2. Authentication: relay messages until `ReadyForQuery`. With pgproto3, call `Backend.SetAuthType` from the server's `Authentication*` message so that the overloaded `p` message decodes correctly **[V: method exists]**.
3. Simple protocol: `Query` carries the SQL; the server answers with `RowDescription`, `DataRow`*, `CommandComplete` (tag such as `SELECT 5` or `UPDATE 3`), then `ReadyForQuery`. Several statements in one `Query` give several `CommandComplete` messages.
4. Extended protocol: `Parse` (statement name + SQL + parameter type OIDs), `Bind` (portal, parameter format codes, parameter values), `Execute`, `Sync`. Keep a per-connection map of statement name to SQL; the unnamed statement is overwritten by each `Parse`. Clients may pipeline, so keep a FIFO of pending operations and match responses in order; after an error the server skips to `Sync`.
5. Also handle: `COPY` sub-protocol (relay, count bytes), asynchronous `NoticeResponse`/`NotificationResponse`/`ParameterStatus`, `Terminate`.

Estimated size **[E]**: 400–700 lines of Go plus tests; 2–3 weeks including a test matrix of PostgreSQL 13–18 with libpq, pgx, JDBC, node-postgres and PHP `pdo_pgsql`.

**MySQL / MariaDB** (protocol details **[U]** unless marked; they are stable and documented, but were not re-read in this session)

1. Handshake: read the server greeting, clear the capability bits the tap cannot handle (`CLIENT_SSL`, `CLIENT_COMPRESS`, zstd compression, query attributes, MariaDB extended capabilities), forward it. Read the client's handshake response and remember the effective capability flags. Relay authentication packets (auth switch, "more data") until OK or ERR.
2. `COM_QUERY`: SQL text. Response is OK (affected rows, last insert id, status flags), ERR, a `LOCAL INFILE` request, or a result set **[V: response kinds]**. Count column definitions and rows until the terminator. With `CLIENT_DEPRECATE_EOF` the terminator is an OK packet with header `0xFE` instead of an EOF packet **[V]**. Loop while `SERVER_MORE_RESULTS_EXISTS` is set (stored procedures, multi-statements).
3. `COM_STMT_PREPARE`: remember statement id, SQL and parameter count from the response. `COM_STMT_EXECUTE`: null bitmap, parameter types (sent only when the "new params bound" flag is set, so cache them), binary values. Also `COM_STMT_SEND_LONG_DATA`, `COM_STMT_RESET`, `COM_STMT_FETCH`, `COM_STMT_CLOSE` (no response).
4. Also: packets of 16 MiB or more are split, `COM_CHANGE_USER` restarts authentication, `COM_QUIT`/`COM_STMT_CLOSE`/`COM_STMT_SEND_LONG_DATA` have no reply.

The meaning of a server packet depends on the last command and on negotiated capabilities; nothing is self-describing. That is the main reason MySQL costs more. Estimated size **[E]**: 1,000–1,500 lines; 3–6 weeks including a matrix of MySQL 5.7/8.0/8.4/9.x and MariaDB 10.x/11.x with mysqlnd, mysql2 (Node), Connector/J and go-sql-driver.

Scope hint for PHP: `PDO_MYSQL` uses **emulated prepares by default**, so the server sees plain `COM_QUERY` with values already interpolated **[V, PHP manual]**. Laravel overrides this with `PDO::ATTR_EMULATE_PREPARES => false` in its base connector **[V, framework source]**, so Laravel apps use the binary prepared-statement protocol. Plain-PHP legacy apps are therefore covered by step 2 alone; Laravel needs step 3.

### 3.4 What breaks

| Area | PostgreSQL | MySQL / MariaDB | MVP handling |
|---|---|---|---|
| **TLS app→DB** | Proxy answers `N` to `SSLRequest`; works with `sslmode=disable/allow/prefer`, fails with `require`/`verify-*`. PostgreSQL 17+ clients can use *direct* TLS negotiation (no `SSLRequest`, ALPN required) **[V: documented]** | Clearing `CLIENT_SSL` in the greeting makes clients fall back unless they require TLS **[U]**. MariaDB 11.4+ clients and servers enable TLS and certificate verification by default and verify self-signed certificates with a password-derived fingerprint **[V]**, so a TLS-terminating proxy is detected by design | Document "disable TLS to the proxy for recording". Detect a TLS ClientHello (first byte `0x16`) and print a clear error |
| **TLS termination (post-MVP)** | Terminate TLS toward the app, plaintext or TLS toward the DB. If both sides use TLS, libpq selects SCRAM-SHA-256-PLUS whenever the server offers it and `channel_binding` is not `disable` **[V, libpq source]**; the channel binding then fails because the proxy's certificate differs. Workaround: plaintext on the DB side, or `channel_binding=disable` | Cleartext-password step of `caching_sha2_password` then needs TLS on the DB side as well **[U]** | Post-MVP |
| **Authentication** | `md5` and SCRAM-SHA-256 pass through a plaintext relay unchanged **[U, follows from the protocol]**. GSS/SSPI untested | `mysql_native_password`: pass-through. `caching_sha2_password` (default in 8.4; `mysql_native_password` is deprecated there **[V]**): the cached fast path passes through; the first login after account creation, password change or `FLUSH PRIVILEGES` needs TLS or RSA key exchange **[V]**. Over the plaintext relay the client must allow public-key retrieval (`--get-server-public-key`, `allowPublicKeyRetrieval=true`) **[V for option names]**; otherwise it fails with "Authentication requires secure connection" **[V]** | Preflight check: connect through the proxy once at startup and print the exact client option to change |
| **Compression** | No protocol-level compression in released versions up to 18 **[U]** | zlib/zstd packet compression exists; go-mysql's `packet` layer can decode it **[V]** | Mask the capability bits so it is never negotiated |
| **Multiple result sets** | Several `CommandComplete` per simple query | `SERVER_MORE_RESULTS_EXISTS` loop | Record one statement row per result with an ordinal |
| **Bound parameters in binary format** | Format codes are per parameter; type OIDs may be 0 (server-inferred), then the type is only known from `ParameterDescription` if the client asked | Types are sent on first execute only | Store raw bytes (hex) plus best-effort decoded value; never fail the relay |
| **Cancel requests** | Arrive on a *separate* connection; protocol 3.2 allows longer cancel keys than the 4 bytes of 3.0 **[V]** | `KILL QUERY` is ordinary SQL | Forward verbatim |
| **Unix sockets** | Apps configured with a socket directory bypass any TCP proxy | In MySQL clients the host name `localhost` selects the Unix socket **[U]** | Require `127.0.0.1`/service name; later, listen on a Unix socket path |
| **Host-based access rules** | `pg_hba.conf` sees the proxy's address | Accounts like `'app'@'10.0.0.5'` stop matching | Preflight check and documentation |
| **Server-side effects** | Triggers, functions, cascades are invisible on the wire | Same, plus stored procedures | Section 6 (CDC) |
| **Long-lived replication streams** | `START_REPLICATION` | `COM_BINLOG_DUMP` | Pass through undecoded |

### 3.5 Which database first

**PostgreSQL is the easier first target.**

- Every message carries a type byte and a length, so a decoder can resynchronise and can skip what it does not understand. MySQL packets are only meaningful relative to the previous command and negotiated flags.
- Row counts are in the protocol (`CommandComplete` tag). In MySQL, selected-row counts must be obtained by counting row packets correctly.
- `Parse`/`Bind` state SQL text and parameters explicitly; text-format parameters are common. MySQL binary parameters need cached type information.
- `pgproto3` decodes both directions and is the same code a major driver uses in production; a reference proxy exists (Encore). For MySQL the equivalent passive decoder has to be written.
- One server lineage to test instead of two diverging ones (MySQL vs MariaDB).

The counter-argument is market fit: typical legacy PHP applications use MySQL or MariaDB. Mitigations: keep the tap behind a small protocol-neutral interface from day one, and consider the general-query-log tailer (section 6) as a two-day stopgap that gives MySQL SQL text and connection ids before the MySQL tap exists. **If the first real pilot application is on MySQL, invert the order** and limit the first MySQL milestone to `COM_QUERY` **[E]**.

---

## 4. SQL understanding

Parsing is for the *analysis* stage (statement type, tables read/written). The capture layer should store raw SQL and at most a cheap keyword classification, so a parser failure can never lose a recording.

| Parser | Dialect | Licence | CGO | Maturity and notes |
|---|---|---|---|---|
| `github.com/pganalyze/pg_query_go/v6` | PostgreSQL (embeds the real server parser; sample output reports version 170004, PostgreSQL 17) | BSD-3-Clause, plus the PostgreSQL licence for embedded sources **[V]** | **Yes** **[V]** | **v6.2.5** (30 Sep 2026) **[V]**. That release fixes a heap out-of-bounds bug in `Normalize`, so use 6.2.5 or newer. Highest fidelity. CGO complicates cross-compiling a static binary. No ready-made "list tables" helper seen in the README; walk the protobuf tree **[U]** |
| `github.com/wasilibs/go-pgquery` | Same parser compiled to WebAssembly, run with wazero | MIT **[V]** | **No** **[V]** | Drop-in for pg_query_go, returns the same types, depends on pg_query_go v6.2.5 and Go 1.26 **[V]**. README warns WebAssembly-only bugs are possible. Exact release tag **[U]** |
| `github.com/pingcap/tidb/pkg/parser` | MySQL | Apache-2.0 **[V]** | No | Own Go module inside the TiDB repo; consumed by pseudo-version (commit hash), no semver tags **[V]**. Visitor API. Parser objects are not goroutine-safe **[V]**. Used by sqlc, Bytebase and go-mysql itself **[V]** |
| `vitess.io/vitess/go/vt/sqlparser` | MySQL | Apache-2.0 **[V]** | No | Maintained; API is `sqlparser.New(Options)` then `Parse`; a helper `ExtractAllTables` exists on `main` **[V]**. Importing it means depending on the whole Vitess module **[U: size impact]** |
| `github.com/dolthub/vitess` | MySQL (Dolt's fork) | Apache-2.0 **[U]** | No | Active: go-mysql-server pins a commit dated 6 Nov 2026 **[V]** |
| `github.com/xwb1989/sqlparser` | MySQL (old Vitess extract) | Apache-2.0 **[V]** | No | README still shows Travis CI badges; treat as unmaintained **[U]**. Avoid |
| `github.com/auxten/postgresql-parser` | CockroachDB-flavoured PostgreSQL | **[U]** | No | Derived from CockroachDB v20.1 **[V]**, so it lags modern PostgreSQL syntax |
| `github.com/cockroachdb/cockroachdb-parser` | CockroachDB SQL | Apache-2.0 **[V]** | No | Official snapshot of the Cockroach parser; dialect is close to, not equal to, PostgreSQL |

**Recommendation**

- Capture time: a small hand-written classifier (skip comments, read the leading keyword, special-case `WITH`). Zero dependencies.
- Analysis time, PostgreSQL: `wasilibs/go-pgquery` to keep the binary CGO-free; allow a build tag that switches to `pg_query_go` for speed.
- Analysis time, MySQL: TiDB parser.
- Always keep a fallback path: unparsable statement → `kind=unknown`, raw SQL retained.

Limits no parser removes: tables touched through views, triggers, stored procedures or dynamic SQL are not visible in the statement text; `INSERT ... SELECT` and data-modifying CTEs both read and write.

---

## 5. Request-to-query correlation without touching app code

### 5.1 Options

| Option | Reliability | Needs | Verdict |
|---|---|---|---|
| **(a) Time window, requests serialised** | High when its assumptions hold | Nothing from the app. The HTTP proxy lets one request through at a time; each statement that starts inside the request's window belongs to it | **MVP base** |
| **(b) Connection-lifetime mapping** | High for connection-per-request stacks, useless alone for pools | App opens and closes its DB connection inside the request | **MVP confidence booster**, later the key to limited concurrency |
| **(c) SQL comment tagging** | Exact, works under concurrency | App-side library or config that appends a comment with a trace/request id | Optional "precision mode" |
| **(d) eBPF** | Good for thread-per-request runtimes; weak for async runtimes | Linux, recent kernel, root/privileged, C + verifier expertise | Not for the MVP |

**(a) Details and assumptions.** Both proxies live in one process, so all timestamps come from one monotonic clock; that removes clock-skew problems that log-based approaches have. Assumptions that must hold, each with a mitigation:

| Assumption | When it fails | Mitigation |
|---|---|---|
| All HTTP traffic passes the recorder | Someone hits the app port directly | Do not publish the app's own port during recording |
| Only request handling talks to the DB through the tap | Cron jobs, queue workers, schedulers, health checks | Stop workers while recording, or give them a different DB host/port/user; statements outside any window are stored as `background` |
| No DB work after the response is sent | PHP `fastcgi_finish_request()`, shutdown handlers, async work in Node, inline after-commit jobs | Hold the gate until the DB tap has been idle for a short quiet period; flag statements that arrive after the response as `late` |
| Serialising does not break the app | Long-polling, SSE, WebSockets, a request that waits for another request | Bypass list (by path, `Upgrade` header, or content type) for requests that skip the gate and are recorded as `uncorrelated` |
| One request does not trigger another through the proxy | App calls its own public URL | Detect nested requests while the gate is held; let them through and attribute to the outer exchange |

Two operating modes follow from this: **live gate** (the developer clicks through the app while the proxy serialises transparently) and **serial replay** (record HTTP first, replay it one by one later). Replay needs session/CSRF handling and a database snapshot to be repeatable, so the MVP should ship the live gate only **[E]**.

**(b) Details.** The tap records open and close times per DB connection. Typical lifetimes:

- PHP: a PDO connection lives until the object is destroyed or the script ends; persistent connections are opt-in via `PDO::ATTR_PERSISTENT` **[V]**. So classic PHP-FPM gives one or a few DB connections per request.
- Django: `CONN_MAX_AGE` defaults to 0, which closes the connection at the end of each request **[V]**.
- Node, Java, Go, Rails: pooled, long-lived connections **[U]**; a connection serves many requests, so its lifetime says nothing.

Rule: if a connection's whole lifetime lies inside exactly one request window, the link is `exclusive-conn`. Under serialisation this simply confirms (a). Later it allows relaxing the gate for PHP/Django apps: with concurrency N, links stay unambiguous whenever windows do not overlap for a given connection, and are marked `ambiguous` otherwise.

**(c) Details.** sqlcommenter (now under the OpenTelemetry organisation) appends `key='value'` pairs such as `controller`, `route`, `framework` and W3C `traceparent` to each statement; integrations exist for Django, SQLAlchemy, Flask, psycopg2, Hibernate, Spring, Knex, Sequelize, Express and Ruby **[V]**. Rails ships this itself: `config.active_record.query_log_tags_enabled = true` adds tags, and the default format is sqlcommenter **[V, Rails source on main]**. The recorder can cheaply support this: inject a `traceparent` header on forwarded requests (opt-in), and have the tap parse trailing SQL comments. When a tag is present the link is `tagged` and exact. It breaks the "zero app change" promise, so it is an upgrade path, not the default.

**(d) Details.**

- Keploy: eBPF on Linux redirects outgoing connections into a user-space proxy that parses each protocol; Linux kernel 5.10+; runs as root; on macOS/Windows it either runs inside Docker's Linux VM or falls back to user-space interception with fewer protocols **[V]**. Its source shows that recorded dependency calls carry request/response timestamps and that a "timestamp-based mock filtering strategy" exists next to a newer mapping-based one, with per-process attribution for parallel test workers **[V, read at a glance]**. In other words, the closest existing product also leans on time windows.
- Pixie: kprobes on networking syscalls such as `send`/`recv`, protocol parsing in its node agent, uprobes on TLS libraries to read plaintext; deployed to Kubernetes nodes **[V]**.
- OpenTelemetry eBPF Instrumentation (OBI, formerly Grafana Beyla): captures HTTP and SQL (PostgreSQL, MySQL among others); needs Linux 5.8+ with BTF and root or equivalent capabilities **[V]**. Whether its SQL spans are reliably parented to the inbound HTTP span for a given runtime was not confirmed **[U]**.

eBPF's real advantage is knowing the process/thread behind each syscall, which gives precise correlation under concurrency for process- or thread-per-request servers. Costs: Linux-only, privileged, kernel-version matrix, and a second language and toolchain. Not realistic for a solo MVP; a sensible later experiment is to consume OBI's output rather than write eBPF programs **[E]**.

### 5.2 Recommendation

Ship (a) + (b) and store a confidence label on every link:

| Label | Meaning |
|---|---|
| `tagged` | SQL comment carried the exchange/trace id |
| `exclusive` | Statement started inside the only open request window |
| `exclusive-conn` | As above, and the DB connection lived entirely inside that window |
| `late` | Statement arrived during the quiet period after the response |
| `ambiguous` | More than one candidate window (gate bypassed or concurrency > 1) |
| `background` | No window open |

Test generation should use only `tagged`, `exclusive` and `exclusive-conn` links by default.

---

## 6. Alternatives to a wire proxy

| Approach | Sees | Does not see | Setup friction | Build effort **[E]** | Notes |
|---|---|---|---|---|---|
| **Wire proxy (chosen)** | SQL, parameters, timing, row counts, errors, result metadata, connection lifetimes; same clock as HTTP | Effects of triggers/procedures; anything over Unix sockets or enforced TLS | Change DB host/port in the app | PostgreSQL 2–3 weeks, MySQL 3–6 weeks | Only option that needs no DB privileges |
| **MySQL general query log** | Connects/disconnects and every statement received, including reads; can be switched on at runtime with `SET GLOBAL general_log = 'ON'`; output to file or `mysql.general_log` table **[V]** | Row counts, results, errors; statements that fail to parse are not logged; passwords are rewritten **[V]**. Statements are logged in the order received, which can differ from execution order **[V]** | Needs a privileged DB account; nothing changes in the app | 2–4 days | Table has a `thread_id` column usable as a connection id **[U: column list not on the fetched page]**. Good stopgap for MySQL |
| **MySQL `performance_schema` statement history** | Per statement: thread, SQL text, rows affected/sent/examined, error number, timings **[V]** | SQL text truncated to 1024 bytes unless `performance_schema_max_sql_text_length` is raised at startup; history tables are bounded ring buffers, so polling can miss rows **[V]** | Privileged account; possibly a restart for sizes | 3–5 days | Parameter values of server-side prepared statements **[U]** |
| **PostgreSQL `log_statement = all`** | All statements; for the extended protocol, logging happens at Execute and includes bind parameter values **[V]**. `log_line_prefix` can add process id, session id, application name, millisecond timestamps, transaction id **[V]**; `log_parameter_max_length` (PostgreSQL 13+) controls parameter truncation, default unlimited **[V]** | Row counts and results; statements that fail before Execute need `log_min_error_statement` **[V]** | Superuser/`SET` privilege to change settings; access to the log file or container stdout | 3–5 days | Timestamps come from the DB host clock |
| **`pg_stat_statements`** | Aggregated, normalised statistics per query shape **[U]** | Individual executions, parameters, order | Extension must be preloaded (restart) **[U]** | 1–2 days | Cannot support per-request correlation; useful only for a "hot queries" overview |
| **CDC: MySQL binlog** | Actual row changes, including those made by triggers and procedures. Binary logging is on by default in MySQL 8.0 **[V]**; row format is the default **[U]**. Readable with go-mysql `replication`/`canal` **[V: packages exist]** | Reads (`SELECT`, `SHOW` are never in the binlog **[V]**); which statement caused a change | Replication privilege; MariaDB defaults differ **[U]** | 1–2 weeks | Complementary "effects" channel |
| **CDC: PostgreSQL logical replication** | Row changes via a replication slot; client library `pglogrepl` **[V]** | Reads; old row values unless `REPLICA IDENTITY FULL` **[U]** | `wal_level = logical`, which can only be set at server start (default is `replica`) **[V]**; replication privilege | 1–2 weeks | Restart requirement is real friction on shared environments |
| **Snapshot diff before/after** | Net effect on table contents, independent of protocol | Reads; intermediate states; cost grows with table size | Read access only | 1 week for a naive version | Only meaningful with serialised requests; fine for small dev databases |

**Recommendation.** Keep the wire proxy as the MVP's single observation channel: it is the only one that delivers statements, parameters, row counts and timing on the same clock as HTTP, and it needs no database privileges. Plan CDC as the phase-2 "effects" channel, because it is the only way to see what triggers and procedures changed, and it makes stronger characterization assertions possible ("this request inserted one row into `orders`"). Keep log tailing in mind as a fallback for environments where the proxy cannot be inserted (enforced TLS, Unix sockets).

---

## 7. Packaging for a docker-compose legacy setup

Goal: one added service, one changed variable, easy to remove.

`compose.archaeo.yaml` (used as `docker compose -f compose.yaml -f compose.archaeo.yaml up`):

```yaml
services:
  archaeo:
    image: archaeo:latest            # static Go binary, scratch/distroless base
    command: >
      record
      --http-listen :8080 --http-upstream http://web:80
      --db-listen :5432   --db-upstream db:5432 --db-proto postgres
      --out /data/capture.db
    ports: ["8080:8080"]             # browse here while recording
    volumes: ["./archaeo-data:/data"]
    depends_on: [web, db]
  app:                               # the service that holds the DB settings
    environment:
      DB_HOST: archaeo               # the single change
```

Points to document:

- Inside a Compose network, services reach each other by service name and **container port**; published host ports are irrelevant for service-to-service traffic **[V]**.
- Override files merge sequences such as `ports`; to replace instead of append, Compose provides the `!override` and `!reset` YAML tags **[V]**. This lets the override move the original `8080:80` mapping from `web` to `archaeo`, so the user's URL stays the same. Minimum Compose version for these tags **[U]**.
- **Zero-variable variant:** `networks.<name>.aliases` declares extra hostnames for a service on a network **[V]**. Attach the real `db` service only to a private network shared with `archaeo`, and give `archaeo` the alias `db` on the app's network. The app then needs no change at all. This requires replacing `db`'s network list with `!override` and was not tested **[U]**.
- App config baked into a file (`config.php`, `.env`, `settings.py`) instead of environment variables: mount an edited copy or use the alias variant.
- TLS and auth preflight: on start, `archaeo` should connect to the upstream DB and to itself and report in plain words what to change (for example "client requires TLS: set `sslmode=prefer`" or "add `allowPublicKeyRetrieval=true`").
- Bare-metal LAMP without Docker: run the binary on the same host, point the app at `127.0.0.1:<proxy port>` (not `localhost`, see section 3.4), browse through the HTTP proxy port.
- Keep the binary CGO-free (`modernc.org/sqlite`, `wasilibs/go-pgquery`) so one `GOOS/GOARCH` matrix build yields static binaries for Linux, macOS and Windows.

---

## 8. Risks, ranked by severity

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **Wrong correlation**: background jobs, post-response work, or bypassed gate attribute statements to the wrong request, producing wrong tests | Critical | Medium | Confidence labels; quiet period; `background`/`late` buckets; generate tests only from high-confidence links; show a per-recording ambiguity report |
| 2 | **Recordings contain secrets and personal data** (passwords in bodies, session cookies, PII in SQL parameters) | Critical | High | Header/field redaction rules on by default; recordings git-ignored; clear "not for production traffic" guidance |
| 3 | **Proxy cannot be inserted or changes behaviour**: enforced TLS, MariaDB 11.4+ default TLS verification, `caching_sha2_password` full-auth over plaintext, host-based grants, Unix sockets | High | Medium-High | Preflight diagnostics with exact fix instructions; relay-and-tap design; TLS termination as first post-MVP feature |
| 4 | **MySQL protocol long tail** (capability combinations, MariaDB divergence, prepared-statement state) overruns the schedule | High | High if MySQL is first | PostgreSQL first; MySQL `COM_QUERY` milestone; fail-open decoder; general-log stopgap |
| 5 | **Serial gate side effects**: deadlocks with long-polling/SSE, changed timing, slow page loads with many parallel sub-requests | Medium | Medium | Bypass list; gate timeout with a warning; record static assets without gating |
| 6 | **Undecodable parameters** (binary formats, unknown type OIDs) leave gaps in characterization data | Medium | Medium | Store raw bytes; decode common types; report coverage |
| 7 | **Invisible server-side effects** (triggers, procedures, cascades) make the behaviour map incomplete | Medium | Medium | CDC or snapshot diff in phase 2 |
| 8 | **Memory/disk blow-ups** from large bodies or result sets | Medium | Medium | Streaming tees, caps, hashes instead of content |
| 9 | **CGO creeping in** (pg_query_go, sqlite drivers) breaks the single static binary | Medium-Low | Medium | Pure-Go/WASM choices above; CI builds with `CGO_ENABLED=0` |
| 10 | **Dependency security churn**: pgx 5.12.0 and libpg_query 6.2.5 both shipped security fixes in autumn 2026 **[V]** | Medium-Low | Certain over time | Pin, automate dependency updates |
| 11 | **New protocol features**: PostgreSQL protocol 3.2, direct TLS negotiation, OAuth authentication | Low | Low-Medium | pgproto3 tracks them; detect and report unsupported negotiation |
| 12 | **Licence contamination** from reference code (Encore pgproxy MPL-2.0, GoReplay LGPLv3) | Low | Low | Use as reading material only; all recommended dependencies are MIT, BSD or Apache-2.0 |

Fallback to TypeScript/Node: the HTTP proxy is equally easy there, but I did not verify a Node library that decodes *both* directions of the PostgreSQL protocol (the `pg-protocol` package is client-oriented) or a passive MySQL decoder **[U]**. Go's library situation is a concrete reason to stay with Go.

---

## 9. Sources

Go standard library
- https://raw.githubusercontent.com/golang/go/master/src/net/http/httputil/reverseproxy.go (also https://go.dev/src/net/http/httputil/reverseproxy.go)

PostgreSQL protocol and tooling
- https://raw.githubusercontent.com/postgres/postgres/master/doc/src/sgml/protocol.sgml (rendered: https://www.postgresql.org/docs/current/protocol.html)
- https://raw.githubusercontent.com/postgres/postgres/master/doc/src/sgml/config.sgml (`log_statement`, `log_line_prefix`, `wal_level`)
- https://raw.githubusercontent.com/postgres/postgres/master/src/interfaces/libpq/fe-auth.c and https://raw.githubusercontent.com/postgres/postgres/master/src/backend/libpq/auth-scram.c (SCRAM channel-binding selection)
- https://postgresqlco.nf/doc/en/param/log_parameter_max_length/
- https://github.com/jackc/pgx — `CHANGELOG.md`, `LICENSE`, `go.mod`, `pgproto3/README.md`, `pgproto3/doc.go`, `pgproto3/backend.go` (read via raw.githubusercontent.com)
- https://pkg.go.dev/encr.dev/pkg/pgproxy
- https://github.com/jackc/pglogrepl
- https://github.com/jeroenrinzema/psql-wire

MySQL / MariaDB protocol and tooling
- https://github.com/go-mysql-org/go-mysql — `README.md`, `CHANGELOG.md`, `LICENSE`, `go.mod`, `server/command.go`, `packet/conn.go`
- https://dev.mysql.com/doc/refman/8.4/en/caching-sha2-pluggable-authentication.html
- https://dev.mysql.com/doc/refman/8.4/en/query-log.html
- https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/log-destinations.html
- https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/performance-schema-events-statements-current-table.html
- https://docs.oracle.com/cd/E17952_01/mysql-8.0-en/binary-log.html
- https://dev.mysql.com/doc/dev/mysql-server/8.4.5/page_protocol_com_query_response.html
- https://mariadb.com/docs/server/security/encryption/data-in-transit-encryption/zero-configuration-ssl
- https://github.com/vitessio/vitess — `LICENSE`, `go.mod`, `changelog/README.md`, `go/vt/sqlparser/parser.go`, `go/vt/sqlparser/ast_funcs.go`
- https://github.com/dolthub/go-mysql-server — `README.md`, `LICENSE`, `go.mod`

SQL parsers
- https://github.com/pganalyze/pg_query_go — `README.md`, `CHANGELOG.md`, `LICENSE`, `go.mod`
- https://github.com/wasilibs/go-pgquery — `README.md`, `LICENSE`, `go.mod`
- https://github.com/pingcap/tidb/tree/master/pkg/parser — `README.md`, `docs/quickstart.md`, `go.mod`
- https://github.com/xwb1989/sqlparser
- https://github.com/auxten/postgresql-parser
- https://github.com/cockroachdb/cockroachdb-parser

Correlation and comparable products
- https://github.com/keploy/keploy — `README.md`, `LICENSE`, `go.mod`, `pkg/models/mock.go`, `pkg/service/replay/replay.go`, `pkg/agent/proxy/integrations/mysql/README.md`
- https://keploy.io/docs/keploy-explained/how-keploy-works/
- https://keploy.io/docs/concepts/what-is-keploy-ebpf/
- https://keploy.io/docs/concepts/platform-requirements.md
- https://docs.px.dev/about-pixie/pixie-ebpf/
- https://opentelemetry.io/docs/zero-code/obi/ (fetched through a localized mirror of the same page)
- https://github.com/grafana/beyla
- https://open-telemetry.github.io/opentelemetry-sqlcommenter
- https://raw.githubusercontent.com/rails/rails/main/activerecord/lib/active_record/query_logs.rb
- https://www.php.net/manual/pdo.connections.php
- https://www.php.net/manual/en/ref.pdo-mysql.php
- https://raw.githubusercontent.com/laravel/framework/master/src/Illuminate/Database/Connectors/Connector.php
- https://raw.githubusercontent.com/django/django/main/docs/ref/databases.txt

HTTP recording formats and tools
- https://github.com/ahmadnassri/har-spec/blob/e9e5270/versions/1.2.md
- https://mitmproxy.org/posts/har-support
- https://github.com/dnaeon/go-vcr
- https://github.com/SpectoLabs/hoverfly
- https://github.com/buger/goreplay (`LICENSE.txt`)
- https://pkg.go.dev/modernc.org/sqlite

Docker Compose
- https://docs.docker.com/compose/how-tos/networking/
- https://github.com/docker/docs/blob/main/content/reference/compose-file/services.md (`aliases`)
- https://github.com/docker/docs/blob/main/content/reference/compose-file/merge.md (`!reset`, `!override`)

### Items to confirm with a spike before committing

1. PostgreSQL: relay with `SSLRequest → N` against PostgreSQL 16–18 using libpq (`sslmode=prefer`), pgx, JDBC and PHP `pdo_pgsql`, with SCRAM authentication.
2. MySQL: capability masking in the greeting (TLS, compression, query attributes) accepted by mysqlnd, mysql2 and Connector/J; `caching_sha2_password` first-login behaviour through the relay.
3. Serial gate against a real PHP-FPM app: measure how often statements arrive after the response.
4. Compose alias variant (`!override` on the DB service's networks).
5. `wasilibs/go-pgquery` parse speed and binary size impact.
