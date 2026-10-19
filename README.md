# SETUP COMMANDS — QR Attendance App

> **Target:** First-year students | **Expo SDK:** 54 | **Expo Go:** 54.0.8

---

## USER ROLES

The app supports three roles. The role is stored in `profiles.role` and drives
which tabs appear. New sign-ups choose **Student** or **Teacher**;
**Administrator** accounts are promoted from the database (see below).

| Capability | Student | Teacher | Administrator |
|---|---|---|---|
| Create / log in to an account | ✅ | ✅ | ✅ |
| View personal information | ✅ | ✅ | ✅ |
| View available events | ✅ | – | ✅ |
| Scan event QR + record attendance | ✅ | – | – |
| View personal attendance history | ✅ | ✅ (own events) | ✅ (all) |
| Create / manage events | – | ✅ | ✅ |
| Generate / show an event QR code | – | ✅ | – |
| View & monitor attendance records | – | ✅ | ✅ |
| View attendance summaries / reports | – | ✅ | ✅ |
| Manage users (change roles) | – | – | ✅ |
| Correct / delete attendance records | – | – | ✅ |

Where each role lives in the app:

- **Student** — Home, **Events** (available events), Scan, History, Profile.
- **Teacher** — Teacher (create/edit/delete events, generate QR, attendance
  summary), History (per-event attendance + attendees), Profile.
- **Administrator** — Admin (manage users, manage events, correct/delete
  attendance, view reports), Events, History, Profile.

### Promoting an administrator

1. Sign the person up in the app (Student or Teacher).
2. In the Supabase SQL Editor run:
   ```sql
   update public.profiles set role = 'admin' where email = 'admin@school.edu';
   ```
3. Run `supabase/roles-and-rls.sql` once to enable the admin role and its
   Row Level Security policies.

---

## ATTENDANCE VALIDATION

Everything that must be blocked is checked in `registerAttendance()`
(`lib/attendance.ts`), in order, before any row is written:

| Must prevent | How |
|---|---|
| **Invalid QR codes** | `parseQRPayload()` (`lib/qr.ts`) rejects empty/non-JSON payloads, wrong versions, and payloads without a valid event code. |
| **Unauthorized recording** | The caller must be signed in, their profile role must be `student`, and they may only record their **own** attendance — the student id is taken from the authenticated session, never from the caller. |
| **Attendance for closed events** | The event is re-read from the database and rejected when `status = 'closed'` (or when the current time is outside its start/end window, using the database times — not the QR). |
| **Duplicate attendance** | A pre-check finds an existing row, and the unique `(student_id, event_id)` constraint rejects races with SQLSTATE 23505. |

**Database layer (defense in depth)** — run `supabase/attendance-validation.sql`
once. It adds:
- a unique index on `attendance (student_id, event_id)` for duplicates,
- a trigger that raises an error when inserting attendance for a closed event,
- updates the `attendance_insert` policy so only a signed-in **student** can
  insert a row for their own account.

So even if someone calls the API directly, the database still refuses invalid,
duplicate, closed-event, or non-student attendance.

---

## ATTENDANCE RECORDS

Every row written to `attendance` records the fields the system requires. The
`scanned_at` timestamp carries both the date and the time of check-in.

| Required field | Column | Where it's shown |
|---|---|---|
| **Student** | `student_id` (FK → `profiles`) | Student History, Teacher `My Events`, Event details, Admin → Attendance, Reports. |
| **Event** | `event_id` (FK → `events`) | Shown as the event title + code everywhere records appear. |
| **Date** | `scanned_at` (date part) | "Date:" line in History, Admin → Attendance. |
| **Time** | `scanned_at` (time part) | "Time:" line in History, Admin → Attendance. |
| **Attendance status** | `status` | `AttendanceStatusBadge` on every record; counts in Admin → Reports. |

### Attendance status

`status` is one of `present | late | excused | absent` (`AttendanceStatus` in
`lib/attendance.ts`, default `present`):

- The QR scan sets **`late`** when the check-in happens more than
  `LATENESS_GRACE_MINUTES` (15) after the event's start time, otherwise
  **`present`**. Events without a start time are always `present`.
- A student's confirmation card shows the resulting status.
- Administrators can correct a record to any status from Admin → Attendance →
  **Correct record**.

