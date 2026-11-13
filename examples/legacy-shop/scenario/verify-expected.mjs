// Checks that ../expected.yaml tells the truth about legacy-shop.
//
// Static check (always): every scenario request has an entry, in the same
// order, with the same endpoint and status; every endpoint is described.
//
// Live check (with --log-cmd): runs the scenario and, after every request,
// reads the PostgreSQL statement log to compare what the database actually
// received with the statements listed for that request.
//
//   node verify-expected.mjs
//   node verify-expected.mjs --base-url http://localhost:3000 \
//        --log-cmd "docker compose logs --no-log-prefix db"
//   node verify-expected.mjs ... --print     # print observed statements as YAML
//
// The database must log with log_statement=all and a log_line_prefix that
// starts with a timestamp (see ../compose.yaml).

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { parseArgs, runScenario, steps } from './scenario.mjs';

const opts = parseArgs(process.argv.slice(2), {
  baseUrl: 'http://localhost:3000',
  logCmd: '',
  pauseMs: '250',
  print: false,
});

const expectedPath = fileURLToPath(new URL('../expected.yaml', import.meta.url));
const expected = parse(readFileSync(expectedPath, 'utf8'));
const problems = [];

// ------------------------------------------------------------ static check

const byId = new Map(expected.requests.map((r) => [r.id, r]));
if (!opts.print) {
  if (expected.requests.length !== steps.length) {
    problems.push(`expected.yaml lists ${expected.requests.length} requests, the scenario has ${steps.length}`);
  }
  steps.forEach((step, i) => {
    const entry = expected.requests[i];
    if (!entry || entry.id !== step.id) {
      problems.push(`request ${i + 1}: scenario has ${step.id}, expected.yaml has ${entry ? entry.id : 'nothing'}`);
      return;
    }
    if (entry.endpoint !== step.endpoint) problems.push(`${step.id}: endpoint "${entry.endpoint}" should be "${step.endpoint}"`);
    if (entry.status !== step.status) problems.push(`${step.id}: status ${entry.status} should be ${step.status}`);
    if (!(step.endpoint in expected.endpoints)) problems.push(`${step.id}: endpoint "${step.endpoint}" is not described under endpoints`);
  });
  const used = new Set(steps.map((s) => s.endpoint));
  for (const endpoint of Object.keys(expected.endpoints)) {
    if (!used.has(endpoint)) problems.push(`endpoint "${endpoint}" is described but never requested`);
  }
}

// ------------------------------------------------------------ live check

const normalise = (sql) => sql.replace(/\s+/g, ' ').trim();

// Returns every statement in the log, in order. An entry starts with the
// timestamp of log_line_prefix; other lines continue the previous entry.
function readStatements() {
  const out = execSync(opts.logCmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = [];
  for (const line of out.split('\n')) {
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(line)) entries.push(line);
    else if (entries.length > 0) entries[entries.length - 1] += '\n' + line;
  }
  const statements = [];
  for (const entry of entries) {
    const m = /\] LOG:\s+(?:statement|execute [^:]+): ([\s\S]*)$/.exec(entry);
    if (m) statements.push(normalise(m[1]));
  }
  return statements;
}

if (opts.logCmd) {
  let seen = readStatements().length;
  const observed = [];

  await runScenario({
    baseUrl: opts.baseUrl,
    pauseMs: Number(opts.pauseMs),
    log: opts.print ? () => {} : console.log,
    onStep: (step) => {
      const all = readStatements();
      const fresh = all.slice(seen);
      seen = all.length;
      observed.push({ step, statements: fresh });

      if (opts.print) return;
      const entry = byId.get(step.id);
      if (!entry) return;
      const want = [...(entry.statements || []), ...(entry.late || [])].map(normalise);
      if (fresh.length !== want.length) {
        problems.push(`${step.id}: database received ${fresh.length} statements, expected.yaml lists ${want.length}\n      received: ${JSON.stringify(fresh)}`);
        return;
      }
      want.forEach((prefix, i) => {
        if (!fresh[i].startsWith(prefix)) {
          problems.push(`${step.id}: statement ${i + 1} is\n      ${fresh[i]}\n    expected.yaml says\n      ${prefix}`);
        }
      });
    },
  }).catch((err) => { problems.push(`scenario failed: ${err.message}`); });

  if (opts.print) {
    for (const { step, statements } of observed) {
      console.log(`  - id: ${step.id}\n    endpoint: ${step.endpoint}\n    status: ${step.status}`);
      console.log(statements.length === 0 ? '    statements: []' : '    statements:');
      for (const s of statements) console.log(`      - ${JSON.stringify(s)}`);
    }
  }
}

// ------------------------------------------------------------ result

if (problems.length > 0) {
  console.error(`\nexpected.yaml does not match (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (!opts.print) {
  console.log(opts.logCmd
    ? '\nexpected.yaml matches the scenario and the database log'
    : '\nexpected.yaml matches the scenario (static check only; pass --log-cmd for the live check)');
}
