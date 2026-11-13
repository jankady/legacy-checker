# Legacy Checker

> Put Legacy Checker between the web app you inherited and its PostgreSQL database. Click through a
> feature once and you get a committed map of which tables each endpoint you touched reads
> and writes, and replay tests against the real database that fail when it ends up
> different. No SDK, no agent, no code change.

**Status: step 2 of 35.** The scaffold and the demo application exist; the tool does not
record anything yet. The project is built in small, strictly sequential steps; see the roadmap.

## Why

Teams that inherit an undocumented system face two questions before they can change
anything: *what does it actually do?* and *how do I know I did not break it?* Existing
record-and-replay tools concentrate on the second question, and most of them answer it by
mocking the database away. Legacy Checker keeps the real database in the loop and treats the
understanding of the system as a product of its own.

## Limits you should know first

- PostgreSQL only, version 13 or newer. MySQL is planned after the first two releases.
- Runs against a non-production copy of the app; requests are processed one at a time.
- The connection between app and database must be plain TCP while Legacy Checker is in between.
- Replay sends real requests and resets the database; it needs an admin role that owns it.
- The map lists what was observed, not everything the app can do.

The full list is in [docs/01-mvp-scope.md](docs/01-mvp-scope.md), section 8.

## How it works

```
browser / script ──▶ HTTP recorder ──▶ your app ──▶ DB tap ──▶ PostgreSQL
                          │                           │
                          └────── capture store ──────┘
                                       │
              ┌────────────────────────┼─────────────────────────┐
              ▼                        ▼                         ▼
       behaviour map            flow tests (YAML)          replay + diff
       (Markdown + JSON)        golden masters             against the real app
```

| Command | Release | Purpose |
|---|---|---|
| `legacy-checker init` | 0.1 | Write a starter config and Compose override |
| `legacy-checker record` | 0.1 | Proxy HTTP and PostgreSQL traffic, store correlated recordings |
| `legacy-checker inspect` | 0.1 | Look into a recording, redacted |
| `legacy-checker map` | 0.1 | Generate the behaviour map: endpoints, tables read and written, findings |
| `legacy-checker snapshot` | 0.2 | Manage named database snapshots |
| `legacy-checker generate` | 0.2 | Turn a recording into a replayable flow test |
| `legacy-checker calibrate` | 0.2 | Replay twice to detect unstable fields and write them down as rules |
| `legacy-checker replay` | 0.2 | Reset the database, replay flows, assert on responses and database state |

## Documents

| Document | Content |
|---|---|
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | What the MVP is, what it is not, when it counts as done, and why it may not work |
| [docs/02-architecture.md](docs/02-architecture.md) | Components, technologies, data model, repository layout |
| [docs/03-roadmap.md](docs/03-roadmap.md) | 35 sequential steps with a definition of done each |
| [docs/04-decisions.md](docs/04-decisions.md) | Decision log with the reasoning behind each choice |
| [docs/dependencies.md](docs/dependencies.md) | Dependencies and toolchain versions, in use and planned |
| [docs/research/](docs/research/) | Research reports the plan is based on |
| [docs/reviews/](docs/reviews/) | Independent technical and product reviews of the first draft of the plan |

## Development

```
make build     # bin/legacy-checker
make check     # lint, tests, tidy go.mod
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how work is organised and
[SECURITY.md](SECURITY.md) for how recordings are handled and how to report a problem.

## Licence

Apache-2.0. Everything in the MVP scope is and stays open source. Legacy Checker sends no telemetry.
