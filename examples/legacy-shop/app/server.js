// legacy-shop: a small shop back end written the way inherited systems often
// are. One file, SQL inline, a few questionable habits. The habits are on
// purpose: each one is a case Legacy Checker has to handle. They are listed
// in ../README.md. Do not "fix" them.

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;

// No pool.on('error') handler. When the database drops idle connections the
// process dies and the supervisor restarts it, like many real apps.
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: process.env.DATABASE_PORT || 5432,
  user: process.env.DATABASE_USER || 'shop',
  password: process.env.DATABASE_PASSWORD || 'shop',
  database: process.env.DATABASE_NAME || 'shop',
  max: 5,
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------- helpers

function hashPassword(salt, password) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function page(title, body, started) {
  return `<!doctype html>
<html>
<head><title>${escapeHtml(title)} - legacy-shop</title><link rel="stylesheet" href="/static/style.css"></head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
<footer>rendered in ${Date.now() - started} ms</footer>
</body>
</html>
`;
}

// Express 4 does not catch rejected promises.
function wrap(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// Browser session from the "sid" cookie.
async function loadSession(req) {
  const sid = readCookie(req, 'sid');
  if (!sid) return null;
  const { rows } = await pool.query(
    'SELECT s.id, s.user_id, s.csrf_token, u.email, u.display_name FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()',
    [sid]
  );
  return rows[0] || null;
}

// API user from the bearer token.
const requireToken = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  const { rows } = await pool.query(
    'SELECT u.id, u.email, u.display_name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = $1 AND t.expires_at > now()',
    [token]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'invalid token' });
  req.user = rows[0];
  next();
});

// ---------------------------------------------------------------- misc

app.get('/healthz', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.type('text/plain').send('ok');
}));

// Every field here changes on every call.
app.get('/api/status', wrap(async (req, res) => {
  const started = Date.now();
  const { rows } = await pool.query('SELECT now() AS db_time');
  res.json({
    status: 'ok',
    db_time: rows[0].db_time,
    request_id: crypto.randomUUID(),
    epoch_ms: Date.now(),
    nonce: crypto.randomInt(100000, 999999),
    note: `rendered in ${Date.now() - started} ms`,
  });
}));

// ---------------------------------------------------------------- browser pages

app.get('/login', wrap(async (req, res) => {
  const started = Date.now();
  let session = await loadSession(req);
  if (!session) {
    session = { id: randomToken(), csrf_token: randomToken() };
    await pool.query(
      "INSERT INTO sessions (id, csrf_token, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [session.id, session.csrf_token]
    );
    res.cookie('sid', session.id, { httpOnly: true });
  }
  res.send(page('Sign in', `
<form method="post" action="/login">
  <input type="hidden" name="csrf" value="${session.csrf_token}">
  <label>E-mail <input type="email" name="email"></label>
  <label>Password <input type="password" name="password"></label>
  <button type="submit">Sign in</button>
</form>`, started));
}));

app.post('/login', wrap(async (req, res) => {
  const session = await loadSession(req);
  if (!session || req.body.csrf !== session.csrf_token) {
    return res.status(403).send('bad csrf token');
  }
  const { rows } = await pool.query('SELECT id, password_hash, salt FROM users WHERE email = $1', [req.body.email]);
  const user = rows[0];
  if (!user || hashPassword(user.salt, req.body.password || '') !== user.password_hash) {
    return res.status(401).send('wrong e-mail or password');
  }
  // Session fixation defence: the anonymous session is thrown away and a new
  // id is issued. One browser, two session ids.
  await pool.query('DELETE FROM sessions WHERE id = $1', [session.id]);
  const sid = randomToken();
  await pool.query(
    "INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')",
    [sid, user.id, randomToken()]
  );
  res.cookie('sid', sid, { httpOnly: true });
  res.redirect('/account');
}));

app.get('/account', wrap(async (req, res) => {
  const started = Date.now();
  const session = await loadSession(req);
  if (!session || !session.user_id) return res.redirect('/login');
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM orders WHERE user_id = $1', [session.user_id]);
  res.send(page('Your account', `
<p>Signed in as <strong>${escapeHtml(session.email)}</strong>. Orders so far: ${rows[0].n}.</p>
<form method="post" action="/account">
  <input type="hidden" name="csrf" value="${session.csrf_token}">
  <label>Display name <input type="text" name="display_name" value="${escapeHtml(session.display_name)}"></label>
  <button type="submit">Save</button>
</form>`, started));
}));

app.post('/account', wrap(async (req, res) => {
  const session = await loadSession(req);
  if (!session || !session.user_id) return res.redirect('/login');
  if (req.body.csrf !== session.csrf_token) return res.status(403).send('bad csrf token');
  await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [req.body.display_name, session.user_id]);
  res.redirect('/account');
}));

// ---------------------------------------------------------------- API: auth, catalogue

app.post('/api/login', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, password_hash, salt FROM users WHERE email = $1', [req.body.email]);
  const user = rows[0];
  if (!user || hashPassword(user.salt, req.body.password || '') !== user.password_hash) {
    return res.status(401).json({ error: 'wrong e-mail or password' });
  }
  const token = randomToken();
  const inserted = await pool.query(
    "INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING expires_at",
    [token, user.id]
  );
  res.json({ token, expires_at: inserted.rows[0].expires_at });
}));

app.get('/api/products', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, price_cents, stock FROM products ORDER BY id');
  res.json({ products: rows });
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, price_cents, stock, view_count FROM products WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'no such product' });
  res.json(rows[0]);
  // "Fire and forget" statistics: this write happens after the response has
  // been sent.
  setTimeout(() => {
    pool.query('UPDATE products SET view_count = view_count + 1 WHERE id = $1', [req.params.id]).catch(() => {});
  }, 30);
}));

