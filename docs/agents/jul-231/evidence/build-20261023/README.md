# Build evidence

`provenance.tar.gz` retains the Beam requests, generated source responses, session events and cumulative ledger snapshots. `provenance-index.json` gives each member's name, size and SHA-256. Provider reasoning fields were removed from direct responses before archival. Source output and usage fields remain.

The readable test logs show the final checks. Red logs and the saved-input reproduction retain failures found and repaired during implementation. They are not acceptance Proof.

The real server Proof is in the sibling `server-proof-20261023` directory. Its job files contain the actual saved inputs, model events, cap refusal and ledger for the practice build.
