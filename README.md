# GDR Clínica — Software Smiles

Custom **offline-first** practice-management application for **Global Dental Relief**'s
Mexico (Spanish-language) clinic — Phase 1.

Built to digitize GDR's existing paper chart station-by-station, with a
**numbered USB flash-drive** patient-transport flow that needs **no Wi-Fi, no
server, and no internet** during clinic operation.

> Implements the *GDR Product Overview & Engineering Specification V1.0*.

---

## Get the app

### Option A — Portable build (run immediately, no install)
A ready-to-run Windows folder is delivered as `GDR-Clinic-Windows-Portable.zip`.

1. **Extract the whole ZIP** to your PC (e.g. Desktop or `C:\GDR`).
2. Double-click **`GDR Clinic.exe`**.
3. On the SmartScreen prompt (app isn't code-signed yet): **More info → Run anyway**.

### Option B — Real installer (.exe) via GitHub Actions
The portable build is assembled on Linux, so its `.exe` carries the generic
Electron file icon and isn't code-signed. To get the **proper NSIS installer**
with the GDR icon, let GitHub build it on a Windows runner:

- Push to the `claude/confident-mayer-x9cxvu` branch (or run the
  **Build Windows Installer** workflow manually under the repo's *Actions* tab).
- CI publishes a **`v<version>`** GitHub Release with `GDR-Clinic-Setup-<version>.exe`
  (installer), the portable `.exe`, and `latest.yml` (the auto-update manifest).
  Download from the repo's **Releases** page, or from the run's **Artifacts**.
- Installs of this build then **auto-update** to future releases (see below).

### Option C — Build it yourself (on a Windows PC)
```bash
npm install
npm run dist
# -> release/GDR-Clinic-Setup-<version>.exe   (installer)
# -> release/GDR-Clinic-Portable-<version>.exe (no install)
```

---

## Logging in — username + password

Accounts replace PINs. Every seeded account's password is **`welcome123`** (with a
show/hide toggle on the login screen). Sign in as the **admin** account to open the
**Admin portal** (Accounts tab) and create accounts, change roles, or change
passwords.

| Username | Role | Default password |
|---|---|---|
| `admin` | Administrator (admin portal + checkout + reports) | `welcome123` |
| `frontdesk` | Check-In / Registration | `welcome123` |
| `doctor` | Dentist (Chair ×7) | `welcome123` |
| `hygienist` | Cleaning | `welcome123` |
| `fluoride` | Fluoride | `welcome123` |
| `checkout` | Checkout / Master | `welcome123` |

Passwords are salted + hashed (scrypt) in `users.json` (in `%APPDATA%\gdr-clinic\`),
never stored in plain text. The admin portal lets you create more accounts of any
role and reset any password. Clinic/language settings live in `config.json` (same
folder).

## Auto-updates

The installed app checks this repo's **GitHub Releases** on launch (and every 6h),
downloads a newer version in the background, and prompts to restart. To ship an
update: bump `version` in `package.json` and push — CI publishes a new
`v<version>` release with the `latest.yml` manifest the updater reads.

> Auto-update needs the repo to be **public** (or a token configured). It applies
> to the **installed** app only — the portable build does not self-update.

---

## The clinic flow (how it maps to the spec)

```
Check-In ─► (USB) ─► Dentist ─► (USB) ─► Cleaning ─► (USB) ─► Fluoride ─► (USB) ─► Checkout
  create patient        exam + tooth chart   P/D cleaning      OH3 + flúor      F/NV, upload
  consent + TTS         treatment plan       OH2 fallback                       to master DB,
  medical history       today's treatment                                      clear drive
  assign drive          OH2
```

- **Flash drive transport (§2.2):** each patient's chart travels on a numbered USB
  drive as `patient_00147.json` (named by number, never by name — §10.2), wrapped
  in a **checksum envelope** so corrupt/incomplete writes are detected (§10.3).
- **Master database (§2.3, §8.3):** local JSON store on the Checkout laptop
  (`%APPDATA%\gdr-clinic\master\master_db.json`). Authoritative record; export to
  JSON/CSV for cloud backup and re-import on the next deployment.
- **Returning patients (§7):** search by number/name; pending **NV** treatment is
  flagged; a free-text "Historia previa (papel)" field captures the 25-year paper
  archive opportunistically.
- **NV recall dashboard (§7.3):** checkout-only list of patients to bring back,
  longest-waiting first.
- **Reports (§8):** treatment counts (single/double/multi-surface fillings,
  composite, permanent/primary/surgical extractions, sealants, SDF, prophy/
  debridement, fluoride, OH lessons, totals, NV) filtered by date range, exported
  to **CSV / XLSX**; master DB export to **JSON / CSV**. Checkout (admin) only.
- **Tooth chart (§5.2, §6):** hybrid dentition — adult `1–32` + primary `a–t`,
  multi-select surfaces (`O M D B L F` → `DOB`…), treatment types, surgical
  (`extS`), "treating today" (underline), "complete" (slash).
- **Languages (§9):** the app **UI is English** by default; the **patient consent
  form is Spanish**; and **generated reports/exports are Spanish** — all three are
  independently configurable in `config.json` (`ui_language`, `consent_language`,
  `report_language`). UI strings live in `src/renderer/i18n/{en,es}.js`, report
  strings in `src/main/i18n.js` — no hardcoded text, so Phase 2 can add
  Khmer/Nepali/Tibetan/etc. The consent screen has an offline **Spanish
  text-to-speech** reader and signature capture.

---

## Project layout

```
src/
  main/        Electron main process (IPC, master DB, flash-drive I/O, reports, config)
  shared/      Pure logic shared with the UI: data model, dental codes, checksum
  renderer/    Spanish UI (vanilla SPA): views/ components/ i18n/ consent
assets/        App icon
scripts/       smoke-test.js (headless end-to-end logic test)
.github/       Windows build workflow
```

### Verify the logic (no GUI needed)
```bash
npm run smoke    # 12 end-to-end checks of the core clinic flow
npm start        # run the desktop app in dev (needs a display)
```

---

## Assumptions & open questions (spec §11.4)

These were given sensible, configurable defaults — confirm with GDR:

- **Patient numbering** starts at **1** (`config.patient_number_start`).
- **Consent text** is a complete Spanish **draft** in `src/renderer/consent.js`,
  clearly marked — replace with GDR's official wording (no code change needed).
- **Printing** a checkout/report summary is available via the browser print path.
- **Cloud destination** isn't wired in (export to file; staff transfer manually).
- **Master DB** lives on the Checkout laptop.

## Data store & Phase-2 readiness (§10.4)
Records carry a unique `id`, `last_modified`, a `synced` flag and `schema_version`,
and the flash-drive file format matches what a future server API would accept —
so Phase 2 sync needs no data migration. The JSON store sits behind a small
repository module (`src/main/db.js`) that can later be swapped for SQLite/server.

---

*Prepared by Software Smiles — Sidharth Rane, for Global Dental Relief.*
