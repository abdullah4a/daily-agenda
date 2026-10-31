# Deploying Daily Agenda to Vercel

The Nitro preset is `vercel` (set in `nuxt.config.ts`), so no extra configuration file is needed.

## 1. MongoDB Atlas

1. Create a cluster (the free M0 tier is enough) and a database user with read/write access to one database.
2. Network Access: Vercel functions have no fixed IPs. Allow `0.0.0.0/0` and rely on the user's strong password, or use Atlas private networking / Vercel's static IP add-on if you need to restrict it.
3. Copy the connection string (`mongodb+srv://...`) and add the database name, for example `.../daily-agenda?retryWrites=true&w=majority`. This is `MONGODB_URI`.

Indexes are created by Mongoose the first time the models are used; no migration step is needed.

## 2. SMTP

Used only for password-reset emails. Any provider works (Resend, Postmark, SES, Mailgun, a Gmail app password).

- Use port `587` (STARTTLS) or `465` (implicit TLS). A connection without TLS is refused in production.
- `SMTP_FROM` should be an address your provider has verified.
- If SMTP is not configured the reset endpoint still answers normally but no email goes out; check the function logs for `[mail] SMTP is not configured`.

## 3. Vercel project

Import the repository, framework preset Nuxt, default build command (`npm run build`). `npm install` runs `nuxt prepare` through the postinstall script.

### Environment variables

Set these in Project Settings, Environment Variables.

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | yes | Use a separate database for previews so test data stays out of production. |
| `NUXT_SESSION_PASSWORD` | yes | yes | 32+ random characters. Use a different value per environment. |
| `APP_BASE_URL` | yes | see below | Exactly the public origin, no trailing path. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | yes | optional | |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | yes | optional | `npx web-push generate-vapid-keys`. Rotating them invalidates existing push subscriptions. |
| `VAPID_SUBJECT` | yes | optional | `mailto:you@example.com`. Push services use it to contact you if your sender misbehaves. |
| `CRON_SECRET` | yes | optional | Long random string. |

#### APP_BASE_URL, including previews

Reset links are built from `APP_BASE_URL` only. In production the request Host header is never trusted, because a forged Host would let an attacker mail victims a link to their own site. Consequences:

- Production: set it to your domain, for example `https://agenda.example.com`.
- Preview deployments get a new URL each time (`https://<project>-<hash>-<team>.vercel.app`) and the app does not read Vercel's automatic URL variables. Either:
  - set `APP_BASE_URL` for the Preview environment to a stable URL (assign a domain to a Git branch in Project Settings, Domains) and test password reset on that URL, or
  - leave it unset for Preview: password-reset emails are then not sent there. Everything else works.
- A preview that shares production's `APP_BASE_URL` will mail links that point at production. Do not do that, and do not share the production database with previews.

Redeploy after changing any variable so the new value applies.

## 4. Reminder cron (every 5 minutes)

Push reminders are delivered by calling the app on a schedule. Vercel Cron on the Hobby plan runs at most daily, so use an external scheduler (cron-job.org, GitHub Actions, EasyCron, an uptime service, or Vercel Cron on a plan that allows it).

Request:

```
GET https://agenda.example.com/api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

`POST` works too. Schedule: every 5 minutes (`*/5 * * * *`).

Test it:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://agenda.example.com/api/cron/reminders
```

| Response | Meaning |
| --- | --- |
| `200` | Ran; the body reports what was sent. |
| `401` | Missing or wrong secret, or `CRON_SECRET` is not set on the server. |
| `503` | VAPID keys are missing or invalid. |

A GitHub Actions example (`.github/workflows/reminders.yml`):

```yaml
on:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://agenda.example.com/api/cron/reminders
```

GitHub may delay scheduled runs by several minutes; a dedicated scheduler is more punctual.

### Push endpoint allow-list

The server only calls these push services, over https on the default port:

- `fcm.googleapis.com` and `android.googleapis.com`, exactly (Chrome, Edge, Android). Other `googleapis.com` hosts are refused, because some serve customer content.
- `updates.push.services.mozilla.com` (Firefox)
- `*.push.apple.com` (Safari)
- `*.notify.windows.com` (Windows)

Subscribing from another host answers `400`. The cron run deletes any stored subscription outside the list and counts it under `removed`.

## 5. Rate limits

| Action | Limit |
| --- | --- |
| Login | 30 per 15 minutes per IP; 10 per 15 minutes per email and IP; 50 per 15 minutes per email |
| Forgot password | 10 per hour per IP; 5 per hour per email |
| Reset password | 20 per 15 minutes per IP |
| Signup | 10 per hour per IP |

The per-email login limit counts across all addresses, so a wide enough attack can block that account's logins until the window ends.

## 6. After the first deploy

1. Open the site, sign up, and set your timezone and reminder times in Settings.
2. Enable notifications in Settings and send the test notification. It is shown locally by this device's service worker and never goes through the server or the push service, so it proves permission and display only. To test delivery, wait for a reminder to fall due with the cron running.
3. Request a password reset to check SMTP and `APP_BASE_URL`: the link in the email must point at your domain.
4. Call the cron endpoint once with curl and confirm `200`.

## Troubleshooting

- Sessions reset after every deploy: `NUXT_SESSION_PASSWORD` is missing or differs between builds.
- `MONGODB_URI is not set`, or timeouts after 5 seconds: the variable is missing in that environment, or Atlas Network Access blocks Vercel.
- No reset email arrives: `APP_BASE_URL` or SMTP is unset; see the function logs.
- Reminders never arrive: the cron is not calling the endpoint (check the scheduler's history), the response is not `200`, or the browser has not granted notification permission.
