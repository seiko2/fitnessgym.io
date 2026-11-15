# Elite Fitness Gym Kampala

Complete source package for the public gym website, member portal, staff ERP workspace, and administrator dashboard.

**Start with [GITHUB-DEPLOYMENT.md](GITHUB-DEPLOYMENT.md)** for the upload and backend setup instructions for `seiko2`.

- Upload this folder's contents to a GitHub repository, including `.github/`.
- GitHub Pages publishes the prepared `docs/` marketing and member frontend.
- Deploy the included Worker and D1 migrations for registration, login, HR, payroll, reviews, and accounting.
- Set your backend origin in `docs/config.js`; its initial value is deliberately blank.
- No live member/staff records, passwords, private Sites identity, or runtime secrets are included.

Run `npm test` and `npm run build` with Node.js 24 or later. Further application notes are in [PROJECT-NOTES.md](PROJECT-NOTES.md).
