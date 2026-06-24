# Changelog

All notable changes to GDR Clinic are listed here. The matching version's notes
are published automatically to each GitHub Release (and read by the in-app
auto-updater).

## v1.2.1 — 2026-06-24
- **Auto-update is now visible and reliable.** Previously the app downloaded new
  versions silently and only showed it inside the admin Settings page, so most
  users never knew an update was ready (it only applied when the app happened to
  quit). Now a **banner appears for every user on every screen** when an update is
  downloading or ready, with a one-click **"Restart & update"**.
- **Portable build:** the portable .exe can't update itself (only the installed
  version can). It now says so clearly and offers an **"Open downloads"** button to
  grab the latest installer, instead of silently doing nothing.
- **Diagnostics:** the updater now writes an `update.log` (in the app's data
  folder) and surfaces errors, so a failed update can actually be diagnosed.
- Re-checks for updates when you return to the app, and the "Install & restart"
  now reliably relaunches the app after updating.

## v1.2.0 — 2026-06-24
Client action items from the June 22 call. Each request was first audited against
the current app; items already built were left alone (see "Already in place").

### Doctor station
- **Tooth chart:** the **"healthy" (green) status is retired** from the health-status
  cycle (now just watch → urgent). Existing records that already have a "healthy"
  mark still display — it's archived, not deleted, so it can be re-enabled later.
- **Fluoride guidance:** the recommend-fluoride control stays a plain manual
  checkbox (no automation). Added on-screen guidance — fluoride is recommended for
  everyone *except* after an **adult (permanent) tooth extraction**; baby-tooth
  extractions still get fluoride. When an adult extraction is charted, the doctor
  (and the fluoride station) now see a reminder to uncheck fluoride if appropriate.

### Hygienist station
- Added the missing **fluoride** field and a **prophy / debridement** selector
  (mutually exclusive, same control as the doctor uses), alongside the existing
  **OH2** — so the hygienist can record all four directly.

### Fluoride station
- **Blocks treatment when the doctor did not recommend fluoride.** If the record
  shows fluoride is not recommended, plugging in the drive shows a stop screen and
  the patient is sent onward — treatment can't proceed. (Only an explicit "no"
  blocks; patients with no doctor decision are still allowed fluoride.)

### Checkout station
- **Completed vs. not-treated:** the records person can now mark each planned
  treatment item **Finished** or **Not done (ND)** at checkout, auto-populated from
  the doctor's drive record. ND items are excluded from the treatment-count reports.

### Patient flow
- **Patients who skip the doctor are fully supported** (cleaning-only, no-treatment
  → straight to fluoride, or returning patients going straight to the hygienist).
  Downstream stations show a "no dentist exam on this record" banner, fluoride stays
  allowed by default, and reports don't miscount these visits.

### User accounts & admin
- **Trip-leader logins:** create a named account with **first + last name** and give
  it the **Admin** role for full patient-file access.

### Already in place (verified, no change needed)
- Doctor's prophy/debridement is already a single-select (mutually exclusive) control.
- The fluoride station already loads patient data from the USB and shows OH3 + fluoride.
- Clear-drive already fully deletes the patient file so the same USB can be reused.

### Quality
- New `npm run feature` suite (54 data-layer assertions for the above). Full
  regression pass: smoke 16/16, flow 198/0, feature 54/0, e2e 20/20 (real app).

## v1.1.6 — 2026-06-24
- **Fixed a critical data-loss bug: work entered at the chair now actually
  saves.** A testing pass driving the real app found that the Dentist, Cleaning,
  Fluoride and Checkout screens were editing a *detached copy* of the visit, so
  newly-charted treatment, OH/cleaning/fluoride marks, and the checkout care
  checklist could be silently discarded on save. The stations now edit the live
  patient record, so everything persists to the flash drive, the master
  database, and the reports.
  - Root cause: those screens read the working visit through the secure
    main/renderer bridge, which hands back a *clone* (not the original) — edits
    to it never reached the record that gets written. Fixed by resolving the
    working visit locally in the UI and removing the bridge shortcut so the
    mistake can't recur.
