# LIRC STAT – Learning Information and Resource Center Statistical Tracking and Analysis Tool

**LIRC STAT** is a web-based occupancy tracking and statistical analysis system built with **React + TypeScript + Tailwind CSS + Supabase (PostgreSQL, Row-Level Security & Auth)** featuring a **Classic Literary** aesthetic (Walnut Brown, Warm Beige, Ivory, Burgundy, and Antique Gold paired with *Playfair Display* and *DM Sans*). It digitizes and automates 30-minute student occupancy monitoring across all six library areas of the Learning Information and Resource Center (LIRC).

---

## 1. Monitored Library Areas

1. **Filipiniana** (`FIL`) – 2nd Floor, East Wing
2. **Circulation** (`CIR`) – 1st Floor, Main Hall
3. **Periodicals** (`PER`) – 2nd Floor, North Wing
4. **Learning Commons** (`LC`) – 1st Floor, West Wing
5. **Discussion Rooms** (`DR`) – 3rd Floor, Study Suites
6. **Reference** (`REF`) – 2nd Floor, Central Hall

---

## 2. User Roles & Pre-Seeded Accounts

Default demo password for all pre-seeded accounts: `Password123!` (or sign in with **1 click** from the Login Portal).

| Role | Username | Email | Full Name | Area Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Librarian** | `librarian` | `librarian@lirc.edu.ph` | Dr. Elena M. Santos | Full Admin, Analytics, Corrections, Reports & Backups |
| **Student Assistant** | `sa_maria` | `sa.maria@lirc.edu.ph` | Maria Clara Reyes | Dynamic / Roving (Any of the 6 Library Areas) |
| **Student Assistant** | `sa_juanito` | `sa.juanito@lirc.edu.ph` | Juanito Pelaez | Dynamic / Roving (Any of the 6 Library Areas) |
| **Student Assistant** | `sa_isagani` | `sa.isagani@lirc.edu.ph` | Isagani Sandoval | Dynamic / Roving (Any of the 6 Library Areas) |
| **Student Assistant** | `sa_paulita` | `sa.paulita@lirc.edu.ph` | Paulita Gomez | Dynamic / Roving (Any of the 6 Library Areas) |
| **Student Assistant** | `sa_basilio` | `sa.basilio@lirc.edu.ph` | Basilio Santiago | Dynamic / Roving (Any of the 6 Library Areas) |
| **Student Assistant** | `sa_juliana` | `sa.juliana@lirc.edu.ph` | Juliana De Dios | Dynamic / Roving (Any of the 6 Library Areas) |

---

## 3. Implemented Modules & Features

### Student Assistant Module
- **Dynamic Six-Area Selection & Temporary Sessions:** Student Assistants are not permanently assigned to one area. They select any of the six library areas, activate a temporary monitoring session, record counts, and click **Exit Area** to switch to another area while preserving all submitted records.
- **Server-Synchronized 30-Minute Intervals (8:00 AM – 6:00 PM):** Uses official server time (`Asia/Manila`) to automatically identify the recording date and 30-minute interval (`08:00` through `18:00`), plus an Off-Hours Testing fallback outside operating hours with immutable server timestamps.
- **Duplicate Prevention & Immutability:** Strictly blocks duplicate submissions for the same `(date, time_slot, area_id)` at both the database and UI levels.
- **Student Assistant Dashboard:** Displays total submitted records, areas currently being monitored live, completed vs. missing recording intervals, recent submissions, and daily monitoring activity logs.

### Librarian Module
- **Statistics Dashboard:** Live monitoring sessions, total occupancy across all 6 areas, per-area breakdowns, hourly occupancy statistics (`8:00 AM – 6:00 PM`), daily occupancy trends, monthly totals, and missing occupancy interval tracking.
- **Automated Statistical Computation & Multi-Format Exporting:** Supports **Specific Date**, **Monthly**, and **Custom Date Range** reports with one-click export to:
  - **Excel (`.xlsx`)** – Multi-sheet workbook (Executive Summary, Hourly Summary, Daily Totals, Monthly Totals, 30-Min Slots, Missing Intervals, Detailed Logs)
  - **PDF (`.pdf`)** – Landscape institutional report with **embedded visual charts** and formatted tables
  - **Word (`.docx`)** – Microsoft Word document with **embedded visual charts** and formatted tables
- **Historical Records Management & Authorized Corrections:** Filter/search historical submissions, identify missing intervals, backfill missing entries, and apply authorized corrections with mandatory audit reasons.
- **Immutable Activity Logs:** Tracks occupancy submissions, record corrections/backfills, monitoring sessions, report generation & exports, logins/logouts, user management, and database backups.
- **User Accounts, Areas & Data Backup:** Create/edit accounts, update seating capacities, and download complete JSON database backup snapshots.

---

## 4. Database Setup (Supabase)

1. Open your Supabase project (`LIRC-STAT`) → **SQL Editor**.
2. Paste and run the complete idempotent migration script:
   - `supabase/migrations/20261118000000_lirc_stat_complete.sql`
3. Update `.env` with your `LIRC-STAT` **Project URL** and **Publishable Key**:
   ```env
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
   ```
4. Install dependencies and run locally:
   ```bash
   npm install
   npm run dev
   ```
