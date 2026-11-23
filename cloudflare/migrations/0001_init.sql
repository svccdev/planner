CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_progress (
  endpoint TEXT NOT NULL,
  cycle_date TEXT NOT NULL,
  pending_core INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (endpoint, cycle_date)
);

CREATE TABLE IF NOT EXISTS calls (
  endpoint TEXT NOT NULL,
  id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (endpoint, id)
);

CREATE TABLE IF NOT EXISTS push_events (
  endpoint TEXT NOT NULL,
  event_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (endpoint, event_key)
);
