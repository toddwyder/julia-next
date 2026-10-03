# 0010. Firestore on Firebase's free Spark plan for Julia's data

Date: 2026-10-03

Status: accepted. Supersedes the data part of ADR 0005 (PowerSync over a Postgres database).

Julia's data moves to Cloud Firestore on Firebase's free Spark plan. Firestore keeps a copy of
the data on each device, lets the app read and write it with no connection, and syncs when the
connection returns. Firebase Authentication handles Google sign-in. One service replaces two:
Supabase (the Postgres database) and PowerSync (the sync service).

Todd decided this after both free services paused for inactivity: PowerSync's free account
after a week idle (late September 2026), and the Supabase project `julia-next` after seven idle
days (2026-10-03). Keeping them awake would need a third piece, a scheduler that pings them, or
paid plans. Firebase's plan page names no inactivity pause on Spark; the only stop is exceeding
the free quota, which halts that product until the next month. Household use sits far below the
Spark limits (50,000 reads and 20,000 writes a day, 1 GiB stored).

ADR 0005 turned down Firebase for two reasons from the old Julia. Each is answered here:

- **Java emulators overloaded the runner.** We don't use the Firestore emulator. Tests run
  against a second, free Firebase project: real Firestore, no Java, no fakes.
- **Agents worked around Firebase's offline quirks.** Factory's tests and its independent review
  now stand between a builder and a merge. Offline behaviour is covered by integration tests
  against the real test project.

## Consequences

- The migration is done when Julia building starts, not before; it is listed on the
  "Journey 0 revisited" setup card (#183). Building the Factory stays first.
- The Supabase project `julia-next` stays paused. Its data is close to empty; nothing is
  carried over unless the migration finds something worth keeping. Supabase allows a restore
  until about 2027-01-01.
- The Supabase project and the PowerSync account are deleted once Firestore is live, along with
  their keys, settings and code.
- The old public Supabase table with row-level security off (alert of 2026-09-19) goes away
  with the project; the Firestore setup starts with security rules that admit only the
  household's two Google accounts.
- Vercel, Sentry and Axiom from ADR 0005 are unchanged.
