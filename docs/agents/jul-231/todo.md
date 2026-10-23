# JUL-231 build todo

- [x] 1. `how` over the affected subsystem.
- [x] 2. `architect` for parallel design exploration.
- [x] 3. Write the throughput checkpoint as four todo items.
- [x] 4. Delegate code-writing to a subagent using your configured feature model.
- [x] 5. Verify on the matching surface.
- [x] 6. Rebase into small, ordered commits. Stack follow-ups.
- [x] 7. If the design is contested, `interrogate` before shipping.
- [x] 8. Run **Opening a PR**.

## Throughput checkpoint

- Blocking first steps. Read the saved card, current main and morning host evidence. Qualify Beam through the unchanged core.
- Independent workstreams. Exploration and two design sketches can run independently. One Beam coder owns the coupled feature.
- Shared mutable state. The build checkout, practice checkout, runner state and control state are separate. Product source has one writer.
- Smallest safe decomposition. One coder owns the control-to-runner contract because it crosses Init, Start, persistence and display.

## Architect phases

- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap if the architecture is wrong. The detached-child premise was rejected after reading systemd.kill(5).

## Arena phases

- [x] Frame
- [x] Fan out
- [x] Cross-judge
- [x] Pick
- [x] Graft
- [x] Verify
