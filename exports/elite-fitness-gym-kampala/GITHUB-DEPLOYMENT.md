# Put Elite Fitness Gym Kampala on GitHub

This folder contains the complete application source, photographs, fonts, database migrations, tests, and a GitHub Pages copy of the public website. It contains no live member data, employee data, passwords, runtime secrets, or private Sites project identity.

GitHub Pages serves static files. It cannot execute the Python reference program, a Cloudflare Worker, database queries, payroll calculations, or login sessions. Use Pages for the public website and a Worker with a D1 database for registration, member records, staff accounts, and administration. You can also host the entire website on the Worker without GitHub Pages.

## Folder contents

| Path | Purpose |
| --- | --- |
| `docs/` | Ready-to-upload GitHub Pages public website, with relative asset paths. |
| `public/` | Original frontend for the full application, including admin and staff workspaces. |
| `src/` | Server API, authentication, membership, HR, payroll, review, and accounting code. |
| `drizzle/` | Ordered database migrations. |
| `scripts/` | Build, validation, export, and password-hash helpers. |
| `tests/` | Automated API tests; test credentials are fixtures only. |
| `reference/deno.py` | Uploaded command-line program retained as the source specification. |
| `.github/workflows/pages.yml` | Publishes `docs/` using GitHub Actions. |
| `wrangler.jsonc.example` | Portable backend configuration template. |

## 1. Upload the folder to your GitHub account

1. In `seiko2`, create a repository such as `elite-fitness-gym-kampala`.
2. Upload the **contents** of this folder to its root. Include the hidden `.github` directory. Keep the default branch named `main`, or update the workflow's branch name.
3. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
4. Open **Actions → Publish gym website to GitHub Pages** and run it, or push a change to `docs/`.

For that repository name, the public address is normally `https://seiko2.github.io/elite-fitness-gym-kampala/`. If your repository is instead named `seiko2.github.io`, Pages serves the root account address. Asset paths in `docs/` support either layout.

The marketing website can display immediately. Registration, member records, and reviews need the backend below. Admin and staff links open their workspaces on the configured backend origin so protected sessions remain on that origin.

## 2. Deploy the backend and database

Install Node.js 24 or later. From this folder, run:

```sh
npm test
npm run build
npx wrangler@4 login
npx wrangler@4 d1 create elite-fitness-gym-kampala
```

Copy `wrangler.jsonc.example` to `wrangler.jsonc`. Replace `REPLACE_WITH_YOUR_D1_DATABASE_UUID` with the database ID returned by the create command. Keep the binding named `DB`, and keep `migrations_dir` pointing to `drizzle`.

Apply all pending schema migrations. This preserves existing records when updating:

```sh
npx wrangler@4 d1 migrations apply DB --remote --config wrangler.jsonc
```

Configure a new administrator password. This helper hides terminal input and prints only a salted PBKDF2 hash:

```sh
node scripts/hash-password.mjs
npx wrangler@4 secret put ADMIN_PASSWORD_HASH --config wrangler.jsonc
```

Paste the generated hash into Wrangler's secret prompt. Keep it out of GitHub, source files, screenshots, and public configuration. The administrator username is `seiko`. The password from the original hosted Site is not included in this export.

Deploy:

```sh
npm run build
npx wrangler@4 deploy --config wrangler.jsonc
```

Wrangler returns the application URL. The complete website is also available at that URL; the administrator workspace is `/admin`, and staff sign in at `/staff`.

## 3. Connect GitHub Pages to the backend

Edit the first `window.ELITE_API_BASE` assignment in `docs/config.js`:

```js
window.ELITE_API_BASE = 'https://YOUR-DEPLOYED-WORKER.workers.dev';
```

Use the actual HTTPS origin returned by deployment, with no `/api` suffix. Keep `window.ELITE_PAGES_BUILD = true` in the Pages copy. Commit this public configuration and let the Pages workflow publish it.

The backend's `PUBLIC_ORIGINS` variable must contain the exact Pages origin `https://seiko2.github.io`. A project repository path is not part of an origin. For a custom domain, add its HTTPS origin to that comma-separated variable and redeploy. Only public/member API routes accept approved cross-origin requests; staff and admin workspaces remain on the backend origin.

To reuse the existing Sites deployment as the API, its visitor access must first allow your intended gym visitors. Owner-only Sites hosting blocks anonymous Pages visitors even when the application CORS allowlist is correct. A public Worker avoids that separate private Sites gate. This export does not change sharing permissions.

## 4. Start operating the gym

- Register members from age 12. A parent or guardian must represent members aged 12–17 and provide the requested contact details and consent. Required height and weight are recorded privately.
- Staff record received membership payments; registration alone does not create revenue. Keep each unique reference accurate.
- Create employees in the admin HR area. The system generates a unique staff ID and a one-time initial password; pass it to the intended employee privately. Employees change that password on first sign-in.
- Create actual training sessions and assign members. Staff complete the session and mark actual attendance before those members can submit a review.
- Enter salary periods, allowances, deductions, advances, and actual salary payments. Record other paid business expenses separately.
- The finance dashboard shows a **cash-basis operating result from recorded transactions**. It subtracts paid net salaries, paid staff advances, and recorded business expenses from received membership payments. Advance recovery reduces later net salary; it is not charged as a second cash expense. Unpaid payroll and member balances appear separately.

The application does not calculate statutory tax, pension, or other legal payroll contributions automatically. Enter applicable deductions deliberately. It does not take Mobile Money/card payments or send messages automatically; payment recording is performed by staff and contact links open the visitor's chosen app.

Keep production database backups outside public GitHub repositories. Actual personnel records, medical measurements, guardian contacts, and payroll information belong in the protected database, never in `docs/`, fixtures, or committed JSON files.

## Update the application

Make changes in `public/` or `src/`, run the tests and build, apply any new migrations, and deploy the Worker. Regenerate the Pages copy with:

```sh
node scripts/export-github.mjs ./exports/elite-fitness-gym-kampala
```

Copy that export's `docs/` into your repository and reapply your backend origin in `docs/config.js`. The export intentionally resets the Pages API origin to blank so a private deployment URL or an environment-specific setting is not distributed accidentally.
