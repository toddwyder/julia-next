# From "Hey Google, add canola oil" to Julia's shopping list, by itself

Research for [JUL-37](https://linear.app/julia-next/issue/JUL-37), feeding the decision in
[JUL-38](https://linear.app/julia-next/issue/JUL-38). Facts were checked against primary
sources (Google, Apple, and vendor pages; the projects' own repositories) on 2026-09-16. Where a
source does not say, this document says "not stated". Terms in **bold** are in the glossary at
the end.

## Short answer

**Can the requirement be met?** Yes, but only through one door, and Google does not officially
hold that door open.

Today, whatever you say to "Hey Google" about a list goes into **Google Keep**, on a Nest speaker
and on a phone alike. Google offers no way for a personal account to read Keep automatically: the
official Keep **API** is for company (**Workspace**) accounts managed by an administrator. So the
only way to keep saying exactly "Hey Google, add canola oil to the shopping list" and have it land
in Julia is for Julia to read Keep through an **unofficial** door (`gkeepapi`), which works today,
is free, and could stop working whenever Google changes its sign-in.

**Recommended route (1): Keep, read through a throwaway account.** Todd creates a second, empty
Google account just for Julia, shares his Keep shopping list with it once, and Julia checks that
account every few minutes through `gkeepapi`, moves new items onto Julia's list, and ticks them off
in Keep. Todd's real account is never touched by the unofficial tool, so the worst case is "it
stops working", never "Todd's Google account is at risk". Cost: $0/month. One-time setup: about
ten minutes, once.

**Fallback (2): a different sentence, fully official.** "Hey Google, remind me to buy canola oil"
goes to **Google Tasks**, not Keep, and Google Tasks has a public API that works with a personal
account for free. If route 1 breaks, Julia can read Tasks instead the same day. The price is that
Todd changes what he says. Whether a Nest speaker accepts a reminder with no time attached is not
stated by Google and needs a two-minute test.

**Everything else was ruled out** for a personal account: no custom "add to my list" destination
exists for Gemini on phones or speakers (and the Android mechanism that is coming is for native
Android apps only, in private preview); no third-party bridge can catch the phrase (IFTTT can only
trigger a fixed scene, Zapier has no Keep app, Make's Keep app uses the same company-only API);
and nothing sends an email hands-free. "Hey Siri" on an iPhone can send dictated text to Julia,
but it is a different wake word and Apple does not document the hands-free question-and-answer
step.

## Ranked table

| # | Route | Works for a personal account | Hands-free, screen locked | One-time setup Todd must do | Monthly cost | What could break it | Last verified |
|---|---|---|---|---|---|---|---|
| 1 | Keep, read by Julia through `gkeepapi` via a throwaway Google account | Yes (unofficial) | Yes (speaker or Android phone) | Create a second Google account; share the Keep "Shopping list" with it; sign in to that account once on a page an agent prepares, to mint its token | $0 | Google changing sign-in (happened 2022); Google Keep list bugs on Nest (Sept 2026); the throwaway account being blocked | 2026-09-16 |
| 2 | Say "remind me to buy X" instead; lands in Google Tasks; Julia reads the official Tasks API | Yes (official) | Yes (speaker or Android phone) | Approve Julia's access to Google Tasks once (a normal Google consent screen) | $0 | Todd forgetting the new sentence; speaker refusing a reminder with no time (not stated) | 2026-09-16 |
| 3 | Keep, read by Julia through the official Keep API via a paid Workspace seat that the list is shared with | Unknown (the API is documented for "enterprise" use; whether shared notes come back is not stated) | Yes | Buy one Workspace seat; share the list with it; admin setup done by an agent | $7 | Google restricting the API to bigger Workspace editions; shared notes not returned | 2026-09-16 |
| 4 | Third-party bridges (IFTTT, Zapier, Make, Home Assistant) catching the phrase | No (none can catch the spoken item) | n/a | n/a | $0 to $8.99 | n/a | 2026-09-16 |
| 5 | "Hey Siri" shortcut on iPhone posting dictated text to Julia | Yes (Apple, not Google) | Probably (Apple: Siri only asks to unlock if the shortcut opens an app; the spoken-question step is not stated) | Install one shortcut; allow Siri when locked | $0 | iOS changes; wrong wake word for the household habit | 2026-09-16 |
| 6 | Pointing "Hey Google" at Julia directly (custom Gemini destination) | No | n/a | n/a | n/a | n/a | 2026-09-16 |
| 7 | Email as a bridge | No (nothing sends hands-free) | n/a | n/a | n/a | n/a | 2026-09-16 |

Routes 4, 6 and 7 are "no" today; they are kept in the table so JUL-38 can see they were checked.

## Route 1: Reading Google Keep automatically

### Where the spoken item lands today

- Google's help page states: "Your Shopping List and Assistant Notes and Lists are now saved in
  Google Keep", and that Assistant needs permission to use Keep as the notes-and-lists provider.
  [S1]
- On Nest speakers and displays, the new assistant is **Gemini for Home**. Its supported-services
  page lists Google Keep for "Create notes & lists" and Google Tasks for "Create reminders". No
  third-party notes or list app is listed. [S2] The speaker notes help page offers only Google
  Keep as the provider radio button. [S3]
- Gemini for Home "requires a personal account and not a Workspace account"; basic features are
  free, Gemini Live and Home Brief need a Google Home Premium subscription. [S4]
- Google's own release notes show the Keep list feature is not rock-solid on speakers: on
  2026-09-02 Google "addressed issues impacting some users' ability to create and edit alarms and
  lists" and confirmed "Google Keep continues to be a supported app". [S5]
- On phones, the Gemini app stores lists in Google Keep through its "Google Workspace" connected
  app, which is available with a "Personal, work, or school Google Account" and covers Gmail,
  Calendar, Drive, Docs, Sheets, Slides, Keep, Tasks, Chat and Meet. [S6][S7] Example prompt in
  Google's help: "Add [item 1, item 2, …] to my list called [list name]". [S7]

### The official Google Keep API

- Google's Keep API landing page: the API is "used in an enterprise environment to manage Google
  Keep content and to resolve issues identified by cloud security software" (last updated
  2025-09-26). [S8]
- The API guide (last updated 2026-09-03) describes it as for "enterprise administrators to manage
  Google Keep notes", authorized by **domain-wide delegation** with a service account or an OAuth
  client that an administrator approves. Personal accounts are not mentioned at all. [S9]
- Whether `notes.list` returns notes shared with the user (not only owned notes): not stated.
  [S10] This is what route 3 would depend on.
- Cheapest Workspace seat, if route 3 were tried: Business Starter, $7 per user per month on an
  annual commitment. [S11] Whether Business Starter can enable the Keep API: not stated on the
  pages checked.

### Google-sanctioned export

- Google Takeout can "automatically create an archive of your selected data every 2 months for
  one year". [S12] Too slow to be a list feed; listed only for completeness.

### The unofficial route: `gkeepapi`

- The README states "gkeepapi is not supported nor endorsed by Google" and that "you should
  always make backups". [S13]
- Latest version 0.17.1, released 2026-01-05 on PyPI; the last commit on GitHub is also dated
  2026-01-05; the project publishes no GitHub releases and no tags. [S14][S15]
- Authentication: a **master token** for the account, obtained through the `gpsoauth` library's
  "alternative flow": sign in at Google's `EmbeddedSetup` page in a browser once, copy a cookie,
  exchange it for the master token. Password login "is discouraged (and unlikely to work), due to
  increased security requirements on logins". The docs warn: "These tokens are so called because
  they have full access to your account. Protect them like you would a password." [S16][S17]
- Breakage history: issue #123 (opened 2022-05-13) reports a "NeedsBrowser" error after months of
  working, with app passwords and CAPTCHA unlock not helping. [S18] Other login issues (#81,
  #102, #144) exist in the tracker. [S19]
- Account locks: a search of the repository's issues for "locked", "suspended", "unusual
  activity" found reports of login failures, none of an account being locked or suspended. [S19]
  This is an absence of reports, not a statement from Google.
- Practice in the wild: the Home Assistant community "Google Keep Sync" integration (latest release
  1.1.0, 2025-04-20; last commit 2026-04-20) uses the same library, says "password login usually
  doesn't work", warns that the token grants "read and write access to all of that account's notes
  and lists", and says using "a dedicated Google account is strongly recommended". It polls Keep
  every 15 minutes by default. [S20][S21]
- Keep notes can be shared with any Google account by email address; collaborators can "edit text,
  lists, images, drawings, and audio recordings". No account-type restriction is stated. [S22]
  This is what lets route 1 keep Todd's real account out of the unofficial tool.

### Google Tasks: does the shopping list ever land there?

- Google Tasks has a public API ("Search, read, and update Google Tasks content and metadata",
  last updated 2026-05-27). The quickstart needs "A Google Cloud project" and "A Google account
  with Google Tasks enabled"; no Workspace requirement is stated. [S23][S24]
- Gemini for Home uses Google Tasks for reminders only ("Set a task", "Remind me to call Mom at
  noon tomorrow"). Adding to a named Tasks list by voice: not stated. Lists go to Keep. Setup
  needs Voice Match and Personal results on. [S2][S25]
- On phones, Gemini adds to Google Tasks when told "Add this to my tasks" or "@Google Tasks".
  [S26] Whether Gemini sends "add X to the shopping list" to Keep or Tasks when both are
  connected: not stated.
- Conclusion: "add X to the shopping list" does not land in Tasks; "remind me to buy X" does. That
  is route 2.

## Route 2: Pointing "Hey Google" at Julia directly

- Conversational Actions (the old way for anyone to build a voice app for Assistant) were
  deprecated on 2023-06-13; "Users and developers can no longer access Conversational Actions".
  Google pointed developers to App Actions (Android apps), smart home, web content, and media.
  None of those lets a website receive a spoken list item. [S27][S28]
- Third-party notes-and-lists providers were removed on 2023-06-20 (AnyList: "Google stopped
  supporting third-party integration with Assistant's Notes & Lists"). [S29]
- Classic Google Assistant on phones is being replaced by Gemini: Google wrote on 2025-03-14 that
  "later this year, the classic Google Assistant will no longer be accessible on most mobile
  devices or available for new downloads on mobile app stores". [S30] Google's own community
  update on the 2026 mobile rollout could not be read in full (page truncated); the September 2026
  dates reported in the press were therefore not verified against a Google page.
- On Android, Gemini hands-free: "With 'Hey Google' and Voice Match turned on, you can also get
  some hands-free help with quick voice actions (like sending messages) when your device is
  locked", and you "may need to unlock your device to get Gemini's response". [S31] On iPhone,
  Google's page says "On Android, say 'Hey Google'"; no hands-free wake word is described for
  iPhone. [S32]
- The coming Android mechanism, **AppFunctions**, is "an Android platform API with an accompanying
  Jetpack library", Android 16 or higher, "experimental preview", and "As of May 2026, AppFunctions
  integration with Gemini is in private preview with trusted testers". It requires a native Android
  app. Julia is a website (PWA), so this does not apply. [S33]
- Google Home routines: a routine can start "when you say a custom voice command" and can run "a
  command for your voice assistant", broadcast, and send texts. Nothing about a spoken variable
  (the item name) or a web address. [S34]
- Conclusion: no custom destination exists for a personal user, and nothing on the roadmap serves
  a website.

## Route 3: "Hey Siri" on iPhone

- Siri runs any shortcut by name; "After running the shortcut, Siri tells you the result." When
  locked: "When your device is locked and you run a shortcut that opens an app, Siri asks to unlock
  your device before continuing." A shortcut that only posts to a web address opens no app. [S35]
- "Allow Siri When Locked" is a setting under Settings > Siri. [S36]
- The "Get Contents of URL" action can POST a request body ("JSON, a Form, or a File") to a web
  address, which is all Julia needs to receive an item. [S37]
- "Ask for Input" "presents a dialog that asks a question". Whether Siri speaks the question and
  accepts a spoken answer when the shortcut runs by voice: not stated on Apple's pages checked.
  [S38]
- Conclusion: technically the closest thing to a fully supported path, but it needs an iPhone, the
  wake word "Hey Siri", and a hands-free test of the question step. AnyList, which lost its Google
  integration, points its users at Siri and Alexa. [S29]

## Route 4: Third-party bridges

- IFTTT, Google Assistant V2 service: one trigger, "Activate scene" ("Ok Google, activate [Scene
  Name]"); no spoken text is passed through. [S39] Plans: Free $0 (2 applets), Pro $2.99/month,
  Pro+ $8.99/month. [S40]
- Zapier: no Google Keep app (the integration page returns 404). Google Tasks app has triggers "New
  Task", "New Completed Task", "New Task List"; polling vs instant not stated. Free plan: 100
  tasks/month, two-step Zaps only; paid from $19.99/month. [S41][S42][S43] Zapier could carry
  route 2 (Tasks to Julia) for $0 if a webhook step is allowed on the free plan (not verified).
- Make: has a Google Keep app with "Lists notes" and a "watch notes" trigger, needing "an active
  Google account with access to Google Keep and appropriate API credentials" from a Google Cloud
  project. It is a wrapper around Google's Keep API, so it inherits the enterprise-only limit in
  route 1; personal-account support is not stated. Free plan 1,000 credits/month with a 15-minute
  minimum interval; Core $12/month. [S44][S45]
- Home Assistant: the Google Assistant integration exposes 28 device types to Google; to-do and
  shopping lists are not among them. [S46] The Google Assistant SDK integration sends commands to
  Google, it does not receive them. [S47] The Google Tasks integration is two-way but polls every
  30 minutes. [S48] The community Google Keep Sync integration is route 1 again (gkeepapi, 15-minute
  polling). [S20] Home Assistant Cloud, needed only for the voice-control side, is $6.50/month.
  [S49] All of this needs a home server the household does not run.
- Conclusion: no bridge catches the spoken item. Bridges can only move data once it is already in
  Keep or Tasks, which Julia can do itself.

## Route 5: Email as a bridge

- Nest speakers and displays: the "what you can do" page lists broadcasts, reminders, notes and
  lists; email is not listed. [S50]
- Gemini on phones: Gmail is in the Google Workspace connected app for personal accounts, described
  as "Find, manage, and summarize your content". Sending an email by voice is not listed. [S6]
  Gemini in Gmail drafts replies that you edit "before you send". [S51]
- The reading side would be fine (the Gmail API "can be used to access Gmail mailboxes and send
  mail"), but nothing on the speaking side sends. [S52]
- Conclusion: no.

## Open questions for Todd (for JUL-38)

1. Is the wake word negotiable? "Hey Siri" (route 5) needs an iPhone and a different wake word;
   "remind me to buy X" (route 2) keeps "Hey Google" but changes the sentence. If neither is
   acceptable, route 1 is the only route.
2. Which device does the sentence usually go to: a Nest speaker in the kitchen, or a phone? (Route 1
   works for both; route 2's "reminder with no time" needs testing on the speaker.)
3. Are you comfortable with a route Google could switch off without warning, if the fallback (route
   2) is built alongside it so the loss is a changed sentence, not a lost feature?
4. Is a second, empty Google account for Julia acceptable? It is what keeps your own account out of
   the unofficial tool.
5. Is $7/month worth it to try route 3 (official Keep API through a Workspace seat)? It has two
   unknowns that a one-month trial would settle.
6. How quickly must the item show up: within a minute, or "by the time I look at the list"? This
   sets how often Julia checks Keep.
7. Where does the checking run? Vercel's free plan or the OVH runner. ADR 0005 says the OVH server
   "never hosts the app"; a small checker is not the app, but the choice should be explicit.
8. Should the item be removed from Keep once Julia has it, so Keep never becomes a second list?

## Glossary

- **API**: a doorway a program uses to read or write another service's data, instead of a person
  tapping a screen.
- **Official / unofficial API**: official means the service's owner publishes and supports the
  doorway; unofficial means someone worked out how the owner's own app talks to the service and
  copied it. Unofficial doorways can close without notice.
- **Google Keep**: Google's notes app. Where "Hey Google" puts lists today.
- **Google Tasks**: Google's to-do app. Where "Hey Google" puts reminders. Has an official API for
  personal accounts.
- **Workspace**: Google's paid business accounts, managed by an administrator. Todd has a personal
  account, which is not Workspace.
- **Domain-wide delegation**: a Workspace administrator letting a program act as any user in the
  company. The Keep API's way in.
- **Gemini / Gemini for Home**: Google's new assistant replacing Google Assistant on phones and on
  Nest speakers and displays.
- **Voice Match**: Google's recognition of your voice so a speaker or locked phone knows it is you.
- **Master token**: a long secret that stands in for a Google account's password in the unofficial
  route. Full access to the account, so it must never be Todd's real account.
- **Throwaway account**: a second Google account created only for Julia to read Keep with.
- **Collaborator**: someone a Keep note is shared with; they can edit the list.
- **Poll / polling**: checking a service on a timer ("every 5 minutes") rather than being told the
  moment something changes.
- **Webhook**: a web address a service calls the moment something happens; the opposite of polling.
- **Shortcut (Apple)**: a small recipe of steps on an iPhone that Siri can run by name.
- **PWA**: a website that installs like an app. Julia is one; it is not a native Android or iPhone
  app, which is why the app-only mechanisms do not apply.
- **AppFunctions**: Android's coming way for native apps to offer actions to Gemini. Native apps
  only, private preview.
- **Bridge**: a middleman service (IFTTT, Zapier, Make, Home Assistant) that moves data between
  two other services.
- **Sync service**: the offline-first data service Julia's devices copy from (ADR 0005; PowerSync is
  the candidate). The Keep or Tasks checker would write into it.

## Sources

All accessed 2026-09-16.

- [S1] Google Assistant Help, "Shopping Lists & Notes are moving to Google Keep":
  https://support.google.com/assistant/answer/14171370?hl=en
- [S2] Google Nest Help, "Gemini for Home voice assistant supported services":
  https://support.google.com/googlenest/answer/16709732?hl=en-GB
- [S3] Google Home Help, "Create or edit notes on your speaker or smart display":
  https://support.google.com/googlehome/answer/16722557?hl=en
- [S4] Google Home Help, "Learn about Gemini for Home voice assistant":
  https://support.google.com/googlehome/answer/16618650?hl=en
- [S5] Google Home Help, "What's new in Google Home" (entries dated 2026-04-13, 2026-06-08,
  2026-09-02): https://support.google.com/googlehome/answer/15962877?hl=en
- [S6] Gemini Apps Help, Connected Apps table:
  https://support.google.com/gemini/table/17434654?hl=en
- [S7] Gemini Apps Help, "Capture your ideas & notes with Gemini Apps" (Android):
  https://support.google.com/gemini/answer/15230597?hl=en&co=GENIE.Platform%3DAndroid
- [S8] Google Keep API landing page (last updated 2025-09-26):
  https://developers.google.com/workspace/keep
- [S9] Google Keep API guide (last updated 2026-09-03):
  https://developers.google.com/workspace/keep/api/guides
- [S10] Google Keep API reference, `notes.list`:
  https://developers.google.com/workspace/keep/api/reference/rest/v1/notes/list
- [S11] Google Workspace pricing: https://workspace.google.com/pricing
- [S12] Google Account Help, "How to download your Google data" (scheduled exports):
  https://support.google.com/accounts/answer/3024190?hl=en
- [S13] gkeepapi README: https://github.com/kiwiz/gkeepapi
- [S14] gkeepapi on PyPI (0.17.1, 2026-01-05): https://pypi.org/project/gkeepapi/
- [S15] gkeepapi releases page ("There aren't any releases here"); last commit date from the
  GitHub API (2026-01-05): https://github.com/kiwiz/gkeepapi/releases
- [S16] gkeepapi documentation (login, master token, FAQ):
  https://gkeepapi.readthedocs.io/en/latest/
- [S17] gpsoauth README (alternative flow via EmbeddedSetup):
  https://github.com/simon-weber/gpsoauth
- [S18] gkeepapi issue #123, "New login issue (Was working fine for months)", opened 2022-05-13:
  https://github.com/kiwiz/gkeepapi/issues/123
- [S19] gkeepapi issue tracker search (issues #81, #102, #144):
  https://github.com/kiwiz/gkeepapi/issues
- [S20] Home Assistant Google Keep Sync (community integration) README:
  https://github.com/watkins-matt/home-assistant-google-keep-sync
- [S21] Home Assistant Google Keep Sync releases (1.1.0, 2025-04-20); last commit 2026-04-20 from
  the GitHub API: https://github.com/watkins-matt/home-assistant-google-keep-sync/releases
- [S22] Google Keep Help, "Share notes, lists & drawings":
  https://support.google.com/keep/answer/6101196?hl=en&co=GENIE.Platform%3DDesktop
- [S23] Google Tasks API landing page (last updated 2026-05-27):
  https://developers.google.com/workspace/tasks
- [S24] Google Tasks API Python quickstart (last updated 2026-09-03):
  https://developers.google.com/workspace/tasks/quickstart/python
- [S25] Google Home Help, "Set & manage Google Tasks with your voice assistant":
  https://support.google.com/googlehome/answer/16722329?hl=en
- [S26] Gemini Apps Help, "Capture your tasks & reminders with Gemini Apps" (Android):
  https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DAndroid
- [S27] Google, Conversational Actions overview (deprecated 2023-06-13):
  https://developers.google.com/assistant/conversational/overview
- [S28] Google, Conversational Actions sunset: https://developers.google.com/assistant/ca-sunset
- [S29] AnyList Help, "Why doesn't AnyList support Google Assistant?":
  https://help.anylist.com/articles/google-assistant-overview/
- [S30] Google blog, "The Assistant experience on mobile is upgrading to Gemini" (2025-03-14):
  https://blog.google/products/gemini/google-assistant-gemini-mobile/
- [S31] Gemini Apps Help, "What you can do with your Gemini mobile app" (Android):
  https://support.google.com/gemini/answer/14579631?hl=en&co=GENIE.Platform%3DAndroid
- [S32] Same page, iPhone & iPad version:
  https://support.google.com/gemini/answer/14579631?hl=en&co=GENIE.Platform%3DiOS
- [S33] Android Developers, "Overview of AppFunctions" (last updated 2026-09-08):
  https://developer.android.com/ai/appfunctions
- [S34] Google Nest Help, routines/automations:
  https://support.google.com/googlenest/answer/7029585?hl=en
- [S35] Apple Support, "Use Siri to run shortcuts with your voice":
  https://support.apple.com/guide/shortcuts/apd07c25bb38/ios
- [S36] Apple Support, "Change Siri settings on iPhone":
  https://support.apple.com/guide/iphone/change-siri-settings-iphc28624b81/ios
- [S37] Apple Support, "Request your first API in Shortcuts on iPhone or iPad":
  https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios
- [S38] Apple Support, "Use the Ask for Input action in a shortcut":
  https://support.apple.com/guide/shortcuts/apd68b5c9161/ios
- [S39] IFTTT, Google Assistant V2 service: https://ifttt.com/google_assistant_v2
- [S40] IFTTT plans: https://ifttt.com/plans
- [S41] Zapier, Google Keep integrations page (HTTP 404):
  https://zapier.com/apps/google-keep/integrations
- [S42] Zapier, Google Tasks integrations: https://zapier.com/apps/google-tasks/integrations
- [S43] Zapier pricing: https://zapier.com/pricing
- [S44] Make, Google Keep app documentation: https://apps.make.com/google-keep
- [S45] Make pricing: https://www.make.com/en/pricing
- [S46] Home Assistant, Google Assistant integration:
  https://www.home-assistant.io/integrations/google_assistant/
- [S47] Home Assistant, Google Assistant SDK integration:
  https://www.home-assistant.io/integrations/google_assistant_sdk/
- [S48] Home Assistant, Google Tasks integration:
  https://www.home-assistant.io/integrations/google_tasks/
- [S49] Nabu Casa, Home Assistant Cloud pricing: https://www.nabucasa.com/pricing/
- [S50] Google Home Help, "Explore what you can do with Google smart speakers and displays":
  https://support.google.com/googlehome/answer/7130274?hl=en-CA
- [S51] Gmail Help, "Collaborate with Gemini in Gmail":
  https://support.google.com/mail/answer/14355636?hl=en&co=GENIE.Platform%3DDesktop
- [S52] Gmail API guides (last updated 2026-09-10):
  https://developers.google.com/workspace/gmail/api/guides
- Also read, no fact taken: Google blog, "Google launches Gemini for Home" (2025-08-20),
  https://blog.google/products/google-nest/gemini-for-home/ (example: "add the ingredients to
  make an authentic Italian lasagna to my shopping list").
