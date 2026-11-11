# Dependencies

Last checked: 12 November 2026.

A dependency enters `go.mod` in the step that first imports it, because `go mod tidy`
removes anything unused. This file lists what is in use and what is planned, so that
version floors and licences are decided before the step that needs them.

## In use

| Module | Version | Licence | Used for | Since |
|---|---|---|---|---|
| `github.com/goccy/go-yaml` | v1.19.2 (latest tag on the day checked) | MIT | Reading `trowel.yaml`; later flow files | Step 1 |

Everything else in step 1 is the Go standard library, including the command line
(decision D28).

## Toolchain

| Tool | Version | Note |
|---|---|---|
| Go, minimum | 1.24 (`go.mod`) | Raised when a dependency needs it; see decision D30 |
| Go, CI tests and release builds | current stable | `go-version: stable` in the workflow |
| Go, lint job | 1.25.x | The release golangci-lint v2.5.0 was built with |
| golangci-lint | v2.5.0 | Pinned in the workflow; the same version is used locally |
| Docker build image | `golang:1.25-alpine` | Not built outside CI yet |
| Docker runtime image | `alpine:3.22` | Contains `/bin/sh` for the reset hook |
| GitHub Actions | `actions/checkout@v5`, `actions/setup-go@v6`, `golangci/golangci-lint-action@v8` | |

## Planned

Versions are pinned in the step named. Floors come from research report 02 and have not
been re-checked since; re-check them in that step.

| Module | Floor | Licence | Step | Note |
|---|---|---|---|---|
| `modernc.org/sqlite` | pin latest | BSD-3-Clause | 4 | Pure Go, keeps the binary free of CGO |
| `github.com/jackc/pgx/v5` (`pgproto3`, `pgconn`) | 5.12.0 | MIT | 7 | 5.12.0 fixes two security advisories; 5.9 and newer need Go 1.25, which raises the minimum in `go.mod` |
| `github.com/testcontainers/testcontainers-go` | pin latest | MIT | 7 | Integration tests only |
| `github.com/DataDog/go-sqllexer` or `github.com/wasilibs/go-pgquery` | decided by the spike | MIT | 13 | Decision D19 |
| A unified diff library | chosen in the step | MIT or BSD | 21 | Console and report diffs |

## Rules

- Licences: MIT, BSD or Apache-2.0 only.
- No dependency that needs CGO.
- `go.sum` is committed. CI verifies it against the public checksum database when it
  downloads modules.
- The first `go.sum` was produced in a workspace that could reach GitHub but not the Go
  module proxy or checksum database, so its hashes were computed from the tagged source and
  not cross-checked. The first CI run is that cross-check; a mismatch fails the build.
