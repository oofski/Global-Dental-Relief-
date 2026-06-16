# Changelog

All notable changes to GDR Clinic are listed here. The matching version's notes
are published automatically to each GitHub Release (and read by the in-app
auto-updater).

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
