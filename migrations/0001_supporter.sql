-- Use a dedicated sandbox D1 database. Never bind this to live purchases.
CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;
CREATE TABLE purchases (
  transaction_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  completed_at TEXT NOT NULL
) STRICT;
-- Independent tombstones survive a refund arriving before transaction.completed.
CREATE TABLE revocations (
  adjustment_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;
CREATE INDEX revocations_transaction ON revocations(transaction_id);
-- Populated only by a future SERVER checkout creator, never client custom_data.
CREATE TABLE purchase_intents (
  id TEXT PRIMARY KEY,
  recovery_hash TEXT NOT NULL UNIQUE,
  transaction_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;
