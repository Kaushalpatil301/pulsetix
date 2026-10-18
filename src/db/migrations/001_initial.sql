-- 001_initial.sql
-- Forward-only. Never edit this file once applied; add a new migration instead.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('ORGANIZER', 'CUSTOMER')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Events ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id      UUID        NOT NULL REFERENCES users(id),
  title             TEXT        NOT NULL,
  description       TEXT,
  venue             TEXT        NOT NULL,
  event_date        TIMESTAMPTZ NOT NULL,
  price_cents       INTEGER     NOT NULL CHECK (price_cents >= 0),
  total_tickets     INTEGER     NOT NULL CHECK (total_tickets > 0),
  available_tickets INTEGER     NOT NULL,
  version           INTEGER     NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT available_tickets_bounds
    CHECK (available_tickets >= 0 AND available_tickets <= total_tickets)
);

-- ── Bookings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES events(id),
  customer_id     UUID        NOT NULL REFERENCES users(id),
  tickets_count   INTEGER     NOT NULL CHECK (tickets_count BETWEEN 1 AND 10),
  total_cents     INTEGER     NOT NULL CHECK (total_cents >= 0),
  idempotency_key TEXT        NOT NULL,
  request_hash    TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'CONFIRMED',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS bookings_event_id_idx
  ON bookings(event_id);

CREATE INDEX IF NOT EXISTS bookings_customer_created_idx
  ON bookings(customer_id, created_at DESC);

-- ── Outbox ─────────────────────────────────────────────────────────────────
-- Rows are inserted atomically with the triggering business operation.
-- The dispatcher picks them up and enqueues to BullMQ.
CREATE TABLE IF NOT EXISTS outbox_events (
  id           BIGSERIAL   PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempts     INTEGER     NOT NULL DEFAULT 0
);

-- Partial index: only unprocessed rows are polled
CREATE INDEX IF NOT EXISTS outbox_unprocessed_idx
  ON outbox_events(id)
  WHERE processed_at IS NULL;

-- ── Notification Log ───────────────────────────────────────────────────────
-- Prevents double-sending when a BullMQ job is retried after SMTP already succeeded.
CREATE TABLE IF NOT EXISTS notification_log (
  dedupe_key TEXT        PRIMARY KEY,
  kind       TEXT        NOT NULL,
  recipient  TEXT        NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
