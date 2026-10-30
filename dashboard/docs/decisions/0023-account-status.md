# 0023 Account status is read fresh when Start opens

30 Oct 2026, JUL-290. The Start screen shows Claude and ChatGPT 5-hour and weekly use, CommandCode monthly use, and a separate bought-credit balance. Each number sits beside its quota or says what is left. A missing number has a named unreadable state, never a zero. Nearly exhausted accounts warn in the account section and under their name in the model picker. These rows are information, not a gate, and remain visible without a model sweep.

A plain-Node runner reads credentials and calls the providers outside the Next bundle. Mastra Code's SDK AuthStorage owns Anthropic token rotation and persistence. The dashboard has no refresh implementation and never writes, repairs, or deletes the auth file. ChatGPT uses the stored sign-in without refresh. CommandCode uses the server's API key. Errors carry fixed problem codes, not provider text or credentials.

There is no cache and no estimate. Every Start open reads each provider with no-store requests and an eight-second request timeout. A failed account does not hide another account. A failed CommandCode monthly read does not hide a readable bought-credit balance.

CommandCode's 5-hour and weekly windows stay off this screen. Their caps look like dollar amounts, but the payload does not name the unit. Showing a comparison we cannot label would be a guess.

Open question: CommandCode's credits.monthlyCredits behaves as a remaining balance, not a cap. It fell from 46.198 to 46.174 to 46.126 while usage was billed during the grounding read. The monthly comparison therefore uses totalMonthlyCredits plus monthlyCredits as the allowance. Provider confirmation of that meaning is still needed.
