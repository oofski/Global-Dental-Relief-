# Changelog

All notable changes to GDR Clinic are listed here. The matching version's notes
are published automatically to each GitHub Release (and read by the in-app
auto-updater).

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
