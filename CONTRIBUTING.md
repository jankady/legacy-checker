# Contributing

The project is built in small, strictly sequential steps. Read
[docs/03-roadmap.md](docs/03-roadmap.md) first; its rules apply to every change.

## How work is organised

- **One step, one pull request.** A step is started only after the previous one is merged
  with every line of its "Done when" list met and CI green.
- **Documents before code.** A change of scope or of a technical choice is written into
  [docs/01-mvp-scope.md](docs/01-mvp-scope.md) or [docs/04-decisions.md](docs/04-decisions.md)
  first, in the same pull request.
- **`main` is always releasable.** A command that is not complete is marked `experimental`
  in its help text.
- Bug reports and questions are welcome as issues at any time. Feature work outside the
  current roadmap step will usually wait.

## Development

Requirements: Go (the minimum version is in `go.mod`), `make`, and
[golangci-lint](https://golangci-lint.run) v2 for linting. Docker is needed only for the
image and, from step 2 on, for integration tests.

| Command | What it does |
|---|---|
| `make build` | Build `bin/legacy-checker` for your machine |
| `make test` | Run unit tests |
| `make lint` | Run the linters |
| `make fmt` | Format the code |
| `make cross` | Build all six release targets into `dist/` |
| `make image` | Build the Docker image `legacy-checker:dev` |
| `make check` | Lint, test, and verify that `go.mod` is tidy |

## Conventions

- **No CGO.** The binary must build with `CGO_ENABLED=0`. Do not add a dependency that
  needs a C compiler.
- **Few dependencies.** Every new dependency is listed in
  [docs/dependencies.md](docs/dependencies.md) with its licence and the reason it is needed.
  Licences must be MIT, BSD or Apache-2.0.
- **Tests come with the code.** Table-driven unit tests next to the code; golden files under
  `testdata/`; integration tests use a real PostgreSQL.
- **Errors tell the user what to do.** A message names the setting or the command that
  fixes the problem.
- **No telemetry, no network connections** other than the upstreams the user configured.
- **Never commit recordings.** `.legacy-checker/` holds raw captures with credentials and personal
  data and is git-ignored.

## Commit messages

Imperative subject line of at most 72 characters, a blank line, then what changed and why.
Reference the roadmap step, for example `Step 4: capture store`.

## Licence

By contributing you agree that your contribution is licensed under Apache-2.0.