- Added a full **end-to-end UI proof** (`npm run e2e`) that launches the real
  app and drives an actual clinician flow — chart a tooth → save → confirm it
  lands on the drive, the master DB, downstream stations, the checkout
  checklist, and the reports table. All 20 checks pass (the 5 that exposed this
  bug now pass too). Test-only hooks are env-gated and never affect normal use.

## v1.1.5 — 2026-06-24
- Full data-flow audit + integration testing of the station → station → checkout →
  reports pipeline (new `scripts/flow-test.js`, 198 assertions: happy path,
  out-of-order saves, stale-copy merges, NV carry, two-laptop, full round-trip —
  all pass). Confirmed checked items move and accumulate correctly with no loss or
  double-counting.
- Fixed: the dentist's "no fluoride" decision could be reverted by a later default
  during merge — `fluoride_recommended` now stays off once set (regardless of save
  order).
- Fixed: reports counted "fluoride recommended" for every visit (it defaults on at
  check-in) — now only counts visits the dentist actually examined.

## v1.1.4 — 2026-06-24
- **Brand alignment to the GDR Graphic Standards.** Applied the official Global
  Dental Relief logo (real logo mark in the header + window/installer icon, full
  lockup on the login screen), the brand globe palette (Dental blue, Light blue,
  Relief purple, GDR Orange, brown, gold), the Myriad-Pro-substitute UI typeface
  (bundled Source Sans 3) with **Georgia** for the progress reports/exports.
- Front-end polish pass: fixed white-on-color contrast to meet WCAG AA (kept the
  bright brand colors for tints, darker brand-blue for text surfaces), removed
  leftover non-brand colors, and tidied the type scale.

## v1.1.3 — 2026-06-18
- **Fixed: station work now persists to the patient record and reports.**
  Previously the dentist/cleaning/fluoride stations wrote only to the flash
  drive, so OH/cleaning/fluoride/treatment work never reached the master database
  (which reports and checkout read) until checkout upload — and could be missed
  entirely. Now every station merges its work into the master record on load and
  on save, so it accumulates immediately and shows everywhere.
- Hardened the record merge to combine visits **field-by-field** (OR the
  completion flags, union treatment items by id, keep the latest scalars) so one
  station's save can never clobber another's.
- Cleaning & Fluoride now show the doctor's accumulated treatment (and a treatment
  summary), not "(0)".
- Checkout gained a per-patient **treatment summary** (counts of work performed
  this visit) and reliably shows work accumulated across stations.
- Reports now reflect station work as it happens, not only checkout entries.

## v1.1.2 — 2026-06-18
- The Checkout "ending form" Care checklist is now **interactive**: the operator
  can tick off **cleaning completed, fluoride completed, and OH1/OH2/OH3** directly
  on the final form to confirm or correct anything missed upstream. These marks
  upload to the master database.
- Visit history now shows each visit's **cleaning / fluoride / OH** status so
  prior visits read correctly everywhere they appear.
- (Analysis confirmed the station-to-checkout data flow itself was already
  correct; the gap was that the ending form was read-only.)

## v1.1.1 — 2026-06-18
- **Cleaning & Fluoride stations** now show full patient context: medical history,
  the treatment the doctor charted this visit, and visit history.
- **Treatment notes auto-fill** from the tooth chart as the doctor marks teeth
  (still editable) — no more retyping codes.
- **Tooth chart health screening:** a "Health status" mode to quickly mark teeth
  green (healthy) / yellow (watch) / red (needs care), layered under the existing
  treatment colours.
- **Tooth chart layout dropdown:** Hybrid (mixed), Full adult (1–32), or Full
  primary (a–t).
- **Cleaning & fluoride tracking** is now explicit everywhere: the doctor can
  recommend fluoride (and cleaning), and Checkout/Admin show a Care checklist of
  Recommended vs Completed for cleaning, fluoride, and OH1/OH2/OH3. Reports add
  "Cleanings recommended" and "Fluoride recommended" counts.

