# Daily Agenda

A Nuxt 3 progressive web app for planning your day: a morning and an evening prompt, a time-blocked schedule you can check off, history, weekly insights and push reminders. It works offline; changes are queued on the device and synced when the connection returns.

Stack: Nuxt 3, Pinia, Tailwind, MongoDB (Mongoose), nuxt-auth-utils (cookie sessions), web-push, Nodemailer, Vitest.

## Requirements

- Node.js 20 or newer
- A MongoDB database (local Docker for development, MongoDB Atlas in production)

## Local setup

```bash
npm install            # also runs `nuxt prepare` (postinstall) to generate .nuxt types
cp .env.example .env   # then fill it in, see the table below
```

### MongoDB in Docker

```bash
docker run -d --name daily-agenda-mongo -p 27017:27017 -v daily-agenda-mongo:/data/db mongo:7
```

Then set in `.env`:

```
MONGODB_URI=mongodb://127.0.0.1:27017/daily-agenda
```

Stop and restart it with `docker stop daily-agenda-mongo` and `docker start daily-agenda-mongo`. A standalone server is enough: the app does not use multi-document transactions.

### Generate secrets

```bash
# NUXT_SESSION_PASSWORD (at least 32 characters) and CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (push notifications)
npx web-push generate-vapid-keys
```

### Run

```bash
npm run dev          # http://localhost:3000
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string. Include the database name. |
| `NUXT_SESSION_PASSWORD` | yes | Key that seals the session cookie. 32+ characters. Changing it signs everyone out. |
| `APP_BASE_URL` | production | Public origin used in password-reset links, for example `https://agenda.example.com`. In production there is no fallback to the request Host header, so without it reset emails are not sent. In development it falls back to the request origin. |
| `SMTP_HOST` | for email | SMTP server host. |
| `SMTP_PORT` | for email | SMTP port. `465` uses implicit TLS; other ports require STARTTLS (`587`). |
| `SMTP_USER` | for email | SMTP username. Also the sender if `SMTP_FROM` is empty. |
| `SMTP_PASS` | for email | SMTP password. |
| `SMTP_FROM` | for email | Sender address, for example `Daily Agenda <no-reply@example.com>`. |
| `VAPID_PUBLIC_KEY` | for push | Public key for web push. Served to the browser. |
| `VAPID_PRIVATE_KEY` | for push | Private key for web push. Keep secret. |
| `VAPID_SUBJECT` | for push | Contact for push services: `mailto:you@example.com` or an `https:` URL. Defaults to `mailto:noreply@example.com`; set your own. |
| `CRON_SECRET` | for reminders | Shared secret the scheduler sends as `Authorization: Bearer <secret>`. If unset, every cron request is rejected. |

`NUXT_SESSION_PASSWORD` is read by nuxt-auth-utils. The other variables are read by the server at runtime. Without SMTP the app still runs; password-reset emails are skipped with a warning in the log. Without the VAPID keys and `CRON_SECRET`, reminders are disabled.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build (Vercel preset by default) |
| `npm test` | Vitest suite (needs MongoDB) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `nuxt typecheck` (vue-tsc) |

### Running tests

The tests talk to a real MongoDB, so start the Docker container above and make sure `MONGODB_URI` is set (the tests load `.env` if it is not already in the environment).

```bash
npm test
npx vitest run tests/entries.test.ts     # one file
```

Each test file uses its own database named `daily-agenda-test-<area>` (the database in the URI is overridden), and files run one after another. Your development database is not touched. The test databases can be dropped at any time.

### Production build locally

```bash
NITRO_PRESET=node-server npm run build
PORT=3000 node --env-file=.env .output/server/index.mjs
```

Use the default preset (plain `npm run build`) for Vercel output.

## First run

New accounts start with an empty schedule. Today and Schedule offer "Add your first block" or "Use Franklin's daily template", which saves Benjamin Franklin's routine as the user's schedule. Existing accounts keep what they have stored.

Answers on Today save as you type, and Save collapses a field into a read view. Schedule changes save as soon as a block is added, edited or removed.

## Reminders

Push reminders are sent by `GET` or `POST /api/cron/reminders`, which must be called every 5 minutes with `Authorization: Bearer $CRON_SECRET`. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md) for Vercel, MongoDB Atlas, SMTP and the cron setup.