**Database setup** — run `supabase/attendance-records.sql` once. It adds the
`status` column (with a `check` constraint and a backfill), plus supporting
indexes for student, event and `scanned_at`.

---

## ATTENDANCE HISTORY

The **History** tab (`app/(tabs)/history.tsx`) is visible to every role and
adapts to who is signed in:

| Role | Sees | Source |
|---|---|---|
| **Student** | Their **own** attendance history — every event they checked in to, with date, time and status. | `getAttendanceHistory(user.id)` — filtered by `student_id = auth.uid()`. |
| **Teacher** | Attendance records for **their events** — each event with its attendee list, scan time and status. | `getTeacherEventAttendance(user.id)` — events where `created_by = auth.uid()`. |
| **Administrator** | Attendance records for the **whole system** — every student, event, date, time and status (read-only). | `getAllAttendanceRecords()`. |

Each view shows a count summary (events attended / scans recorded), and the
administrator can correct or delete records from **Admin → Attendance**.

**Row level security** (`supabase/roles-and-rls.sql`) enforces the same scoping
at the database, so these views can never leak another user's data:
students read only their own rows, teachers only rows for events they created,
and administrators all rows.

---

## QR ATTENDANCE FLOW

The full check-in flow, and where each step is implemented:

| # | Step | Where |
|---|---|---|
| 1 | **Teacher/Admin creates an event** | `app/event-editor.tsx` → `createEvent()` in `lib/events.ts` |
| 2 | **System generates a QR code** | `app/event-details.tsx` renders `react-native-qrcode-svg` from `buildQRPayload()` (`lib/qr.ts`). Creating an event jumps straight to this screen. |
| 3 | **Student scans the QR code** | `app/(tabs)/scan.tsx` — camera (Expo Camera) reads the QR. The tab is student-only. |
| 4 | **System validates the event** | `registerAttendance()` in `lib/attendance.ts` parses the payload, checks the event exists, has not started/finished, and is not closed. |
| 5 | **System records attendance** | A row is inserted into `attendance` (`student_id` + `event_id`); the unique constraint prevents duplicates. |
| 6 | **Student receives confirmation** | The Scan screen shows a confirmation card: event name, code, venue, time and the check-in time (or a clear reason if it failed / already registered). |

**QR payload:** `{ "v": 1, "event": "<event code>", "title": "…", "start": "…", "end": "…" }`.
Validation always re-reads the event from the database by its code, so a stale
QR cannot record attendance for a deleted or closed event.

**Roles:** only students can scan (`scan_attendance` capability); both teachers
and administrators can create events and display the QR code.

---

## EVENT MANAGEMENT

Teachers **and** administrators can fully manage events. A student can view
events but cannot create, edit or close them.

| Action | Teacher | Administrator |
|---|---|---|
| Create event | ✅ | ✅ |
| Edit event | ✅ (own) | ✅ (any) |
| View event | ✅ | ✅ |
| Close / re-open event | ✅ (own) | ✅ (any) |
| Delete event | ✅ (own) | ✅ (any) |
| Generate event QR code | ✅ | ✅ |

An event stores: **event name** (`title`), **date** + **time**
(`start_time` / `end_time`), **venue**, **description** and **status**
(`open` / `closed`), plus a unique event code.

Where these live:

- `app/event-editor.tsx` (new) — create or edit an event. All fields above are
  editable, including a date/time picker and an Open/Closed status control.
  Reachable from the Teacher tab and Admin → Events.
- `app/event-details.tsx` (new) — the "view" screen. Shows every field, the
  attendance list (staff only), an event QR code toggle (staff only), and
  Close / Reopen / Edit / Delete actions for whoever may manage the event.
  Students see a "Scan QR to Attend" button when the event is open.
- `lib/events.ts` — `createEvent`, `updateEvent`, `closeEvent`, `reopenEvent`,
  `setEventStatus`, `getEventById`, `getAvailableEvents` (excludes closed/ended
  events).
- Student attendance is rejected for closed events (`lib/attendance.ts`).

**Database:** run `supabase/event-management.sql` once to add the `venue`,
`description` and `status` columns.

---

## USER MANAGEMENT

**Role-based access** is centralized so rules live in one place:

- `lib/permissions.ts` — a capability matrix mapping each action
  (`manage_users`, `correct_attendance`, `browse_events`, …) to the roles that
  may perform it, plus a `can(role, capability)` helper and `ROLE_INFO`
  descriptions.
