# Trowel (working name)

> Put it in front of the web app you inherited. It watches the HTTP requests and the SQL they
> cause, then gives you a map of what every endpoint reads and writes, and golden-master tests
> that fail when the database ends up different. No code changes to the app.

**Status: planning.** No code yet. The project is built in small, strictly sequential steps;
see the roadmap.

## Why

Teams that inherit an undocumented system face two questions before they can change anything:
*what does it actually do?* and *how do I know I did not break it?* Existing record-and-replay
tools answer the second question only, and they do it by mocking the database away. Trowel
keeps the real database in the loop and treats the understanding of the system as a product
of its own.

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

Planned commands for the MVP:

| Command | Purpose |
|---|---|
| `trowel record` | Proxy HTTP and PostgreSQL traffic, store correlated recordings |
| `trowel map` | Generate the behaviour map: endpoints, tables read and written, findings |
| `trowel generate` | Turn a recording into replayable flow tests |
| `trowel calibrate` | Replay twice to detect unstable fields and write them down as rules |
| `trowel replay` | Reset the database, replay flows, assert on responses and database writes |

## Documents

| Document | Content |
|---|---|
| [docs/01-mvp-scope.md](docs/01-mvp-scope.md) | What the MVP is, what it is not, and when it counts as done |
| [docs/02-architecture.md](docs/02-architecture.md) | Components, technologies, data model, repository layout |
| [docs/03-roadmap.md](docs/03-roadmap.md) | The step-by-step plan with a definition of done per step |
| [docs/04-decisions.md](docs/04-decisions.md) | Decision log with the reasoning behind each choice |
| [docs/research/](docs/research/) | Research reports the plan is based on |

## Licence

Apache-2.0. The core described in the MVP scope is and stays open source.