app.put('/api/products/:id/rating', requireToken, wrap(async (req, res) => {
  await pool.query(
    'INSERT INTO product_ratings (user_id, product_id, rating) VALUES ($1, $2, $3) ON CONFLICT (user_id, product_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()',
    [req.user.id, req.params.id, req.body.rating]
  );
  res.json({ product_id: Number(req.params.id), rating: req.body.rating });
}));

// ---------------------------------------------------------------- API: cart

app.post('/api/cart/items', requireToken, wrap(async (req, res) => {
  await pool.query(
    'INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now()',
    [req.user.id]
  );
  const { rows } = await pool.query(
    'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity RETURNING id, quantity',
    [req.user.id, req.body.product_id, req.body.quantity]
  );
  res.status(201).json({ item_id: rows[0].id, product_id: req.body.product_id, quantity: rows[0].quantity });
}));

app.get('/api/cart', requireToken, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT ci.product_id, p.name, ci.quantity, p.price_cents FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = $1 ORDER BY ci.id',
    [req.user.id]
  );
  res.json({ items: rows });
}));

// One statement that deletes from one table and inserts into another.
app.post('/api/cart/clear', requireToken, wrap(async (req, res) => {
  const result = await pool.query(
    'WITH removed AS (DELETE FROM cart_items WHERE user_id = $1 RETURNING user_id, product_id, quantity) INSERT INTO cart_archive (user_id, product_id, quantity) SELECT user_id, product_id, quantity FROM removed',
    [req.user.id]
  );
  res.json({ archived: result.rowCount });
}));

// ---------------------------------------------------------------- API: orders

app.post('/api/checkout', requireToken, wrap(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await client.query(
      'SELECT ci.product_id, ci.quantity, p.price_cents FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = $1 ORDER BY ci.id FOR UPDATE OF p',
      [req.user.id]
    );
    if (cart.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'cart is empty' });
    }
    let total = cart.rows.reduce((sum, r) => sum + r.quantity * r.price_cents, 0);

    // A trigger on orders also writes to order_events here.
    const order = await client.query(
      "INSERT INTO orders (user_id, status, total_cents) VALUES ($1, 'new', $2) RETURNING id, public_id, created_at",
      [req.user.id, total]
    );
    const orderId = order.rows[0].id;
    await client.query(
      'INSERT INTO order_items (order_id, product_id, quantity, price_cents) SELECT $1, ci.product_id, ci.quantity, p.price_cents FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = $2',
      [orderId, req.user.id]
    );
    await client.query(
      'UPDATE products p SET stock = p.stock - ci.quantity FROM cart_items ci WHERE ci.product_id = p.id AND ci.user_id = $1',
      [req.user.id]
    );

    // A coupon can be used once per user. A second use violates the primary
    // key; the savepoint keeps the rest of the order alive.
    let couponApplied = false;
    if (req.body.coupon) {
      await client.query('SAVEPOINT coupon');
      try {
        await client.query(
          'INSERT INTO coupon_redemptions (coupon_code, user_id, order_id) VALUES ($1, $2, $3)',
          [req.body.coupon, req.user.id, orderId]
        );
        const discounted = await client.query(
          'UPDATE orders SET total_cents = total_cents - (total_cents * (SELECT percent_off FROM coupons WHERE code = $1) / 100) WHERE id = $2 RETURNING total_cents',
          [req.body.coupon, orderId]
        );
        total = discounted.rows[0].total_cents;
        await client.query('RELEASE SAVEPOINT coupon');
        couponApplied = true;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT coupon');
      }
    }

    await client.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({
      order_id: orderId,
      public_id: order.rows[0].public_id,
      created_at: order.rows[0].created_at,
      total_cents: total,
      coupon_applied: couponApplied,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// The N+1 classic: one query for the list, one more per order.
app.get('/api/orders', requireToken, wrap(async (req, res) => {
  const { rows: orders } = await pool.query(
    'SELECT id, status, total_cents FROM orders WHERE user_id = $1 ORDER BY id',
    [req.user.id]
  );
  for (const order of orders) {
    const { rows } = await pool.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY id',
      [order.id]
    );
    order.items = rows;
  }
  res.json({ orders });
}));

// A GET that writes: every view of an order is recorded in audit_log.
app.get('/api/orders/:id', requireToken, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, public_id, status, total_cents, created_at FROM orders WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'no such order' });
  const items = await pool.query(
    'SELECT product_id, quantity, price_cents FROM order_items WHERE order_id = $1 ORDER BY id',
    [req.params.id]
  );
  await pool.query(
    "INSERT INTO audit_log (user_id, action, detail) VALUES ($1, 'order.view', $2)",
    [req.user.id, `order ${req.params.id}`]
  );
  res.json({ ...rows[0], items: items.rows });
}));

// Writes first, checks afterwards, rolls back when the check fails.
app.post('/api/orders/:id/cancel', requireToken, wrap(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      'SELECT status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'no such order' });
    }
    await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [req.params.id]);
    await client.query(
      "INSERT INTO audit_log (user_id, action, detail) VALUES ($1, 'order.cancel', $2)",
      [req.user.id, `order ${req.params.id}`]
    );
    if (before.rows[0].status === 'shipped') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'order has already shipped' });
    }
    await client.query('COMMIT');
    res.json({ order_id: Number(req.params.id), status: 'cancelled' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------------- background job

// A timer inside the web process. Its statements are caused by no request.
if (process.env.ENABLE_CLEANUP_JOB === '1') {
  setInterval(() => {
    pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {});
  }, 700);
}

// ---------------------------------------------------------------- start

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, () => {
  console.log(`legacy-shop listening on ${PORT}`);
});
