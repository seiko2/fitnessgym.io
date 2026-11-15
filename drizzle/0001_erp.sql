PRAGMA defer_foreign_keys = ON;
CREATE TABLE members_new (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 email TEXT COLLATE NOCASE UNIQUE,
 phone TEXT NOT NULL,
 age INTEGER NOT NULL CHECK(age >= 12 AND age <= 100),
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
 parent_name TEXT,
 parent_phone TEXT,
 parent_email TEXT,
 parent_relationship TEXT,
 parent_consent_at TEXT,
 portal_token_hash TEXT NOT NULL UNIQUE,
 card_code TEXT NOT NULL UNIQUE,
 updated_at TEXT NOT NULL,
 CHECK(age >= 18 OR (parent_name IS NOT NULL AND parent_phone IS NOT NULL AND parent_email IS NOT NULL AND parent_relationship IS NOT NULL AND parent_consent_at IS NOT NULL))
);
INSERT INTO members_new (id,name,email,phone,age,plan,trainer,fee,trainer_fee,total,joined_at,expires_at,activated_at,duration_days,status,weight,height,bmi,program,consent_at,portal_token_hash,card_code,updated_at)
 SELECT id,name,email,phone,age,plan,trainer,fee,trainer_fee,total,joined_at,expires_at,activated_at,duration_days,status,weight,height,bmi,program,consent_at,portal_token_hash,card_code,updated_at FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_joined_idx ON members(joined_at);
CREATE INDEX members_expiry_idx ON members(expires_at);
CREATE TABLE member_progress (
 id TEXT PRIMARY KEY NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id),
 recorded_at TEXT NOT NULL,
 weight REAL NOT NULL CHECK(weight >= 20 AND weight <= 400),
 height REAL NOT NULL CHECK(height >= 0.8 AND height <= 2.5),
 note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX member_progress_member_idx ON member_progress(member_id,recorded_at);
CREATE TABLE staff (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 phone TEXT NOT NULL,
 email TEXT COLLATE NOCASE UNIQUE,
 role TEXT NOT NULL,
 base_salary INTEGER NOT NULL CHECK(base_salary >= 0),
 pay_day INTEGER NOT NULL DEFAULT 28 CHECK(pay_day >= 1 AND pay_day <= 28),
 availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','busy','on_leave','unavailable')),
 employment_status TEXT NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','inactive')),
 joined_at TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE staff_sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX staff_sessions_staff_idx ON staff_sessions(staff_id);
CREATE TABLE staff_attendance (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 work_day TEXT NOT NULL,
 check_in TEXT NOT NULL,
 check_out TEXT,
 UNIQUE(staff_id,work_day)
);
CREATE TABLE leave_requests (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 start_date TEXT NOT NULL,
 end_date TEXT NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL,
 reviewed_at TEXT
);
CREATE TABLE staff_advances (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 amount INTEGER NOT NULL CHECK(amount > 0),
 note TEXT NOT NULL DEFAULT '',
 paid_at TEXT NOT NULL,
 recovered_payroll_id TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE payroll (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 period TEXT NOT NULL,
 base_salary INTEGER NOT NULL CHECK(base_salary >= 0),
 allowances INTEGER NOT NULL DEFAULT 0 CHECK(allowances >= 0),
 deductions INTEGER NOT NULL DEFAULT 0 CHECK(deductions >= 0),
 advance_recovery INTEGER NOT NULL DEFAULT 0 CHECK(advance_recovery >= 0),
 gross INTEGER NOT NULL CHECK(gross >= 0),
 net INTEGER NOT NULL CHECK(net >= 0),
 due_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','paid')),
 paid_at TEXT,
 reference TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 UNIQUE(staff_id,period)
);
CREATE TABLE payroll_advance_recoveries (
 payroll_id TEXT NOT NULL REFERENCES payroll(id),
 advance_id TEXT NOT NULL REFERENCES staff_advances(id),
 amount INTEGER NOT NULL CHECK(amount > 0),
 PRIMARY KEY(payroll_id,advance_id)
);
CREATE TABLE staff_tasks (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 due_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','completed')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE training_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff(id),
 class_id TEXT REFERENCES classes(id),
 title TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 ended_at TEXT,
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
 created_at TEXT NOT NULL
);
CREATE INDEX training_sessions_staff_idx ON training_sessions(staff_id,starts_at);
CREATE TABLE session_members (
 session_id TEXT NOT NULL REFERENCES training_sessions(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 attended INTEGER NOT NULL DEFAULT 0 CHECK(attended IN (0,1)),
 PRIMARY KEY(session_id,member_id)
);
CREATE TABLE staff_reviews (
 id TEXT PRIMARY KEY NOT NULL,
 session_id TEXT NOT NULL REFERENCES training_sessions(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 staff_id TEXT NOT NULL REFERENCES staff(id),
 rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
 comment TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 UNIQUE(session_id,member_id)
);
CREATE INDEX staff_reviews_staff_idx ON staff_reviews(staff_id);
CREATE TABLE business_expenses (
 id TEXT PRIMARY KEY NOT NULL,
 category TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount > 0),
 description TEXT NOT NULL,
 incurred_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX business_expenses_date_idx ON business_expenses(incurred_at);
PRAGMA defer_foreign_keys = OFF;
