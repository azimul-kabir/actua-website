-- A reservation is never automatically retried after calling Paddle. This avoids
-- creating a second transaction when the first response or process is lost.
CREATE TABLE checkout_attempts (
  intent_id TEXT PRIMARY KEY REFERENCES purchase_intents(id),
  state TEXT NOT NULL CHECK(state IN ('reserved','creating','ready','reconcile')),
  created_at INTEGER NOT NULL
) STRICT;
