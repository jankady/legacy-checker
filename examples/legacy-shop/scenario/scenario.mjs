// The scripted scenario for legacy-shop: every request the demo and the tests
// rely on, in a fixed order, one at a time.
//
//   node scenario.mjs [--base-url http://localhost:3000] [--pause-ms 0]
//
// Needs Node 22 or newer and nothing else. It expects a freshly seeded
// database: ids of created rows are asserted.

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo1234';

// Each step: id, endpoint (method plus path template, the key used in
// expected.yaml), the request, the expected status, and optionally what to
// remember from the response for later steps.
export const steps = [
  { id: 'r01', endpoint: 'GET /healthz', path: '/healthz', status: 200 },
  { id: 'r02', endpoint: 'GET /static/style.css', path: '/static/style.css', status: 200 },
  {
    id: 'r03', endpoint: 'GET /api/status', path: '/api/status', status: 200,
    check: (ctx, body) => {
      for (const key of ['db_time', 'request_id', 'epoch_ms', 'nonce', 'note']) need(key in body, `status has ${key}`);
    },
  },

  // Browser session: anonymous session, login that rotates the session id,
  // a form protected by a CSRF token.
  {
    id: 'r04', endpoint: 'GET /login', path: '/login', client: 'browser', status: 200,
    check: (ctx, body) => {
      ctx.anonymousSid = ctx.jar.browser.get('sid');
      ctx.csrf = hiddenInput(body, 'csrf');
    },
  },
  {
    id: 'r05', endpoint: 'POST /login', method: 'POST', path: '/login', client: 'browser', status: 302,
    form: (ctx) => ({ csrf: ctx.csrf, email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    check: (ctx, body, res) => {
      need(res.headers.get('location') === '/account', 'login redirects to /account');
      need(ctx.jar.browser.get('sid') !== ctx.anonymousSid, 'login issues a new session id');
    },
  },
  {
    id: 'r06', endpoint: 'GET /account', path: '/account', client: 'browser', status: 200,
    check: (ctx, body) => {
      need(body.includes('Demo User'), 'account page shows the display name');
      ctx.csrf = hiddenInput(body, 'csrf');
    },
  },
  {
    id: 'r07', endpoint: 'POST /account', method: 'POST', path: '/account', client: 'browser', status: 302,
    form: (ctx) => ({ csrf: ctx.csrf, display_name: 'Demo Renamed' }),
  },
  {
    id: 'r08', endpoint: 'GET /account', path: '/account', client: 'browser', status: 200,
    check: (ctx, body) => need(body.includes('Demo Renamed'), 'account page shows the new display name'),
  },

  // API client with a bearer token.
  {
    id: 'r09', endpoint: 'POST /api/login', method: 'POST', path: '/api/login', status: 200,
    json: () => ({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    check: (ctx, body) => { ctx.token = body.token; need(ctx.token, 'login returns a token'); },
  },
  {
    id: 'r10', endpoint: 'GET /api/products', path: '/api/products', status: 200,
    check: (ctx, body) => need(body.products.length === 5, 'five products'),
  },
  // Answers first, then updates view_count about 30 ms later.
  { id: 'r11', endpoint: 'GET /api/products/{id}', path: '/api/products/2', status: 200 },
  // Upsert: the first call inserts, the second updates.
  { id: 'r12', endpoint: 'PUT /api/products/{id}/rating', method: 'PUT', path: '/api/products/2/rating', auth: true, status: 200, json: () => ({ rating: 4 }) },
  { id: 'r13', endpoint: 'PUT /api/products/{id}/rating', method: 'PUT', path: '/api/products/2/rating', auth: true, status: 200, json: () => ({ rating: 5 }) },

  { id: 'r14', endpoint: 'POST /api/cart/items', method: 'POST', path: '/api/cart/items', auth: true, status: 201, json: () => ({ product_id: 2, quantity: 1 }) },
  { id: 'r15', endpoint: 'POST /api/cart/items', method: 'POST', path: '/api/cart/items', auth: true, status: 201, json: () => ({ product_id: 3, quantity: 2 }) },
  {
    id: 'r16', endpoint: 'GET /api/cart', path: '/api/cart', auth: true, status: 200,
    check: (ctx, body) => need(body.items.length === 2, 'two items in the cart'),
  },
  // Transaction over orders, order_items, products, coupon_redemptions and
  // cart_items; a trigger adds a row to order_events.
  {
    id: 'r17', endpoint: 'POST /api/checkout', method: 'POST', path: '/api/checkout', auth: true, status: 201,
    json: () => ({ coupon: 'WELCOME10' }),
    check: (ctx, body) => {
      need(body.order_id === 2, 'first new order has id 2');
      need(body.coupon_applied === true, 'coupon applied');
      need(body.total_cents === 17910, 'total is 19900 minus 10 %');
      ctx.firstOrder = body.order_id;
    },
  },
  // A GET that writes to audit_log.
  { id: 'r18', endpoint: 'GET /api/orders/{id}', path: (ctx) => `/api/orders/${ctx.firstOrder}`, auth: true, status: 200 },
  // N+1: one query for the list and one per order.
  {
    id: 'r19', endpoint: 'GET /api/orders', path: '/api/orders', auth: true, status: 200,
    check: (ctx, body) => need(body.orders.length === 2, 'two orders'),
  },
  // Writes, then finds the order has shipped, then rolls back.
  { id: 'r20', endpoint: 'POST /api/orders/{id}/cancel', method: 'POST', path: '/api/orders/1/cancel', auth: true, status: 409 },

  { id: 'r21', endpoint: 'POST /api/cart/items', method: 'POST', path: '/api/cart/items', auth: true, status: 201, json: () => ({ product_id: 1, quantity: 1 }) },
  // Same coupon again: the insert fails and only the savepoint is rolled back.
  {
    id: 'r22', endpoint: 'POST /api/checkout', method: 'POST', path: '/api/checkout', auth: true, status: 201,
    json: () => ({ coupon: 'WELCOME10' }),
    check: (ctx, body) => {
      need(body.order_id === 3, 'second new order has id 3');
      need(body.coupon_applied === false, 'coupon refused the second time');
      need(body.total_cents === 8900, 'total without discount');
      ctx.secondOrder = body.order_id;
    },
  },
  { id: 'r23', endpoint: 'POST /api/orders/{id}/cancel', method: 'POST', path: (ctx) => `/api/orders/${ctx.secondOrder}/cancel`, auth: true, status: 200 },

  { id: 'r24', endpoint: 'POST /api/cart/items', method: 'POST', path: '/api/cart/items', auth: true, status: 201, json: () => ({ product_id: 4, quantity: 3 }) },
  // One statement deletes from cart_items and inserts into cart_archive.
  {
    id: 'r25', endpoint: 'POST /api/cart/clear', method: 'POST', path: '/api/cart/clear', auth: true, status: 200,
    check: (ctx, body) => need(body.archived === 1, 'one row archived'),
  },
  // Empty cart: transaction opened and rolled back without a write.
  { id: 'r26', endpoint: 'POST /api/checkout', method: 'POST', path: '/api/checkout', auth: true, status: 400, json: () => ({}) },
  // Not found: no audit_log row this time.
  { id: 'r27', endpoint: 'GET /api/orders/{id}', path: '/api/orders/999', auth: true, status: 404 },
];

function need(condition, what) {
  if (!condition) throw new Error(`check failed: ${what}`);
}

function hiddenInput(html, name) {
  const m = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  need(m, `page has a hidden input "${name}"`);
  return m[1];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the scenario. onStep, when given, is awaited after every request and
// its pause; verify-expected.mjs uses it to read the database log.
export async function runScenario({ baseUrl, pauseMs = 0, onStep = null, log = console.log }) {
  const ctx = { jar: {} };

  for (const step of steps) {
    const method = step.method || 'GET';
    const path = typeof step.path === 'function' ? step.path(ctx) : step.path;
    const headers = {};
    let body;

    if (step.json) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(step.json(ctx));
    } else if (step.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(step.form(ctx)).toString();
    }
    if (step.auth) headers.authorization = `Bearer ${ctx.token}`;

    const jar = step.client ? (ctx.jar[step.client] ||= new Map()) : null;
    if (jar && jar.size > 0) {
      headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const res = await fetch(baseUrl + path, { method, headers, body, redirect: 'manual' });
    const text = await res.text();

    if (jar) {
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const eq = pair.indexOf('=');
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    }

    try {
      need(res.status === step.status, `status is ${step.status} (got ${res.status}: ${text.slice(0, 200)})`);
      if (step.check) {
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        step.check(ctx, isJson ? JSON.parse(text) : text, res);
      }
    } catch (err) {
      throw new Error(`${step.id} ${method} ${path}: ${err.message}`);
    }

    if (pauseMs > 0) await sleep(pauseMs);
    if (onStep) await onStep(step, { method, path, status: res.status });
    log(`ok  ${step.id}  ${String(res.status).padEnd(3)}  ${method} ${path}`);
  }
}

export function parseArgs(argv, defaults) {
  const opts = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(name in opts)) throw new Error(`unknown option ${argv[i]}`);
    opts[name] = typeof opts[name] === 'boolean' ? true : argv[++i];
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2), { baseUrl: 'http://localhost:3000', pauseMs: '0' });
  runScenario({ baseUrl: opts.baseUrl, pauseMs: Number(opts.pauseMs) })
    .then(() => console.log(`\nscenario passed: ${steps.length} requests`))
    .catch((err) => { console.error(`\nscenario FAILED: ${err.message}`); process.exit(1); });
}
