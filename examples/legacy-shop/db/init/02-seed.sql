-- Seed data. The demo user's password is "demo1234".

INSERT INTO users (email, password_hash, salt, display_name) VALUES
    ('demo@example.com',
     'a459ce46c573c4a9ff645a4bea02fa60d8485231f278b1f14578e3b1a825b143',
     's4lt',
     'Demo User');

INSERT INTO products (name, price_cents, stock) VALUES
    ('Mechanical keyboard', 8900, 12),
    ('USB-C dock',          12900, 7),
    ('Laptop stand',        3500, 30),
    ('Webcam',              5900, 15),
    ('Desk lamp',           2900, 40);

INSERT INTO coupons (code, percent_off) VALUES ('WELCOME10', 10);

-- One old order that has already shipped, so that cancelling it is refused.
INSERT INTO orders (user_id, status, total_cents, created_at)
    VALUES (1, 'shipped', 8900, '2026-01-15 10:00:00+00');
INSERT INTO order_items (order_id, product_id, quantity, price_cents)
    VALUES (1, 1, 1, 8900);
