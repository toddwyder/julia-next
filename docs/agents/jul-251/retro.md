# JUL-251 retro

The installed-source exploration prevented a gateway wrapper that would have missed internal memory routes. The independent reviewer then found four defects that the initial green tests missed. Each now has a runtime regression and a detected guard mutation.

The first mutation run exposed two weak tests. One did not assert the free total. Another passed through a second credential-path check after the intended check was removed. Tightening the assertions and isolating the scenarios made both failures visible. The final rounding regression also caught a real discrepancy between admission and settlement before publication.

The stock manual reflection API does not carry the actor model context. A normal-turn reflection does. The proof now uses that path and explicitly labels its repeated-observation fixture, rather than reducing stock thresholds to make the run pass.

The remaining verification limit is narrow. The concurrent-process test proves the observed shared admission behavior, and removing admission guards makes it fail. There is no deterministic mutation proving that removing SQLite transaction locking alone fails the concurrent test. A barrier-based lock test would improve that proof. Live paid providers and subscription renewal were not exercised during the $0 trial.

Todd owns the merge decision after this retro. Delivery orchestration, running reviews, and the household's behavior remain outside JUL-251.
