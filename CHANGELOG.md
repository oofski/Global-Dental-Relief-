# Changelog

All notable changes to GDR Clinic are listed here. The matching version's notes
are published automatically to each GitHub Release (and read by the in-app
auto-updater).

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
