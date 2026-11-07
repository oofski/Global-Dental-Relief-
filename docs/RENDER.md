# GDR Clinic — web test copy on Render

A copy of the **same application** that runs in a web browser, so testers can
use it over the internet, from anywhere, without installing anything. Every push
to the project branch updates it automatically within a few minutes.

> **Test data only.** This site is on the public internet. Never enter real
> patient information — not even a real name. A purple bar on every screen says so.

## What's the same, and what's different

The screens and the logic behind them are not reimplemented — the browser runs
the exact same screens, and the server runs the exact same request handlers as
the desktop app (`src/main/api.js` is shared by both). A test checks on every run
that the two can't drift apart.

| | Desktop app | Web test copy |
|---|---|---|
| Flash drives | Real USB sticks | **Virtual drives 1–8** — pick one at check-in, then load the same number at each station. Each shows which patient (#) is on it. |
| Exports (CSV / Excel / master DB) | Saved to the laptop | Downloaded by your browser |
| "Import master DB" | Opens a file window | Same — your browser's file picker |
| "Choose folder…" | Pick a USB folder | Does nothing (use the virtual drives) |
| Software updates | Auto-updater | Not needed — every push redeploys |
| Signing in | Station login | **Site password first** (once per browser), then the same station login |

Several testers can work at once — each browser has its own login, so the
"doctor" and the "front desk" never overwrite each other. Each station can only
do what its own screens do: a tester signed in as the dentist cannot search the
patient ledger, upload a visit or pull a report, even by calling the server
directly.

## One-time setup (about 5 minutes)

1. Create a free account at **render.com** (sign up with GitHub is easiest).
2. In Render: **New → Blueprint**, connect GitHub, and choose the repository
   **oofski/Global-Dental-Relief-**.
3. Render reads `render.yaml` and asks for **`GDR_WEB_PASSWORD`**. Choose the
   site password your testers will use — **at least 12 characters** (the site
   won't start with a shorter one). A few random words works well, e.g.
   `harbor-violet-pencil-57`. Type it only into Render — never into a chat, an
   email thread, or the repository.
4. Click **Apply**. The first deploy takes a few minutes. Your site address will
   look like `https://gdr-clinic-test.onrender.com`.

## Giving testers access

Send each tester:

- the **site address**,
- the **site username** `gdr` and the **site password** (send the password
  separately from the link — e.g. by text message),
- the **station logins** — the same accounts as the desktop app:
  `frontdesk`, `doctor`, `hygienist`, `fluoride`, `checkout`, `admin`
  (password `welcome123` until an admin changes it in Settings).

On first boot the site loads an **invented demo clinic**: a week of 61 checked-out
patients (so Reports and the next-visit list have content), plus two children
already on drives — **#146 on virtual drive 1** (everything authorized) and
**#145 on virtual drive 2** (parent declined fillings and extractions, so the
dentist and hygienist see the red consent warning).

## How it is protected — and what that means for you

**The site password is the lock on the door.** Nothing on the site — not even
the sign-in screen — is reachable without it. Every wrong guess is answered only
after a delay, and the server refuses to start without a password of 12+ characters.

**The station logins are workflow, not security, on this site.** Their default
password `welcome123` is written in this public repository, so anyone who gets
past the site password can sign in as any station, including `admin`. That's
fine for a team of trusted testers. If you want station roles to actually keep
testers apart, change the station passwords in **Settings → Accounts** — and note
that on the free plan they reset on every deploy (see *Keeping test data*).

Also: an export can only be downloaded by the browser that made it, the server
only offers its own virtual drives (no other folder can be reached), and pages
are marked so search engines don't index them.

## Pushing live updates

Push to the branch `claude/confident-mayer-x9cxvu` and Render redeploys on its
own. Render only switches to the new version once it answers its health check,
so a broken push leaves the previous working version online.

**The desktop installer is not affected by ordinary pushes.** A new Windows
release is published only when `package.json` carries a **new version number**.
Pushes without a version bump still build the installer as a check, but never
replace one that clinics have already been given. Pushes that only touch the web
copy (`src/server`, `src/web`, `render.yaml`) skip the Windows build entirely.

## Keeping test data

On Render's **free** plan the site's data — patients *and* any changed station
passwords — is erased on every deploy and restart,
and the site goes to sleep after about 15 minutes with no visitors (the next
visit takes about a minute to wake it). Each wake-up starts again from the demo
clinic. That suits quick checks; it's frustrating for a multi-day test.

To keep data across deploys, switch to a paid instance with a disk (about
US $7/month for the instance plus a few cents per GB per month): in `render.yaml`
uncomment the `plan: starter` and `disk:` lines, add `GDR_DATA_DIR=/var/data`,
and push. Use **Clear patients** in the app to start a fresh test round.

## Running it on your own computer

```
npm install
GDR_WEB_PASSWORD=pick-one GDR_SEED_DEMO=1 npm run web
```

Then open http://localhost:10000 (username `gdr`).

## Checks

`npm run web-test` (31 checks) proves the web copy works: the browser and
desktop expose the identical interface; the site password, station sign-in and
role separation, export ownership, file-access limits and cross-site protections
all hold; and a full clinic visit runs in a real browser — front desk → dentist
(consent warning) → hygienist → checkout upload → report download → master DB
import — with two testers signed in as different roles at once. It needs
Playwright with Chromium installed.

## Settings reference

| Variable | Default | Purpose |
|---|---|---|
| `GDR_WEB_PASSWORD` | — (required) | Site password, 12+ characters. The server refuses to start otherwise. |
| `GDR_WEB_USER` | `gdr` | Site username. |
| `GDR_DATA_DIR` | temporary folder | Where the database and virtual drives live. Point at a disk to keep data. |
| `GDR_SEED_DEMO` | off | `1` loads the invented demo clinic when the database is empty. |
| `GDR_VIRTUAL_DRIVES` | `8` | Number of virtual drives (1–50). |
| `GDR_WEB_BANNER` | test-data warning | Text of the purple bar. |
| `PORT` | `10000` | Set by Render automatically. |