- `components/RoleGate.tsx` — a guard component: `<RoleGate allow={['admin']}>…</RoleGate>`
  shows the restricted message instead of the content for other roles. The
  Teacher and Admin screens are wrapped in it.
- **Tabs** (`app/(tabs)/_layout.tsx`) are shown/hidden per role using the same
  capability matrix.

**Dedicated profiles** — the Profile tab renders a different screen per role
(`app/(tabs)/profile.tsx`):

| Profile | Shows |
|---|---|
| **Student Profile** | Name/email/ID, events attended, available events, most recent attendance, student privileges |
| **Teacher Profile** | Name/email/ID, events created, total scans, active events, teacher privileges |
| **Administrator Profile** | Name/email/ID, total users, events and scans, admin privileges |

Every signed-in user can edit their own display name from their profile.

**Administrator user management** — the Admin tab → **Users** section lists every
account with a students/teachers/admins summary and lets an administrator change
any user's role (which immediately changes what that account can access).

---

## AUTHENTICATION

All authentication is handled by Supabase Auth. The app never stores a plaintext
password — Supabase hashes credentials server-side and only the resulting
session token is kept on the device.

| Feature | Where it lives |
|---|---|
| **Registration** | `app/register.tsx` → `supabase.auth.signUp` (name + role stored in user metadata) |
| **Login** | `app/login.tsx` → `supabase.auth.signInWithPassword` |
| **Logout** | Profile tab → `signOut()` in `lib/auth.ts` |
| **Session handling** | `lib/auth.ts` → `initializeAuth()` restores the saved session on launch and `onAuthStateChange` keeps the app in sync (login/logout/token refresh). Sessions persist via `lib/storage.ts` (SecureStore on device, `localStorage` on web). |
| **Password protection** | `lib/validation.ts` enforces the policy; `components/PasswordInput.tsx` hides characters by default; reset flow in `app/forgot-password.tsx` + `app/reset-password.tsx`. |

**Password policy:** at least 8 characters with an uppercase letter, a lowercase
letter and a number (checked in `app/register.tsx` and `app/reset-password.tsx`
before submitting).

**Email links:** verification and password-reset emails return to
`app/auth/callback.tsx`, which exchanges the token for a session and routes the
user into the app. Add your redirect URL(s) to **Supabase → Authentication → URL
Configuration → Redirect URLs** (e.g. `qr-attendance://auth/callback` for a
build, `exp://<your-lan-ip>:8081/--/auth/callback` for Expo Go).

---

## PREREQUISITES

| Tool | Download | Verify |
|---|---|---|
| Node.js (LTS) | https://nodejs.org/en | `node --version` |
| VS Code | https://code.visualstudio.com | (open it) |
| Expo Go 54.0.8 | Play Store → "Expo Go" | (version in app settings) |

---

## STEP 1 — Create the App

```powershell
cd D:\QR-ATT
npx create-expo-app@latest qr-att

# When prompted, select "SDK 54"
# Wait for npm install (~2 min)
```

---

## STEP 2 — Install Matching Versions

The default install may need these fixed versions that match Expo Go 54.0.8:

```powershell
npm install expo@~54.0.35 react@19.1.0 react-native@0.81.5 expo-router@~6.0.24 @expo/vector-icons@^15.0.3 expo-linking@~8.0.12 expo-constants@~18.0.13 expo-font@~14.0.12 expo-status-bar@~3.0.9 expo-splash-screen@~31.0.13 react-native-screens@~4.16.0 react-native-safe-area-context@~5.6.0 react-native-gesture-handler@~2.28.0 react-native-reanimated@~4.1.1 react-dom@19.1.0 react-native-web@~0.21.0 @types/react@~19.1.0 typescript@~5.9.2 --legacy-peer-deps
```

---

## STEP 3 — Start

```powershell
npx expo start
```

Scan QR code with Expo Go. Or press `W` for web.

---

## TROUBLESHOOTING

| Problem | Solution |
|---|---|
| npm install fails | Use `npm install --legacy-peer-deps` |
| App crashes in Expo Go | Make sure all versions match STEP 2 exactly |
| QR won't scan | Phone + computer on same WiFi |
| White screen | Wait 10s, or shake → Reload |
| TypeScript errors | Run `npx tsc --noEmit` |
