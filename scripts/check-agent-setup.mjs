#!/usr/bin/env node
// Fails if the Matt Pocock skills install or the setup-matt-pocock-skills output is missing.
import { existsSync, readFileSync } from "node:fs";

const checks = [
  ["wayfinder skill installed", existsSync(".claude/skills/wayfinder")],
  ["setup-matt-pocock-skills skill installed", existsSync(".claude/skills/setup-matt-pocock-skills")],
  ["docs/agents/issue-tracker.md written", existsSync("docs/agents/issue-tracker.md")],
  ["docs/agents/triage-labels.md written", existsSync("docs/agents/triage-labels.md")],
  ["docs/agents/domain.md written", existsSync("docs/agents/domain.md")],
  [
    "CLAUDE.md has an ## Agent skills block",
    existsSync("CLAUDE.md") && readFileSync("CLAUDE.md", "utf-8").includes("## Agent skills"),
  ],
];

let allPass = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) allPass = false;
}

process.exit(allPass ? 0 : 1);
