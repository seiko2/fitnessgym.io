# Elite Fitness Gym Kampala

Responsive public website, member portal, staff ERP workspace, and administrator dashboard adapted from the uploaded `reference/deno.py`. The four membership rates, optional trainer add-ons, adult BMI estimate, and membership-card workflow are carried into a web application. The command-line source is retained for provenance; hosted requests run in a Cloudflare Worker. See [GITHUB-DEPLOYMENT.md](GITHUB-DEPLOYMENT.md) for the complete portable deployment guide for `seiko2`.

## Features

- Durable D1 registration records, membership fees, trainer selection, charges, received payments, check-ins, and audit history.
- Automatic membership card generation with public verification QR; browser printing and saving to PDF.
- Required private height and weight measurements, measurement history, and registration from age 12. Members aged 12–17 require a parent or guardian's name, telephone, email, relationship, and consent. Siblings may share guardian contacts without needing separate personal email addresses. Adult BMI categories are not applied to minors.
- Private member access via a cryptographically random bearer token. The portal stores this access token on the registration device and offers a private recovery link. Records are stored on the server.
- Responsive administration, member search/edit/renewal, real-data charts, payment recording, attendance, class capacity and bookings, trainer profiles, plan settings, and CSV exports.
- Employee HR records, unique generated staff IDs and initial passwords, mandatory first password change, current availability, employment status, salary and usual pay day, attendance, tasks, and leave approval.
- Payroll by employee and month, allowances, manual deductions, partial advance recovery, separate salary-payment confirmation, printable payslips, and protection against duplicate salary payments. Staff can view only their own HR and payroll records.
- Training-session assignments and rosters. After the assigned employee completes a session and confirms actual attendance, participating members can leave one rating and review. Admin and staff progress reports use these actual records.
- Paid business-expense ledger and cash-basis profit/loss reports, monthly trends, profit margin, unpaid payroll, outstanding member balances, and unrecovered staff advances. An advance is a cash outflow once; recovery reduces later net salary rather than creating a second expense. Statutory taxes and other deductions are entered manually.
- Registration creates a pending membership. First full payment confirmation starts its validity period. Revenue represents recorded receipts, not registrations or outstanding charges.
- Membership durations are 1, 30, 90, and 365 days by default. Administrators can adjust future plan prices and durations without changing past charges.
- Fees in UGX; all displayed local times use Africa/Kampala. Default opening hours are 08:00–00:00.

## Operations

`npm test` runs the database-backed API tests using Node 24's SQLite module. `npm run build` produces the deployable Worker and embedded, self-hosted image/font assets in `dist/server/`.

The hosting manifest binds D1 as `DB`. Apply ordered pending migrations in `drizzle/` before serving new API code. The ERP migration preserves existing member, charge, payment, and membership records while enabling guardian representation. Never reset the database to update website content.

Set `ADMIN_PASSWORD_HASH` through the hosting platform's secret manager. The expected format is `pbkdf2_sha256$100000$saltHex$hashHex`. The supplied admin password is configured as a salted server-side hash; no plaintext credential is committed. The administrator username is `seiko`. Sessions use random tokens, server-side hashes, and secure HttpOnly cookies with an eight-hour lifetime.

The hosting platform's visitor access policy is separate from gym administration. This initial deployment preserves owner-only hosting access. A public launch requires changing visitor access in Sites sharing settings; the admin login continues to protect member data.

Payments are manually confirmed by gym staff. The website does not claim to process Mobile Money, bank cards, send emails, or deliver SMS automatically. WhatsApp links open a visitor's messaging app. Add payment/messaging providers separately when their business accounts are available.

Class schedules, employee records, payroll, expenses, and training sessions start empty until the administrator enters real records. Class bookings reserve a place on a recurring weekly class and remain until cancelled; staff should retire classes that no longer run. Session reviews are tied to separate dated, rostered training sessions. Trainer/facility images are representative stock photographs, not verified photos of the gym or its employees. Replace with actual gym photography for launch.

`npm run export:github -- /path/to/new-folder` prepares a complete sanitized source folder plus a project-relative `docs/` GitHub Pages frontend. GitHub Pages serves static files; deploy the included Worker/D1 backend for registration, protected workspaces, HR, payroll, and calculations. Set the backend origin in the exported `docs/config.js`. No live records or credentials are exported.

See `ASSET-SOURCES.md` for photography, fonts, and QR library sources.
