CREATE TABLE recovery_requests (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('lookup','deliver','done','failed')),
  expires_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE recovery_challenges (
  token_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES recovery_requests(id),
  intent_id TEXT NOT NULL REFERENCES purchase_intents(id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  redemption_id TEXT
) STRICT;
CREATE TABLE recovery_limits (
  bucket_hash TEXT NOT NULL,
  hour INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY(bucket_hash,hour)
) STRICT;
CREATE INDEX recovery_queue ON recovery_requests(stage,lease_until,expires_at);
CREATE INDEX recovery_challenge_intent ON recovery_challenges(intent_id);
