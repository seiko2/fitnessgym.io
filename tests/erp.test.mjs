import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync } from 'node:crypto';
import { handleApi, verifyPassword } from '../src/api.js';

const initialSchema = await readFile(new URL('../drizzle/0000_init.sql', import.meta.url), 'utf8');
const erpSchema = await readFile(new URL('../drizzle/0001_erp.sql', import.meta.url), 'utf8');
const adminPassword = 'tests-only-admin-passphrase';
const permanentPassword = 'Tests-only-new-staff-passphrase!';
const salt = '67d12038f58be7424cd98c0ba175e290';
const adminHash = 'pbkdf2_sha256$100000$' + salt + '$' + pbkdf2Sync(adminPassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');

class D1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON;' + initialSchema);
    this.sqlite.exec('BEGIN');
    this.sqlite.exec(erpSchema);
    this.sqlite.exec('COMMIT');
  }
  prepare(sql) {
    const db = this.sqlite;
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const result = db.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
    return statement;
  }
  async batch(statements) {
    // D1 serializes transactions even when two Worker requests reach it together.
    // Keep pre-transaction reads concurrent so stale-read races remain testable.
    const transaction = async () => {
      this.sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    };
    const pending = (this.pendingBatch || Promise.resolve()).then(transaction, transaction);
    this.pendingBatch = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
function fixture() { return { DB: new D1(), ADMIN_PASSWORD_HASH: adminHash }; }
async function request(env, path, { body, cookie, bearer, headers = {}, method = body ? 'POST' : 'GET' } = {}) {
  const combined = { Origin: 'https://gym.example', ...headers };
  if (body) { combined['Content-Type'] = 'application/json'; combined['X-Requested-With'] = 'EliteGym'; }
  if (cookie) combined.Cookie = cookie;
  if (bearer) combined.Authorization = 'Bearer ' + bearer;
  const response = await handleApi(new Request('https://gym.example' + path, { method, headers: combined, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function adminLogin(env) {
  const result = await request(env, '/api/admin/login', { body: { username: 'seiko', password: adminPassword } });
  assert.equal(result.status, 200, result.data.error);
  return result.cookie;
}
const admin = (env, cookie, action, body) => request(env, '/api/admin/erp' + (action ? '/' + action : ''), { cookie, ...(body ? { body } : {}) });
const staff = (env, cookie, action, body) => request(env, '/api/staff/' + action, { cookie, ...(body ? { body } : {}) });
const adult = { name: 'Amina Integration', email: 'amina-integration@example.com', phone: '+256700000101', age: 25, plan: 'monthly', trainer: false, weight: 68, height: 1.7, consent: true };
async function register(env, overrides = {}) {
  const result = await request(env, '/api/register', { body: { ...adult, ...overrides } });
  assert.equal(result.status, 201, result.data.error);
  return result.data;
}
async function createStaff(env, cookie, overrides = {}) {
  const result = await admin(env, cookie, 'staff', { name: 'Coach Integration', phone: '+256700000201', email: 'coach-integration@example.com', role: 'Personal trainer', base_salary: 100000, availability: 'available', employment_status: 'active', pay_day: 28, ...overrides });
  assert.equal(result.status, 201, result.data.error);
  return result.data;
}
async function staffLogin(env, staffId, password) {
  const result = await request(env, '/api/staff/login', { body: { staff_id: staffId, password } });
  assert.equal(result.status, 200, result.data.error);
  return result;
}
async function activatedStaff(env, created) {
  const first = await staffLogin(env, created.staff.id, created.initial_password);
  const changed = await staff(env, first.cookie, 'password', { current_password: created.initial_password, new_password: permanentPassword });
  assert.equal(changed.status, 200, changed.data.error);
  assert.equal(changed.data.sign_in_required, true);
  assert.equal((await staff(env, first.cookie, 'me')).status, 401);
  return (await staffLogin(env, created.staff.id, permanentPassword)).cookie;
}

test('ERP migration preserves existing memberships and dependent payment records', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;' + initialSchema);
  db.prepare('INSERT INTO members (id,name,email,phone,age,plan,fee,total,joined_at,expires_at,consent_at,portal_token_hash,card_code,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('EFK-EXISTING', 'Existing Member', 'existing@example.com', '+256700000301', 30, 'monthly', 120000, 120000, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'hash-before-migration', 'card-before-migration', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO charges (id,member_id,amount,plan,description,created_at) VALUES (?,?,?,?,?,?)').run('old-charge', 'EFK-EXISTING', 120000, 'monthly', 'Initial membership', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO payments (id,member_id,amount,method,dedup_key,created_at) VALUES (?,?,?,?,?,?)').run('old-payment', 'EFK-EXISTING', 120000, 'Cash', 'old-dedup', '2026-01-01T00:00:00.000Z');
  db.exec('BEGIN');
  db.exec(erpSchema);
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT name FROM members WHERE id=?').get('EFK-EXISTING').name, 'Existing Member');
  assert.equal(db.prepare('SELECT SUM(amount) total FROM payments WHERE member_id=?').get('EFK-EXISTING').total, 120000);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('registration requires measurements and guardian representation for ages 12–17', async () => {
  const env = fixture();
  assert.equal((await request(env, '/api/register', { body: { ...adult, weight: undefined } })).status, 400);
  assert.equal((await request(env, '/api/register', { body: { ...adult, height: undefined } })).status, 400);
  assert.equal((await request(env, '/api/register', { body: { ...adult, age: 11 } })).status, 400);
  assert.equal((await request(env, '/api/register', { body: { ...adult, age: 12 } })).status, 400);
  const guardian = { age: 12, email: '', parent_name: 'Parent Integration', parent_phone: '+256700000401', parent_email: 'shared-parent@example.com', parent_relationship: 'Mother', parent_consent: true };
  assert.equal((await request(env, '/api/register', { body: { ...adult, ...guardian, parent_consent: false } })).status, 400);
  const child = await register(env, { ...guardian, name: 'First Child' });
  const sibling = await register(env, { ...guardian, age: 16, name: 'Second Child' });
  assert.notEqual(child.member.id, sibling.member.id);
  assert.equal(child.member.email, null);
  assert.equal(child.member.parent_email, sibling.member.parent_email);
  assert.ok(child.member.parent_consent_at);
  assert.equal(child.member.bmi, null);
  assert.match(child.member.program, /guardian/i);
  const updated = await request(env, '/api/member/progress', { bearer: child.card_token, body: { weight: 50, height: 1.6, note: 'Feeling good after training' } });
  assert.equal(updated.status, 200);
  const portal = await request(env, '/api/member', { bearer: child.card_token });
  assert.equal(portal.data.progress.length, 2);
  assert.equal(portal.data.member.bmi, null);
  const verified = await request(env, '/api/verify?code=' + child.member.card_code);
  assert.equal(verified.data.parent_phone, undefined);
  assert.equal(verified.data.parent_email, undefined);
  assert.equal(verified.data.weight, undefined);
});

test('staff credentials are generated once, hashed, changed at first login, and isolated by account', async () => {
  const env = fixture(), cookie = await adminLogin(env);
  assert.equal((await request(env, '/api/admin/erp')).status, 401);
  const one = await createStaff(env, cookie, { email: '' });
  const two = await createStaff(env, cookie, { name: 'Other Coach', email: '', phone: '+256700000202', base_salary: 500000 });
  assert.match(one.staff.id, /^EFS-[A-F0-9]+$/);
  assert.notEqual(one.staff.id, two.staff.id);
  assert.notEqual(one.initial_password, two.initial_password);
  assert.equal(one.staff.password_hash, undefined);
  const stored = env.DB.sqlite.prepare('SELECT password_hash FROM staff WHERE id=?').get(one.staff.id);
  assert.notEqual(stored.password_hash, one.initial_password);
  assert.equal(await verifyPassword(one.initial_password, stored.password_hash), true);
  const first = await staffLogin(env, one.staff.id, one.initial_password);
  assert.equal(first.data.staff.must_change_password, true);
  assert.equal((await staff(env, first.cookie, 'availability', { availability: 'busy' })).status, 403);
  assert.equal((await staff(env, first.cookie, 'password', { current_password: 'wrong-passphrase', new_password: permanentPassword })).status, 401);
  const changed = await staff(env, first.cookie, 'password', { current_password: one.initial_password, new_password: permanentPassword });
  assert.equal(changed.status, 200);
  assert.equal((await staff(env, first.cookie, 'me')).status, 401);
  const session = await staffLogin(env, one.staff.id, permanentPassword);
  const me = await staff(env, session.cookie, 'me?staff_id=' + two.staff.id);
  assert.equal(me.status, 200);
  assert.equal(me.data.staff.id, one.staff.id);
  assert.equal(me.data.staff.base_salary, 100000);
  assert.equal(me.data.staff.password_hash, undefined);
  assert.equal(me.data.initial_password, undefined);
  assert.equal((await request(env, '/api/admin/erp', { cookie: session.cookie })).status, 401);
  const listing = await admin(env, cookie, '');
  assert.ok(listing.data.staff.every(record => !('password_hash' in record) && !('initial_password' in record)));
  const reset = await admin(env, cookie, 'reset-password', { staff_id: one.staff.id });
  assert.equal(reset.status, 200);
  assert.notEqual(reset.data.initial_password, one.initial_password);
  assert.equal((await staff(env, session.cookie, 'me')).status, 401);
  assert.equal((await admin(env, cookie, 'staff', { id: one.staff.id, employment_status: 'inactive' })).status, 200);
  assert.equal((await request(env, '/api/staff/login', { body: { staff_id: one.staff.id, password: reset.data.initial_password } })).status, 401);
});

test('payroll recovers large advances across periods and counts cash costs once', async () => {
  const env = fixture(), cookie = await adminLogin(env), employee = await createStaff(env, cookie);
  const paidMember = await register(env);
  await register(env, { email: 'unpaid-member@example.com', name: 'Unpaid Member' });
  assert.equal((await request(env, '/api/admin/payment', { cookie, body: { member_id: paidMember.member.id, amount: 120000, method: 'Cash', reference: 'ERP-RECEIPT' } })).status, 200);
  assert.equal((await admin(env, cookie, 'advance', { staff_id: employee.staff.id, amount: 150000, note: 'Actual salary advance paid' })).status, 201);
  assert.equal((await admin(env, cookie, 'advance', { staff_id: employee.staff.id, amount: 150000, note: 'Actual salary advance paid' })).status, 409, 'A repeated advance must not double the cash outflow');
  assert.equal((await admin(env, cookie, 'payroll', {staff_id:employee.staff.id,period:'2026-09',base_salary:100000,deductions:100001})).status,400,'Excess deductions must not disappear silently');
  const first = await admin(env, cookie, 'payroll', { staff_id: employee.staff.id, period: '2026-10', allowances: 20000, deductions: 10000 });
  assert.equal(first.status, 201, first.data.error);
  assert.equal(first.data.payroll.gross, 120000);
  assert.equal(first.data.payroll.advance_recovery, 110000);
  assert.equal(first.data.payroll.net, 0);
  assert.equal(first.data.payroll.due_date, '2026-10-28');
  assert.equal((await admin(env, cookie, 'payroll', { staff_id: employee.staff.id, period: '2026-10' })).status, 409);
  let data = (await admin(env, cookie, '')).data;
  assert.equal(data.advances[0].reserved_amount, 110000);
  assert.equal(data.advances[0].recovered_amount, 0);
  assert.equal(data.advances[0].outstanding, 40000);
  assert.equal(data.finance.total_costs, 150000);
  assert.equal(data.finance.profit, -30000);
  assert.equal(data.finance.status, 'loss');
  assert.equal(data.finance.outstanding_advances, 150000);
  assert.equal(data.finance.outstanding_members, 120000);
  assert.equal((await admin(env, cookie, 'payroll-pay', { id: first.data.payroll.id, reference: 'PAY-1' })).status, 200);
  assert.equal((await admin(env, cookie, 'payroll-pay', { id: first.data.payroll.id, reference: 'PAY-1-REPEAT' })).status, 409);
  const second = await admin(env, cookie, 'payroll', { staff_id: employee.staff.id, period: '2026-11' });
  assert.equal(second.status, 201);
  assert.equal(second.data.payroll.advance_recovery, 40000);
  assert.equal(second.data.payroll.net, 60000);
  data = (await admin(env, cookie, '')).data;
  assert.equal(data.finance.unpaid_payroll, 60000);
  assert.equal(data.finance.outstanding_advances, 40000);
  assert.equal(data.finance.payroll_paid, 0, 'A generated payslip is not an actual cash payment');
  assert.equal((await admin(env, cookie, 'payroll-pay', { id: second.data.payroll.id, reference: 'PAY-2' })).status, 200);
  assert.equal((await admin(env, cookie, 'expense', { category: 'Utilities', amount: 20000, description: 'Electricity paid' })).status, 201);
  assert.equal((await admin(env, cookie, 'expense', { category: 'Utilities', amount: 20000, description: 'Electricity paid' })).status, 409, 'A repeated expense must not double the cash outflow');
  data = (await admin(env, cookie, '')).data;
  assert.equal(data.finance.income, 120000);
  assert.equal(data.finance.advances_paid, 150000);
  assert.equal(data.finance.payroll_paid, 60000);
  assert.equal(data.finance.expenses_paid, 20000);
  assert.equal(data.finance.total_costs, 230000);
  assert.equal(data.finance.profit, -110000);
  assert.equal(data.finance.outstanding_advances, 0);
  assert.equal(data.finance.unpaid_payroll, 0);
  assert.equal(data.finance.monthly.reduce((sum, month) => sum + month.profit, 0), -110000);
  assert.equal(data.advances[0].recovered_amount, 150000);
});

test('staff attendance, leave, and assigned tasks respect ownership and status transitions', async () => {
  const env = fixture(), cookie = await adminLogin(env), one = await createStaff(env, cookie);
  const two = await createStaff(env, cookie, { name: 'Second Coach', email: 'second-coach@example.com', phone: '+256700000202' });
  const oneCookie = await activatedStaff(env, one), twoCookie = await activatedStaff(env, two);
  assert.equal((await staff(env, oneCookie, 'checkin', { action: 'out' })).status, 409);
  assert.equal((await staff(env, oneCookie, 'checkin', { action: 'in' })).status, 200);
  assert.equal((await staff(env, oneCookie, 'checkin', { action: 'in' })).status, 409);
  assert.equal((await staff(env, oneCookie, 'checkin', { action: 'out' })).status, 200);
  assert.equal((await staff(env, oneCookie, 'checkin', { action: 'out' })).status, 409);
  assert.equal((await staff(env, twoCookie, 'me')).data.attendance.length, 0);
  assert.equal((await staff(env, oneCookie, 'leave', { start_date: '2030-01-03', end_date: '2030-01-02', reason: 'Wrong date order' })).status, 400);
  assert.equal((await staff(env, oneCookie, 'leave', { start_date: '2030-01-02', end_date: '2030-01-04', reason: 'Family time' })).status, 201);
  assert.equal((await staff(env, oneCookie, 'leave', { start_date: '2030-01-03', end_date: '2030-01-05', reason: 'Overlapping request' })).status, 409);
  let data = (await admin(env, cookie, '')).data;
  const leave = data.leave.find(record => record.staff_id === one.staff.id);
  assert.equal((await admin(env, cookie, 'leave', { id: leave.id, status: 'approved' })).status, 200);
  assert.equal((await admin(env, cookie, 'leave', { id: leave.id, status: 'rejected' })).status, 409);
  assert.equal((await staff(env, oneCookie, 'me')).data.leave[0].status, 'approved');
  assert.equal((await admin(env, cookie, 'task', { staff_id: one.staff.id, title: 'Check training equipment', description: 'Report any damaged items.', due_date: '2030-01-01', status: 'todo' })).status, 200);
  data = (await admin(env, cookie, '')).data;
  const task = data.tasks.find(record => record.staff_id === one.staff.id);
  assert.equal((await staff(env, twoCookie, 'task', { id: task.id, status: 'completed' })).status, 404);
  assert.equal((await staff(env, oneCookie, 'task', { id: task.id, status: 'in_progress' })).status, 200);
  assert.equal((await staff(env, oneCookie, 'task', { id: task.id, status: 'completed' })).status, 200);
  assert.equal((await staff(env, oneCookie, 'task', { id: task.id, status: 'in_progress' })).status, 409);
  const me = (await staff(env, oneCookie, 'me')).data;
  assert.equal(me.stats.completed_tasks, 1);
  assert.equal(me.stats.attendance_days, 1);
  assert.equal(me.attendance[0].check_out !== null, true);
});

test('only actual attendees can review completed sessions and feedback stays scoped to the assigned staff', async () => {
  const env = fixture(), cookie = await adminLogin(env), coach = await createStaff(env, cookie);
  const otherCoach = await createStaff(env, cookie, { name: 'Unassigned Coach', email: 'unassigned-coach@example.com', phone: '+256700000203' });
  const coachCookie = await activatedStaff(env, coach), otherCookie = await activatedStaff(env, otherCoach);
  const attendee = await register(env), absent = await register(env, { name: 'Absent Member', email: 'absent@example.com' });
  const outsider = await register(env, { name: 'Unassigned Member', email: 'unassigned@example.com' });
  assert.equal((await admin(env, cookie, 'session', { staff_id: coach.staff.id, title: 'Guided strength session', starts_at: new Date(Date.now() - 3600000).toISOString(), member_ids: [attendee.member.id, absent.member.id] })).status, 200);
  const session = (await admin(env, cookie, '')).data.sessions[0];
  assert.equal((await request(env, '/api/member/review', { bearer: attendee.card_token, body: { session_id: session.id, rating: 5, comment: 'Too early' } })).status, 403);
  assert.equal((await staff(env, otherCookie, 'session', { id: session.id, status: 'completed', member_ids: [attendee.member.id] })).status, 404);
  assert.equal((await staff(env, coachCookie, 'session', { id: session.id, status: 'completed', member_ids: [outsider.member.id] })).status, 403);
  assert.equal((await staff(env, coachCookie, 'session', { id: session.id, status: 'completed', member_ids: [attendee.member.id] })).status, 200);
  assert.equal((await request(env, '/api/member/review', { bearer: absent.card_token, body: { session_id: session.id, rating: 1 } })).status, 403);
  assert.equal((await request(env, '/api/member/review', { bearer: outsider.card_token, body: { session_id: session.id, rating: 1 } })).status, 403);
  assert.equal((await request(env, '/api/member/review', { bearer: attendee.card_token, body: { session_id: session.id, rating: 6 } })).status, 400);
  assert.equal((await request(env, '/api/member/review', { bearer: attendee.card_token, body: { session_id: session.id, rating: 5, comment: 'Clear explanations and helpful coaching.' } })).status, 200);
  assert.equal((await request(env, '/api/member/review', { bearer: attendee.card_token, body: { session_id: session.id, rating: 4, comment: 'A duplicate review' } })).status, 409);
  const memberView = (await request(env, '/api/member', { bearer: attendee.card_token })).data;
  assert.equal(memberView.sessions[0].reviewed, 1);
  assert.equal(memberView.reviews.length, 1);
  const coachView = (await staff(env, coachCookie, 'me')).data;
  assert.equal(coachView.stats.rating, 5);
  assert.equal(coachView.stats.review_count, 1);
  assert.equal(coachView.reviews[0].comment, 'Clear explanations and helpful coaching.');
  assert.equal((await staff(env, otherCookie, 'me')).data.reviews.length, 0);
  assert.equal((await staff(env, coachCookie, 'session', { id: session.id, status: 'completed', member_ids: [attendee.member.id] })).status, 409);
});

test('concurrent session completions cannot replace the first confirmed attendance roster', async () => {
  const env = fixture(), cookie = await adminLogin(env), coach = await createStaff(env, cookie);
  const coachCookie = await activatedStaff(env, coach);
  const one = await register(env), two = await register(env, { email: 'concurrent-other@example.com' });
  await admin(env, cookie, 'session', { staff_id: coach.staff.id, title: 'Concurrent attendance check', starts_at: new Date(Date.now() - 3600000).toISOString(), member_ids: [one.member.id, two.member.id] });
  const session = (await admin(env, cookie, '')).data.sessions[0];
  const results = await Promise.all([
    staff(env, coachCookie, 'session', { id: session.id, status: 'completed', member_ids: [one.member.id] }),
    staff(env, coachCookie, 'session', { id: session.id, status: 'completed', member_ids: [two.member.id] }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? one.member.id : two.member.id;
  const attendees = env.DB.sqlite.prepare('SELECT member_id FROM session_members WHERE session_id=? AND attended=1').all(session.id).map(row => row.member_id);
  assert.deepEqual(attendees, [winner]);
  const events = env.DB.sqlite.prepare("SELECT COUNT(*) count FROM activity WHERE action='training_session_completed'").get();
  assert.equal(events.count, 1);
});
