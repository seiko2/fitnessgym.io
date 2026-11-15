CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone TEXT NOT NULL,
  age INTEGER NOT NULL CHECK(age >= 18 AND age <= 100),
  plan TEXT NOT NULL,
  trainer INTEGER NOT NULL DEFAULT 0 CHECK(trainer IN (0,1)),
  fee INTEGER NOT NULL CHECK(fee >= 0),
  trainer_fee INTEGER NOT NULL DEFAULT 0 CHECK(trainer_fee >= 0),
  total INTEGER NOT NULL CHECK(total >= 0),
  joined_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  activated_at TEXT,
  duration_days INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),
  weight REAL,
  height REAL,
  bmi REAL,
  program TEXT,
  consent_at TEXT NOT NULL,
  portal_token_hash TEXT NOT NULL UNIQUE,
  card_code TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);
CREATE INDEX members_joined_idx ON members(joined_at);
CREATE INDEX members_expiry_idx ON members(expires_at);
CREATE TABLE charges (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  plan TEXT NOT NULL,
  trainer INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX charges_member_idx ON charges(member_id);
CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  dedup_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX payments_reference_unique ON payments(reference) WHERE reference <> '';
CREATE INDEX payments_member_idx ON payments(member_id);
CREATE TABLE attendance (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  visit_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(member_id, visit_day)
);
CREATE TABLE activity (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX activity_created_idx ON activity(created_at);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_expiry_idx ON rate_limits(expires_at);
CREATE TABLE plans (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  fee INTEGER NOT NULL CHECK(fee >= 0),
  trainer_fee INTEGER NOT NULL CHECK(trainer_fee >= 0),
  days INTEGER NOT NULL CHECK(days > 0 AND days <= 730)
);
CREATE TABLE trainers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  bio TEXT NOT NULL,
  image TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE classes (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration > 0 AND duration <= 240),
  capacity INTEGER NOT NULL CHECK(capacity > 0 AND capacity <= 500),
  trainer TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  created_at TEXT NOT NULL,
  UNIQUE(member_id, class_id)
);
CREATE INDEX bookings_class_idx ON bookings(class_id);
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
