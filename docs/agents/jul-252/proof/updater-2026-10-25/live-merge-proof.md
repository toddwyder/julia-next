# Live mid-build merge proof

This file is committed on a small docs branch merged while the JUL-252 build is
running. The machine updater must defer the merge and the service restart until
the build worker exits. The updater's next poll after the worker exits applies
the merge; the dashboard and ledger show the build was not interrupted.

Merge time, the deferred poll output and the observed service PIDs are recorded
in `docs/agents/jul-252/proof/rerun-2-2026-10-25/report.md` after the run.
