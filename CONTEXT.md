# Julia

Julia is an offline-first culinary management tool for one household: recipe intake, menu
planning, shopping lists, kitchen prep, and full-screen cook mode.

## Language

**Household**:
The group of people who cook together and share one collection of recipes, menus, shopping
list, and pantry. There is exactly one household; every piece of data in Julia belongs to it,
never to an individual.
_Avoid_: Account, family, user group, workspace

**Household account**:
One of the two Google accounts Julia accepts at sign-in. Being signed in with one means being
in the household; Julia never distinguishes between them.
_Avoid_: User, member, login, profile

**Front door**:
The screen a signed-out device shows: the logo and a single "Sign in with Google" button. The
only way into Julia; there is no public part.
_Avoid_: Login page, landing page, splash screen

**Device**:
A phone, tablet, or computer signed into the household. Screen preferences (text size,
keep-screen-on) belong to the device, not to a person.
_Avoid_: Client, session, user

## Delivery

**Journey**:
One thing a person sets out to do in Julia, start to finish, on a named device. The unit the
spec is written in and the unit Todd accepts.
_Avoid_: Feature, story, epic, screen

**Evidence**:
What a builder hands over for a journey: one recording of it on the deployed Julia plus the
journey's checklist with a proof per line.
_Avoid_: Demo, proof of work, test results

**Gate**:
The check that evidence passes before it reaches Todd: code for what code can verify, a
reviewing agent for what needs the recording watched.
_Avoid_: Review, QA, approval
