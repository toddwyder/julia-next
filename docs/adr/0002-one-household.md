# 0002. Julia serves exactly one household

Date: 2026-09-15

Julia is for one household (Todd and his wife) and there is never more than one. Every piece
of data belongs to the household, not to a person: recipes, menus, shopping list, pantry,
notes, nutrition targets. Screen preferences (text size, keep-screen-on) belong to the device.
Nothing is visible without household sign-in; sharing is the only door through that wall.

We chose this over a multi-user app (each person their own collection) because co-cook sync
and a shared shopping list only make sense on shared data, and because multi-tenancy is what
made "data ownership" fuzzy in the old app (see ADR 0001). We chose it over a per-person
layer inside the household so that "belongs to the household" holds without exceptions.

## Consequences

- No "create a household", invite, join, or household-picker flow. Do not add tenant logic.
- Nothing needs to know *which* member is signed in. Separate logins are allowed only if
  they are easier to build than a shared one.
- If someone outside the household wants a Julia, they run their own copy.

Decided in [Who uses Julia: one person, a household, or many separate people?](https://linear.app/julia-next/issue/JUL-6).
