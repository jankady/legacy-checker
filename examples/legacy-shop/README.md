# legacy-shop

A small shop back end (Node.js, Express, PostgreSQL) written the way inherited systems
often are. It is the application Legacy Checker is developed and tested against, and the
one used in the documentation.

**Its bad habits are deliberate.** Each one is a case the tool must handle. Please do not
fix them.

## Run it

```
docker compose up --build --wait      # app on http://localhost:3000
./scenario.sh                         # 27 requests, responses checked
./scenario.sh --verify                # also checks expected.yaml against the database log
docker compose down -v                # stop and delete the data
```

The scenario asserts ids of created rows, so it needs a freshly seeded database: run
`docker compose down -v` before starting again. `./scenario.sh` needs Node.js 22 or newer
on your machine.

Sign-in for the browser pages and the API: `demo@example.com` / `demo1234`.

## What is in it, and why

| Habit | Where | What it tests |
|---|---|---|
| Connection pool with no error handler | `pool` in `app/server.js` | The process exits when its database connections are dropped; the Compose restart policy brings it back. A database reset must wait for that |
| Login that rotates the session id | `POST /login` | One browser, two session ids: a test generator must keep it as one client |
| Form with a CSRF token in a hidden input | `GET /account`, `POST /account` | Values that must be captured from one response and sent in the next request |
| Token login | `POST /api/login` | The same for a bearer token in JSON |
| Query without parameters and queries with parameters | `GET /api/products` and the rest | Simple and extended PostgreSQL protocol |
| Upsert | `PUT /api/products/{id}/rating`, `POST /api/cart/items` | One statement that inserts the first time and updates the second |
| Write inside a CTE | `POST /api/cart/clear` | One statement, two tables written, one command tag |
| Transaction over several tables with a savepoint | `POST /api/checkout` | Transaction tracking; a coupon used twice rolls back only the savepoint |
| Write, then check, then roll back | `POST /api/orders/{id}/cancel` | Statements that were sent but must not count as writes |
| A GET that writes | `GET /api/orders/{id}` (audit log), `GET /login` (session) | The finding "this GET changes data" |
| N+1 queries | `GET /api/orders` | The finding "same query repeated in one request" |
| Write after the response | `GET /api/products/{id}` updates `view_count` 30 ms later | Statements that arrive after the response was sent |
| Timer inside the web process | `ENABLE_CLEANUP_JOB=1` | Statements that no request caused |
| Trigger | `orders` → `order_events` | A write the application never sends |
| Values that change on every call | `GET /api/status`, "rendered in N ms" on HTML pages | Timestamp, UUID, epoch milliseconds, random number, timing text |

## Files

| Path | Content |
|---|---|
| `app/` | The application: one file, `server.js` |
| `db/init/` | Schema and seed data, loaded when the database container is first created |
| `compose.yaml` | Database and app. The database logs every statement; that log is the ground truth |
| `scenario/scenario.mjs` | The scripted scenario |
| `scenario/verify-expected.mjs` | Checks `expected.yaml` against the scenario and the database log |
| `expected.yaml` | Per request: the statements the database receives. Per endpoint: tables read and written. Legacy Checker's output is compared with this file |

## Changing the application

If you change `app/server.js` or the scenario, update `expected.yaml` in the same commit.
`./scenario.sh --verify` tells you what differs, and
`node scenario/verify-expected.mjs --log-cmd "docker compose logs --no-log-prefix db" --print`
prints the statements the database received, as YAML. The `endpoints` and `findings`
sections are written by hand.
