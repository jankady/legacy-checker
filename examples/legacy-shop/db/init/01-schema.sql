-- legacy-shop schema. Deliberately a little untidy, like an inherited system.

CREATE TABLE users (
    id            serial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    salt          text NOT NULL,
    display_name  text NOT NULL
);

CREATE TABLE sessions (
    id         text PRIMARY KEY,
    user_id    integer REFERENCES users (id),
    csrf_token text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE api_tokens (
    token      text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE products (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    price_cents integer NOT NULL,
    stock       integer NOT NULL,
    view_count  integer NOT NULL DEFAULT 0
);

CREATE TABLE product_ratings (
    user_id    integer NOT NULL REFERENCES users (id),
    product_id integer NOT NULL REFERENCES products (id),
    rating     integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);

CREATE TABLE carts (
    user_id    integer PRIMARY KEY REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
    id         serial PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users (id),
    product_id integer NOT NULL REFERENCES products (id),
    quantity   integer NOT NULL,
    UNIQUE (user_id, product_id)
);

CREATE TABLE cart_archive (
    id          serial PRIMARY KEY,
    user_id     integer NOT NULL,
    product_id  integer NOT NULL,
    quantity    integer NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id          serial PRIMARY KEY,
    public_id   uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id     integer NOT NULL REFERENCES users (id),
    status      text NOT NULL,
    total_cents integer NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    id          serial PRIMARY KEY,
    order_id    integer NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  integer NOT NULL REFERENCES products (id),
    quantity    integer NOT NULL,
    price_cents integer NOT NULL
);

-- Filled by a trigger, never by the application. A tool that only watches
-- the wire cannot see these writes.
CREATE TABLE order_events (
    id         serial PRIMARY KEY,
    order_id   integer NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    event      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION log_order_created() RETURNS trigger AS $$
BEGIN
    INSERT INTO order_events (order_id, event) VALUES (NEW.id, 'created');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_created
    AFTER INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_created();

CREATE TABLE coupons (
    code        text PRIMARY KEY,
    percent_off integer NOT NULL
);

CREATE TABLE coupon_redemptions (
    coupon_code text NOT NULL REFERENCES coupons (code),
    user_id     integer NOT NULL REFERENCES users (id),
    order_id    integer NOT NULL REFERENCES orders (id),
    PRIMARY KEY (coupon_code, user_id)
);

CREATE TABLE audit_log (
    id         serial PRIMARY KEY,
    user_id    integer,
    action     text NOT NULL,
    detail     text,
    created_at timestamptz NOT NULL DEFAULT now()
);
