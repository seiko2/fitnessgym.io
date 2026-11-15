// HR records stay server-side. A staff session can only read its own employment data.
const STAFF_COOKIE = '__Host-elite_staff';
const AVAILABILITY = ['available', 'busy', 'on_leave', 'unavailable'];
const EMPLOYMENT = ['active', 'inactive'];
const TASK_STATUS = ['todo', 'in_progress', 'completed'];
const cleanStaff = row => {
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return { ...safe, must_change_password: !!row.must_change_password };
};
const cookie = (value, maxAge = 28800) => `${STAFF_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const changes = result => Number(result?.meta?.changes || 0);
const number = value => Number(value || 0);
const total = (rows, key = 'amount') => rows.reduce((sum, row) => sum + number(row[key]), 0);
const chunks = (values, size = 30) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));

function dayKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
}

export async function handleHrApi(request, env, ctx) {
  const { db, helpers: h } = ctx;
  const { all, first, run, audit, text, integer, email, phone, sha, token, id, now, verifyPassword, hashPassword, rate, bad } = h;
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const b = ctx.b || {};
  if (!path.startsWith('/api/staff/') && !path.startsWith('/api/admin/erp')) return null;

  function enumValue(value, values, label) {
    if (!values.includes(value)) bad(`Please choose a valid ${label}.`);
    return value;
  }
  function validDate(value, label, optional = false) {
    if (optional && (value === undefined || value === null || value === '')) return '';
    const v = text(value, label, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) bad(`Please enter a valid ${label}.`);
    return v;
  }
  function timestamp(value, label, { paid = false, fallback = false } = {}) {
    if ((value === undefined || value === null || value === '') && fallback) return now();
    const v = text(value, label, 40), date = new Date(v);
    if (!Number.isFinite(date.getTime())) bad(`Please enter a valid ${label}.`);
    if (paid && date.getTime() > Date.now() + 300000) bad(`${label} cannot be in the future when recording money already paid.`);
    return date.toISOString();
  }
  function passwordValue(value, label = 'password', min = 1) {
    if (typeof value !== 'string' || value.length < min || value.length > 128) bad(`${label} must contain ${min}–128 characters.`);
    return value;
  }
  function memberIds(value) {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length > 200) bad('Please choose no more than 200 members for a session.');
    return [...new Set(value.map(v => text(v, 'member ID', 100)))];
  }
  async function staffRecord(staffId, requireActive = false) {
    const row = await first(db, 'SELECT * FROM staff WHERE id=?', text(staffId, 'staff ID', 100));
    if (!row) bad('Staff member not found.', 404);
    if (requireActive && row.employment_status !== 'active') bad('This staff account is inactive.');
    return row;
  }
  async function advances(staffId) {
    const where = staffId ? 'WHERE a.staff_id=?' : '';
    return all(db, `SELECT a.*,s.name staff_name,
      COALESCE((SELECT SUM(r.amount) FROM payroll_advance_recoveries r JOIN payroll p ON p.id=r.payroll_id WHERE r.advance_id=a.id AND p.status='paid'),0) recovered_amount,
      COALESCE((SELECT SUM(r.amount) FROM payroll_advance_recoveries r JOIN payroll p ON p.id=r.payroll_id WHERE r.advance_id=a.id AND p.status<>'paid'),0) reserved_amount,
      MAX(0,a.amount-COALESCE((SELECT SUM(r.amount) FROM payroll_advance_recoveries r WHERE r.advance_id=a.id),0)) outstanding
      FROM staff_advances a JOIN staff s ON s.id=a.staff_id ${where} ORDER BY a.paid_at DESC`, ...(staffId ? [staffId] : []));
  }
  async function sessions(staffId) {
    const rows = await all(db, `SELECT t.*,s.name staff_name FROM training_sessions t JOIN staff s ON s.id=t.staff_id ${staffId ? 'WHERE t.staff_id=?' : ''} ORDER BY t.starts_at DESC`, ...(staffId ? [staffId] : []));
    const rosters = await all(db, `SELECT sm.session_id,m.id,m.name,sm.attended FROM session_members sm JOIN members m ON m.id=sm.member_id ${staffId ? 'JOIN training_sessions t ON t.id=sm.session_id WHERE t.staff_id=?' : ''} ORDER BY m.name`, ...(staffId ? [staffId] : []));
    return rows.map(row => ({ ...row, members: rosters.filter(m => m.session_id === row.id).map(({ session_id, ...member }) => ({ ...member, attended: !!member.attended })), member_ids: rosters.filter(m => m.session_id === row.id).map(m => m.id) }));
  }
  async function finance() {
    const [incomeRows, paidPayroll, advanceRows, expenseRows, unpaid, memberDebt, advanceDebt] = await Promise.all([
      all(db, 'SELECT amount,created_at FROM payments'),
      all(db, "SELECT net amount,paid_at FROM payroll WHERE status='paid'"),
      all(db, 'SELECT amount,paid_at FROM staff_advances'),
      all(db, 'SELECT amount,category,incurred_at FROM business_expenses'),
      first(db, "SELECT COALESCE(SUM(net),0) amount FROM payroll WHERE status<>'paid'"),
      first(db, 'SELECT COALESCE(SUM(MAX(0,COALESCE((SELECT SUM(c.amount) FROM charges c WHERE c.member_id=m.id),m.total)-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.member_id=m.id),0))),0) amount FROM members m'),
      first(db, "SELECT COALESCE(SUM(a.amount-COALESCE((SELECT SUM(r.amount) FROM payroll_advance_recoveries r JOIN payroll p ON p.id=r.payroll_id WHERE r.advance_id=a.id AND p.status='paid'),0)),0) amount FROM staff_advances a"),
    ]);
    const income = total(incomeRows), payrollPaid = total(paidPayroll), advancesPaid = total(advanceRows), expensesPaid = total(expenseRows), costs = payrollPaid + advancesPaid + expensesPaid;
    const months = new Map();
    function monthRecord(value) {
      const key = dayKey(value).slice(0, 7);
      if (!months.has(key)) months.set(key, { month: key, period: key, income: 0, payroll_paid: 0, advances_paid: 0, expenses_paid: 0, total_costs: 0, costs: 0, profit: 0 });
      return months.get(key);
    }
    const current = new Date();
    for (let i = 5; i >= 0; i--) monthRecord(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i, 15)));
    for (const row of incomeRows) monthRecord(row.created_at).income += number(row.amount);
    for (const row of paidPayroll) monthRecord(row.paid_at).payroll_paid += number(row.amount);
    for (const row of advanceRows) monthRecord(row.paid_at).advances_paid += number(row.amount);
    for (const row of expenseRows) monthRecord(row.incurred_at).expenses_paid += number(row.amount);
    const monthly = [...months.values()].sort((a, z) => a.month.localeCompare(z.month)).map(m => { m.total_costs = m.payroll_paid + m.advances_paid + m.expenses_paid; m.costs = m.total_costs; m.profit = m.income - m.total_costs; return m; });
    const categoryMap = new Map();
    for (const row of expenseRows) categoryMap.set(row.category, (categoryMap.get(row.category) || 0) + number(row.amount));
    if (payrollPaid) categoryMap.set('Net salaries paid', payrollPaid);
    if (advancesPaid) categoryMap.set('Staff advances paid', advancesPaid);
    const categories = [...categoryMap.entries()].map(([category, amount]) => ({ category, name: category, amount })).sort((a, z) => z.amount - a.amount);
    const profit = income - costs;
    return { basis: 'cash', currency: 'UGX', income, payroll_paid: payrollPaid, advances_paid: advancesPaid, expenses_paid: expensesPaid, total_costs: costs, profit, status: profit < 0 ? 'loss' : profit > 0 ? 'profit' : 'breakeven', profit_margin: income > 0 ? Math.round(profit / income * 10000) / 100 : null, unpaid_payroll: number(unpaid?.amount), outstanding_members: number(memberDebt?.amount), outstanding_advances: number(advanceDebt?.amount), monthly, categories, note: 'Cash-basis operating result from recorded receipts, net salaries paid, staff advances paid, and expenses. Unpaid payroll and member balances are shown separately. This is not an audited financial statement.' };
  }

  if (path.startsWith('/api/staff/')) {
    if (path === '/api/staff/login' && method === 'POST') {
      const staffId = text(b.staff_id, 'staff ID', 100).toUpperCase(), password = passwordValue(b.password);
      await rate(db, 'staff-login-ip:' + await sha(request.headers.get('cf-connecting-ip') || 'unknown'), 12, 900);
      await rate(db, 'staff-login-id:' + await sha(staffId), 8, 900);
      const staff = await first(db, 'SELECT * FROM staff WHERE id=?', staffId);
      const verified = staff ? await verifyPassword(password, staff.password_hash) : false;
      if (!staff || !verified || staff.employment_status !== 'active') {
        await audit(db, 'staff_login_failed', 'Unsuccessful staff sign-in', 'anonymous').run();
        bad('Incorrect staff ID or password, or the account is inactive.', 401);
      }
      const access = token(), stamp = now(), expires = new Date(Date.now() + 8 * 3600000).toISOString();
      await db.batch([run(db, 'DELETE FROM staff_sessions WHERE expires_at<?', stamp), run(db, 'INSERT INTO staff_sessions (token_hash,staff_id,expires_at,created_at) VALUES (?,?,?,?)', await sha(access), staff.id, expires, stamp), audit(db, 'staff_login', staff.id + ' signed in', staff.id)]);
      return Response.json({ ok: true, staff: { id: staff.id, name: staff.name, role: staff.role, must_change_password: !!staff.must_change_password } }, { headers: { 'Set-Cookie': cookie(access) } });
    }
    const access = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1] || request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-elite_staff=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!access) bad('Please sign in with your staff ID and password.', 401);
    const session = await first(db, 'SELECT ss.*,s.employment_status FROM staff_sessions ss JOIN staff s ON s.id=ss.staff_id WHERE ss.token_hash=? AND ss.expires_at>?', await sha(access), now());
    if (!session || session.employment_status !== 'active') bad('Your staff session has expired or your account is inactive.', 401);
    const staff = await staffRecord(session.staff_id);
    if (method === 'POST' && request.headers.get('X-Requested-With') !== 'EliteGym') bad('This request is not allowed.', 403);
    if (path === '/api/staff/logout' && method === 'POST') {
      await db.batch([run(db, 'DELETE FROM staff_sessions WHERE token_hash=?', session.token_hash), audit(db, 'staff_logout', staff.id + ' signed out', staff.id)]);
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie('', 0) } });
    }
    if (path === '/api/staff/password' && method === 'POST') {
      const current = passwordValue(b.current_password, 'Current password'), next = passwordValue(b.new_password, 'New password', 12);
      if (!await verifyPassword(current, staff.password_hash)) bad('Your current password is incorrect.', 401);
      if (current === next) bad('Choose a new password different from your current password.');
      await db.batch([run(db, 'UPDATE staff SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?', await hashPassword(next), now(), staff.id), run(db, 'DELETE FROM staff_sessions WHERE staff_id=?', staff.id), audit(db, 'staff_password_changed', staff.id + ' updated their password; sessions revoked', staff.id)]);
      return Response.json({ ok: true, sign_in_required: true }, { headers: { 'Set-Cookie': cookie('', 0) } });
    }
    if (path === '/api/staff/me' && method === 'GET') {
      const [payroll, advanceRows, leave, attendance, tasks, reviews, sessionRows] = await Promise.all([
        all(db, 'SELECT p.*,s.name staff_name FROM payroll p JOIN staff s ON s.id=p.staff_id WHERE p.staff_id=? ORDER BY p.period DESC', staff.id), advances(staff.id),
        all(db, 'SELECT * FROM leave_requests WHERE staff_id=? ORDER BY created_at DESC', staff.id),
        all(db, 'SELECT * FROM staff_attendance WHERE staff_id=? ORDER BY check_in DESC', staff.id),
        all(db, 'SELECT * FROM staff_tasks WHERE staff_id=? ORDER BY due_date,created_at DESC', staff.id),
        all(db, 'SELECT r.id,r.session_id,t.title,r.rating,r.comment,r.created_at FROM staff_reviews r JOIN training_sessions t ON t.id=r.session_id WHERE r.staff_id=? ORDER BY r.created_at DESC', staff.id),
        sessions(staff.id),
      ]);
      const paid = payroll.filter(p => p.status === 'paid'), outstanding = payroll.filter(p => p.status !== 'paid'), upcoming = [...outstanding].sort((a, z) => a.due_date.localeCompare(z.due_date));
      const stats = { completed_tasks: tasks.filter(t => t.status === 'completed').length, total_tasks: tasks.length, completed_sessions: sessionRows.filter(s => s.status === 'completed').length, total_sessions: sessionRows.length, attendance_days: attendance.length, rating: reviews.length ? Math.round(total(reviews, 'rating') / reviews.length * 10) / 10 : null, review_count: reviews.length, salary_paid: total(paid, 'net'), salary_due: total(outstanding, 'net'), next_pay_date: upcoming[0]?.due_date || null, advance_balance: advanceRows.reduce((sum, a) => sum + number(a.amount) - number(a.recovered_amount), 0) };
      return Response.json({ staff: cleanStaff(staff), payroll, advances: advanceRows, leave, attendance, tasks, reviews, sessions: sessionRows, stats });
    }
    if (staff.must_change_password) bad('Please change your temporary password before using staff actions.', 403);
    if (path === '/api/staff/availability' && method === 'POST') {
      const availability = enumValue(b.availability, AVAILABILITY, 'availability status');
      await db.batch([run(db, 'UPDATE staff SET availability=?,updated_at=? WHERE id=?', availability, now(), staff.id), audit(db, 'staff_availability', staff.id + ' reported ' + availability, staff.id)]);
      return Response.json({ ok: true });
    }
    if (path === '/api/staff/checkin' && method === 'POST') {
      const action = enumValue(b.action, ['in', 'out'], 'attendance action'), day = dayKey(), stamp = now();
      if (action === 'in') {
        const result = await db.batch([run(db, 'INSERT INTO staff_attendance (id,staff_id,work_day,check_in,check_out) SELECT ?,?,?,?,NULL WHERE NOT EXISTS(SELECT 1 FROM staff_attendance WHERE staff_id=? AND (work_day=? OR check_out IS NULL))', id('clock'), staff.id, day, stamp, staff.id, day)]);
        if (!changes(result[0])) bad('You have already clocked in today or still have an open shift. Clock out of an open shift first.', 409);
        await audit(db, 'staff_clock_in', staff.id + ' clocked in', staff.id).run();
      } else {
        const result = await run(db, 'UPDATE staff_attendance SET check_out=? WHERE id=(SELECT id FROM staff_attendance WHERE staff_id=? AND check_out IS NULL ORDER BY check_in DESC LIMIT 1) AND check_out IS NULL', stamp, staff.id).run();
        if (!changes(result)) bad('There is no open clock-in to finish.', 409);
        await audit(db, 'staff_clock_out', staff.id + ' clocked out', staff.id).run();
      }
      return Response.json({ ok: true });
    }
    if (path === '/api/staff/leave' && method === 'POST') {
      const start = validDate(b.start_date, 'leave start date'), end = validDate(b.end_date, 'leave end date'), reason = text(b.reason, 'leave reason', 600);
      if (end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000) bad('Leave must end on or after its start and last no more than a year.');
      const overlap = await first(db, "SELECT id FROM leave_requests WHERE staff_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?", staff.id, end, start);
      if (overlap) bad('You already have a pending or approved leave request covering these dates.', 409);
      await db.batch([run(db, 'INSERT INTO leave_requests (id,staff_id,start_date,end_date,reason,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?,?,NULL)', id('leave'), staff.id, start, end, reason, 'pending', now()), audit(db, 'leave_requested', staff.id + ' requested leave ' + start + ' to ' + end, staff.id)]);
      return Response.json({ ok: true }, { status: 201 });
    }
    if (path === '/api/staff/task' && method === 'POST') {
      const taskId = text(b.id, 'task ID', 100), status = enumValue(b.status, ['in_progress', 'completed'], 'task status');
      const task = await first(db, 'SELECT * FROM staff_tasks WHERE id=? AND staff_id=?', taskId, staff.id); if (!task) bad('Assigned task not found.', 404);
      if (task.status === 'completed' && status !== 'completed') bad('A completed task can only be reopened by an administrator.', 409);
      await db.batch([run(db, 'UPDATE staff_tasks SET status=?,updated_at=? WHERE id=? AND staff_id=?', status, now(), taskId, staff.id), audit(db, 'staff_task_updated', staff.id + ' marked ' + taskId + ' ' + status, staff.id)]);
      return Response.json({ ok: true });
    }
    if (path === '/api/staff/session' && method === 'POST') {
      if (b.status !== 'completed') bad('Staff can only mark their assigned session as completed.');
      const sessionId = text(b.id, 'session ID', 100), record = await first(db, 'SELECT * FROM training_sessions WHERE id=? AND staff_id=?', sessionId, staff.id);
      if (!record) bad('Assigned session not found.', 404); if (record.status !== 'scheduled') bad('This session has already been completed or cancelled.', 409); if (Date.parse(record.starts_at) > Date.now()) bad('The session has not started yet.');
      const attendees = memberIds(b.member_ids); if (!attendees) bad('Please confirm which assigned members attended.');
      const roster = await all(db, 'SELECT member_id FROM session_members WHERE session_id=?', sessionId), allowed = new Set(roster.map(m => m.member_id));
      if (attendees.some(memberId => !allowed.has(memberId))) bad('Only members assigned by the administrator can be marked as attending.', 403);
      const stamp = now();
      const statements = [run(db, "UPDATE session_members SET attended=0 WHERE session_id=? AND EXISTS(SELECT 1 FROM training_sessions WHERE id=? AND staff_id=? AND status='scheduled')", sessionId, sessionId, staff.id)];
      for (const group of chunks(attendees, 50)) statements.push(run(db, `UPDATE session_members SET attended=1 WHERE session_id=? AND member_id IN (${group.map(() => '?').join(',')}) AND EXISTS(SELECT 1 FROM training_sessions WHERE id=? AND staff_id=? AND status='scheduled')`, sessionId, ...group, sessionId, staff.id));
      const completionIndex = statements.length;
      statements.push(run(db, "UPDATE training_sessions SET status='completed',ended_at=? WHERE id=? AND staff_id=? AND status='scheduled'", stamp, sessionId, staff.id), run(db, 'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE changes()>0', id('evt'), 'training_session_completed', staff.id + ' completed ' + sessionId + ' with ' + attendees.length + ' attendees', staff.id, stamp));
      const result = await db.batch(statements);
      if (!changes(result[completionIndex])) bad('The session changed before it was saved. Refresh and try again.', 409);
      return Response.json({ ok: true });
    }
    return null;
  }

  if (!ctx.admin) bad('Please sign in to the admin panel.', 401);
  if (method === 'GET' && (path === '/api/admin/erp' || path === '/api/admin/erp/finance')) {
    if (path.endsWith('/finance')) return Response.json(await finance());
    const [staffRows, payroll, advanceRows, leave, attendance, tasks, sessionRows, reviews, expenses, calculations] = await Promise.all([
      all(db, 'SELECT * FROM staff ORDER BY name'),
      all(db, 'SELECT p.*,s.name staff_name FROM payroll p JOIN staff s ON s.id=p.staff_id ORDER BY p.period DESC,p.created_at DESC'), advances(),
      all(db, 'SELECT l.*,s.name staff_name FROM leave_requests l JOIN staff s ON s.id=l.staff_id ORDER BY l.created_at DESC'),
      all(db, 'SELECT a.*,s.name staff_name FROM staff_attendance a JOIN staff s ON s.id=a.staff_id ORDER BY a.check_in DESC'),
      all(db, 'SELECT t.*,s.name staff_name FROM staff_tasks t JOIN staff s ON s.id=t.staff_id ORDER BY t.due_date,t.created_at DESC'), sessions(),
      all(db, 'SELECT r.*,s.name staff_name,m.name member_name,t.title FROM staff_reviews r JOIN staff s ON s.id=r.staff_id JOIN members m ON m.id=r.member_id JOIN training_sessions t ON t.id=r.session_id ORDER BY r.created_at DESC'),
      all(db, 'SELECT * FROM business_expenses ORDER BY incurred_at DESC'), finance(),
    ]);
    return Response.json({ staff: staffRows.map(cleanStaff), payroll, advances: advanceRows, leave, staff_attendance: attendance, tasks, sessions: sessionRows, reviews, expenses, finance: calculations });
  }
  if (method !== 'POST') return null;
  if (path === '/api/admin/erp/staff') {
    const existing = b.id ? await staffRecord(b.id) : null, staffId = existing?.id || 'EFS-' + token().slice(0, 8).toUpperCase(), stamp = now();
    const mailValue = b.email === undefined ? existing?.email : b.email;
    const name = text(b.name ?? existing?.name, 'staff name', 100), tel = phone(b.phone ?? existing?.phone), mail = mailValue ? email(mailValue) : null, role = text(b.role ?? existing?.role ?? 'Staff', 'staff role', 100), salary = integer(b.base_salary ?? existing?.base_salary ?? 0, 'base salary', 0, 100000000), payDay = integer(b.pay_day ?? existing?.pay_day ?? 28, 'salary pay day', 1, 28), availability = enumValue(b.availability ?? existing?.availability ?? 'available', AVAILABILITY, 'availability'), status = enumValue(b.employment_status ?? existing?.employment_status ?? 'active', EMPLOYMENT, 'employment status'), joined = b.joined_at ? validDate(String(b.joined_at).slice(0, 10), 'joining date') : existing?.joined_at || dayKey();
    if (existing) {
      await db.batch([run(db, 'UPDATE staff SET name=?,phone=?,email=?,role=?,base_salary=?,pay_day=?,availability=?,employment_status=?,joined_at=?,updated_at=? WHERE id=?', name, tel, mail, role, salary, payDay, availability, status, joined, stamp, staffId), ...(status === 'inactive' ? [run(db, 'DELETE FROM staff_sessions WHERE staff_id=?', staffId)] : []), audit(db, 'staff_updated', staffId + ' employment record updated')]);
      return Response.json({ ok: true, staff: cleanStaff(await staffRecord(staffId)) });
    }
    const initialPassword = 'Ef!' + token().slice(0, 20) + 'A7';
    await db.batch([run(db, 'INSERT INTO staff (id,name,phone,email,role,base_salary,pay_day,availability,employment_status,joined_at,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', staffId, name, tel, mail, role, salary, payDay, availability, status, joined, await hashPassword(initialPassword), 1, stamp, stamp), audit(db, 'staff_created', staffId + ' added as ' + role)]);
    return Response.json({ ok: true, staff: cleanStaff(await staffRecord(staffId)), initial_password: initialPassword }, { status: 201 });
  }
  if (path === '/api/admin/erp/reset-password') {
    const staff = await staffRecord(b.staff_id), initialPassword = 'Ef!' + token().slice(0, 20) + 'A7';
    await db.batch([run(db, 'UPDATE staff SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?', await hashPassword(initialPassword), now(), staff.id), run(db, 'DELETE FROM staff_sessions WHERE staff_id=?', staff.id), audit(db, 'staff_password_reset', staff.id + ' temporary password reset; sessions revoked')]);
    return Response.json({ ok: true, staff: cleanStaff(await staffRecord(staff.id)), initial_password: initialPassword });
  }
  if (path === '/api/admin/erp/advance') {
    const staff = await staffRecord(b.staff_id, true), amount = integer(b.amount, 'advance amount', 1, 100000000), note = text(b.note || 'Salary advance', 'advance note', 600), paid = timestamp(b.paid_at, 'Advance payment date', { paid: true, fallback: true });
    const stamp = now(), cutoff = new Date(Date.now() - 60000).toISOString();
    const results = await db.batch([
      run(db, 'INSERT INTO staff_advances (id,staff_id,amount,note,paid_at,recovered_payroll_id,created_at) SELECT ?,?,?,?,?,NULL,? WHERE NOT EXISTS(SELECT 1 FROM staff_advances WHERE staff_id=? AND amount=? AND note=? AND substr(paid_at,1,10)=substr(?,1,10) AND created_at>=?)', id('adv'), staff.id, amount, note, paid, stamp, staff.id, amount, note, paid, cutoff),
      run(db, 'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE changes()>0', id('evt'), 'staff_advance_paid', staff.id + ' received advance UGX ' + amount, 'seiko', stamp),
    ]);
    if (!changes(results[0])) bad('An identical advance was just recorded. Refresh the records before entering another payment.', 409);
    return Response.json({ ok: true }, { status: 201 });
  }
  if (path === '/api/admin/erp/payroll') {
    const staff = await staffRecord(b.staff_id, true), period = text(b.period, 'payroll period', 7);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) bad('Choose a payroll period in YYYY-MM format.');
    if (await first(db, 'SELECT id FROM payroll WHERE staff_id=? AND period=?', staff.id, period)) bad('A payslip already exists for this staff member and period.', 409);
    const base = integer(b.base_salary ?? staff.base_salary, 'base salary', 0, 100000000), allowances = integer(b.allowances ?? 0, 'allowances', 0, 100000000), deductions = integer(b.deductions ?? 0, 'deductions', 0, 100000000), gross = base + allowances, available = Math.max(0, gross - deductions), due = validDate(b.due_date || `${period}-${String(staff.pay_day).padStart(2, '0')}`, 'salary due date'), note = text(b.note || '', 'payroll note', 600, false), payrollId = id('payroll'), stamp = now();
    if (deductions > gross) bad('Deductions cannot exceed this payslip’s gross salary. Carry any remaining deduction into a later period.');
    const statements = [run(db, 'INSERT INTO payroll (id,staff_id,period,base_salary,allowances,deductions,advance_recovery,gross,net,due_date,status,paid_at,reference,note,created_at) VALUES (?,?,?,?,?,?,0,?,?,?,\'unpaid\',NULL,\'\',?,?)', payrollId, staff.id, period, base, allowances, deductions, gross, available, due, note, stamp)];
    // Allocate from the oldest outstanding advances within this transaction. The
    // window sum handles partial recovery without one request per advance.
    statements.push(run(db, `WITH available_advances AS (
        SELECT a.id,a.paid_at,MAX(0,a.amount-COALESCE((SELECT SUM(r.amount) FROM payroll_advance_recoveries r WHERE r.advance_id=a.id),0)) remaining
        FROM staff_advances a WHERE a.staff_id=?
      ), ordered_advances AS (
        SELECT id,remaining,COALESCE(SUM(remaining) OVER(ORDER BY paid_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) previous
        FROM available_advances WHERE remaining>0
      ) INSERT INTO payroll_advance_recoveries (payroll_id,advance_id,amount)
      SELECT ?,id,MIN(remaining,MAX(0,?-previous)) FROM ordered_advances WHERE ? > previous`, staff.id, payrollId, available, available));
    statements.push(run(db, 'UPDATE payroll SET advance_recovery=COALESCE((SELECT SUM(amount) FROM payroll_advance_recoveries WHERE payroll_id=?),0),net=MAX(0,gross-deductions-COALESCE((SELECT SUM(amount) FROM payroll_advance_recoveries WHERE payroll_id=?),0)) WHERE id=?', payrollId, payrollId, payrollId), audit(db, 'payroll_generated', staff.id + ' payslip generated for ' + period));
    await db.batch(statements);
    return Response.json({ ok: true, payroll: await first(db, 'SELECT * FROM payroll WHERE id=?', payrollId) }, { status: 201 });
  }
  if (path === '/api/admin/erp/payroll-pay') {
    const payrollId = text(b.id, 'payslip ID', 100), payslip = await first(db, 'SELECT * FROM payroll WHERE id=?', payrollId);
    if (!payslip) bad('Payslip not found.', 404); if (payslip.status === 'paid') bad('This payslip has already been paid.', 409);
    const reference = text(b.reference || '', 'payment reference', 100, false), paid = timestamp(b.paid_at, 'Salary payment date', { paid: true, fallback: true });
    const result = await db.batch([
      run(db, "UPDATE payroll SET status='paid',paid_at=?,reference=? WHERE id=? AND status='unpaid'", paid, reference, payrollId),
      run(db, 'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE changes()>0', id('evt'), 'salary_paid', payslip.staff_id + ' net salary UGX ' + payslip.net + ' paid for ' + payslip.period, 'seiko', now()),
      run(db, "UPDATE staff_advances SET recovered_payroll_id=? WHERE staff_id=? AND recovered_payroll_id IS NULL AND amount<=COALESCE((SELECT SUM(r.amount) FROM payroll_advance_recoveries r JOIN payroll p ON p.id=r.payroll_id WHERE r.advance_id=staff_advances.id AND p.status='paid'),0)", payrollId, payslip.staff_id),
    ]);
    if (!changes(result[0])) bad('This payslip changed before payment was saved. Refresh and try again.', 409);
    return Response.json({ ok: true });
  }
  if (path === '/api/admin/erp/leave') {
    const leaveId = text(b.id, 'leave request ID', 100), status = enumValue(b.status, ['approved', 'rejected'], 'leave decision'), leave = await first(db, 'SELECT * FROM leave_requests WHERE id=?', leaveId);
    if (!leave) bad('Leave request not found.', 404); if (leave.status !== 'pending') bad('This leave request has already been reviewed.', 409);
    const reviewed = now();
    const result = await db.batch([run(db, "UPDATE leave_requests SET status=?,reviewed_at=? WHERE id=? AND status='pending'", status, reviewed, leaveId), run(db, 'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE changes()>0', id('evt'), 'leave_reviewed', leave.staff_id + ' leave ' + leaveId + ' ' + status, 'seiko', reviewed), ...(status === 'approved' && leave.start_date <= dayKey() && leave.end_date >= dayKey() ? [run(db, "UPDATE staff SET availability='on_leave',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM leave_requests WHERE id=? AND status='approved' AND reviewed_at=?)", reviewed, leave.staff_id, leaveId, reviewed)] : [])]);
    if (!changes(result[0])) bad('This leave request changed before it was saved.', 409);
    return Response.json({ ok: true });
  }
  if (path === '/api/admin/erp/task') {
    const taskId = b.id ? text(b.id, 'task ID', 100) : id('task'), existing = b.id ? await first(db, 'SELECT * FROM staff_tasks WHERE id=?', taskId) : null;
    if (b.id && !existing) bad('Task not found.', 404);
    const staff = await staffRecord(b.staff_id ?? existing?.staff_id, true), title = text(b.title ?? existing?.title, 'task title', 160), description = text(b.description ?? existing?.description ?? '', 'task description', 1200, false), due = validDate(b.due_date ?? existing?.due_date, 'task due date', true), status = enumValue(b.status ?? existing?.status ?? 'todo', TASK_STATUS, 'task status'), stamp = now();
    await db.batch([run(db, 'INSERT INTO staff_tasks (id,staff_id,title,description,due_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET staff_id=excluded.staff_id,title=excluded.title,description=excluded.description,due_date=excluded.due_date,status=excluded.status,updated_at=excluded.updated_at', taskId, staff.id, title, description, due, status, existing?.created_at || stamp, stamp), audit(db, 'staff_task_assigned', staff.id + ' task ' + taskId + ' updated')]);
    return Response.json({ ok: true });
  }
  if (path === '/api/admin/erp/session') {
    const sessionId = b.id ? text(b.id, 'session ID', 100) : id('session'), existing = b.id ? await first(db, 'SELECT * FROM training_sessions WHERE id=?', sessionId) : null;
    if (b.id && !existing) bad('Session not found.', 404); if (existing && existing.status !== 'scheduled') bad('Completed and cancelled session records cannot be edited.', 409);
    const staff = await staffRecord(b.staff_id ?? existing?.staff_id, true), title = text(b.title ?? existing?.title, 'session title', 160), starts = timestamp(b.starts_at ?? existing?.starts_at, 'session start time'), classId = b.class_id === '' ? null : b.class_id ?? existing?.class_id ?? null, status = enumValue(b.status ?? existing?.status ?? 'scheduled', ['scheduled', 'cancelled'], 'session status');
    if (classId && !await first(db, 'SELECT id FROM classes WHERE id=?', text(classId, 'class ID', 100))) bad('Linked class not found.', 404);
    let roster = memberIds(b.member_ids);
    if (roster === null && !existing) roster = classId ? (await all(db, 'SELECT member_id FROM bookings WHERE class_id=?', classId)).map(m => m.member_id) : [];
    if (roster) for (const group of chunks(roster, 50)) {
      const registered = await all(db, `SELECT id FROM members WHERE id IN (${group.map(() => '?').join(',')})`, ...group);
      if (registered.length !== group.length) bad('One of the selected members is no longer registered.', 404);
    }
    const statements = [run(db, "INSERT INTO training_sessions (id,staff_id,class_id,title,starts_at,ended_at,status,created_at) VALUES (?,?,?,?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET staff_id=excluded.staff_id,class_id=excluded.class_id,title=excluded.title,starts_at=excluded.starts_at,status=excluded.status WHERE training_sessions.status='scheduled'", sessionId, staff.id, classId, title, starts, status, existing?.created_at || now()), run(db, 'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE changes()>0', id('evt'), 'training_session_scheduled', staff.id + ' session ' + sessionId + ' ' + status, 'seiko', now())];
    if (roster && status === 'scheduled') {
      statements.push(run(db, "DELETE FROM session_members WHERE session_id=? AND EXISTS(SELECT 1 FROM training_sessions WHERE id=? AND status='scheduled')", sessionId, sessionId));
      for (const group of chunks(roster, 30)) statements.push(run(db, `INSERT INTO session_members (session_id,member_id,attended) SELECT ?,id,0 FROM members WHERE id IN (${group.map(() => '?').join(',')}) AND EXISTS(SELECT 1 FROM training_sessions WHERE id=? AND status='scheduled')`, sessionId, ...group, sessionId));
    }
    const results = await db.batch(statements);
    if (!changes(results[0])) bad('This session changed before the edit was saved. Refresh and try again.', 409);
    return Response.json({ ok: true });
  }
  if (path === '/api/admin/erp/expense') {
    if (b.id) bad('Recorded expenses are immutable. Add a separate adjustment through your accountant rather than rewriting cash history.');
    const category = text(b.category, 'expense category', 100), amount = integer(b.amount, 'expense amount', 1, 100000000), description = text(b.description, 'expense description', 600), incurred = timestamp(b.incurred_at, 'Expense payment date', { paid: true, fallback: true });
    const stamp = now(), cutoff = new Date(Date.now() - 60000).toISOString();
    const results = await db.batch([
      run(db, 'INSERT INTO business_expenses (id,category,amount,description,incurred_at,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM business_expenses WHERE category=? AND amount=? AND description=? AND substr(incurred_at,1,10)=substr(?,1,10) AND created_at>=?)', id('expense'), category, amount, description, incurred, stamp, category, amount, description, incurred, cutoff),
      run(db, 'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE changes()>0', id('evt'), 'business_expense_paid', category + ': UGX ' + amount + ' paid', 'seiko', stamp),
    ]);
    if (!changes(results[0])) bad('An identical expense was just recorded. Refresh the records before entering another payment.', 409);
    return Response.json({ ok: true }, { status: 201 });
  }
  return null;
}
