# Julia home content

The home page shows Julia's name, the application version and the welcome line.

## Sub-features

- `home-name`: `Julia` appears in the main content.
- `home-version`: the version from this checkout's `package.json` follows the name, as `Julia <version>`.
- `home-welcome`: the welcome line `what are we cooking today?` appears below it.

## How to get to it (user POV)

- Open Julia's address (`$RUN_URL`). The masthead at the top has the Julia logo (a link named `Julia` back to this page) and a nav with `Library` (`/recipes`). The main content below the masthead is the whole home page.
- An installed Julia opens the same page. This recipe checks the page, not the phone install.

## Driving it with Playwright CLI

Preconditions: the steps in [README.md](README.md#before-any-feature) are done and the browser is open at `$RUN_URL`.

- **Open the page.** Run `pw goto "$RUN_URL"`. The page loads and `pw snapshot --filename "$EVIDENCE/home-snapshot.yml"` shows a `main` landmark with two lines of text.
- **Read the home text.** Run `pw --raw eval "document.querySelector('main').innerText" > "$EVIDENCE/home-main.txt"`. Then compare it with this checkout: `node -e 'const v=require("./package.json").version, t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (t !== "Julia "+v+"\n\nwhat are we cooking today?") { console.error("mismatch:", JSON.stringify(t)); process.exit(1) }' "$EVIDENCE/home-main.txt"`. Exit 0 proves the name, version and welcome line are correct for this build.
- **Screenshot.** Run `pw screenshot --filename "$EVIDENCE/home.png"`. The image shows the same two lines.
- **Console.** Run `pw console error > "$EVIDENCE/console-errors.txt"`. The file must list no errors.
- **Saved spec.** Run `node .agents/skills/verify-julia/verify-julia.mjs test .agents/skills/verify-julia/tests/home.spec.mjs`. It must end with `exitCode=0`.
- **Side effects.** None: the page reads no household data. Record `not applicable`.

## Gotchas

- The welcome line must match exactly, including the lowercase `w` and the `?`. Any change to it is a change users will see.
- Do not hard-code the version. Read it from `package.json`.
- `--raw eval` prints the value as JSON, so the saved text is a quoted string. The compare step parses it.
- A remote run (`launch --url`) shows the version that was deployed, not this checkout's version. If they differ, check `servedCommit` in `doctor.json` before you call it a failure.