## v1.1.0 — 2026-06-18
- Added **Clear patients** — reset this computer's patient ledger to start a new
  clinic day or deployment. Available to **front desk**, **checkout**, and
  **admin** (not the clinical chair stations).
- Safety: a backup of the master database is **exported automatically** before
  wiping, and the operator must **type a confirmation keyword**. An optional
  "reset patient numbering" starts a truly fresh ledger.
- Server-side guard restricts the action to records-handling roles.

## v1.0.9 — 2026-06-16
- The Check-In **medical-history form is now shown in the patient's language**
  (Spanish) — the parent/guardian reads and fills it in their native language,
  while the rest of the staff interface stays English. Driven by
  `consent_language` (configurable in Settings → Clinic).
- The dentist's read-only medical summary remains in the staff (English) language.

## v1.0.7 — 2026-06-16
- Refreshed the app icon to a royal-blue mark that matches the new theme (the
  previous teal icon clashed). This is a placeholder pending the official Global
  Dental Relief logo file, which will replace it across the app icon, installer,
  header, login, consent form, and report letterheads.

## v1.0.6 — 2026-06-16
- Renamed the application to **Mexico Clinic - Global Dental Relief** (header,
  window title, login, and clinic-name default; existing installs auto-migrate).
- Sleeker, more structured UI: **royal-blue** palette, crisper squared edges,
  defined borders, underline-style tabs, and tabular reports — a more robust
  "operations console" look (less rounded).
- Added **Software Smiles™** trademark marks and **© 2026** copyright notices on
  the login screen, header, and exported reports.

## v1.0.5 — 2026-06-16
- Add a reproducible fake-data generator (`scripts/make-sample-data.js`) that
  produces ready-to-load patient drive files and a master-DB import for testing
  the full workflow (Reports, NV dashboard, returning-patient search).
- Keep generated sample data out of version control.

## v1.0.4 — 2026-06-16
- Admin **Settings** (replaces the Accounts tab): Accounts (now with an email
  field per user), Clinic settings (name, deployment, patient-number start, and
  language selectors), and Updates (Check for updates / download / Install &
  restart, with live status).
- Staff interface is now consistently **English**: fixed the tooth-chart
  treatment/surface labels, the on-screen Reports table, and a stray Spanish
  toast. The patient **consent form stays Spanish**, and exported report **files**
  stay Spanish (configurable in Settings).
- Visual refresh across the app (header, login, cards, buttons, tabs, tooth
  chart, tables) — warmer, more polished, less generic.
- Spec-compliance audit: all five stations, flash-drive flow, data model,
  reporting, NV dashboard, and returning-patient flow verified against the
  product overview.

## v1.0.3 — 2026-06-16
- Clinic name is now "Mexico Clinic" (was "GDR — Clínica México"); existing
  installs auto-migrate the old seeded name on next launch.
- Fixed remaining Spanish UI text: the simulation drive label and the native
  file-picker dialog titles now follow the app (English) language.
- Window title set to "Mexico Clinic — Software Smiles".

## v1.0.2 — 2026-06-16
- Per-version release notes: each GitHub Release now shows the changes for that
  version (sourced from this file).
- Auto-update verified end-to-end: releases publish the installer, blockmap, and
  `latest.yml` update manifest.
- Version bumped so installed v1.0.0 apps can see and install an update.

## v1.0.0 — 2026-06-16
- Initial Windows release of GDR Clinic (Phase 1, Mexico).
- Five clinical stations: Check-In, Dentist, Cleaning, Fluoride, Checkout.
- Username + password login with a show/hide toggle (replaces PINs); accounts are
  scrypt-hashed. Admin portal to create accounts, assign roles, and change
  passwords. Default accounts seeded with password `welcome123`.
- Numbered USB flash-drive patient flow with integrity checks; local JSON master
  database; returning-patient search and NV recall dashboard.
- Hybrid tooth chart (adult 1–32 + primary a–t), treatment codes, and
  end-of-clinic treatment-count reports (CSV / XLSX / JSON).
- App interface in English; patient consent form and generated reports in Spanish
  (all configurable); offline Spanish text-to-speech for the consent form.
- In-app auto-update from GitHub Releases.
