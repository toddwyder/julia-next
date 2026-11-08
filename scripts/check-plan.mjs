#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const RULE =
  "Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";
const SUB_BLOCKS = [
  "Depends on.",
  "Files.",
  "Build.",
  "You see.",
  "Verify, unit.",
  "Verify, live.",
  "Verify, perf.",
  "Review gate.",
  "Merge.",
];
const PROGRAM_H3 = ["Arm the program", "Spawn owners", "PR mechanics", "Verdict and merge", "Boot recipe"];
const HOW_TO_READ_MARKERS = [
  "One box is one unit of work",
  "names the evidence",
  "Check a box only when its evidence exists",
  "playbooks/",
  RULE,
  "docs/pstack-deviations.md",
  "node scripts/check-plan.mjs",
];
const PERF_ITEMS = ["Metric.", "Probe.", "Baseline.", "Rule."];
const BOX = /^\s*- \[[ x]\] (.*)$/;
const SCENARIO = /^Scenario (\d+)\. /;

const openingFence = (text) => {
  const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) return null;
  return { char: match[1][0], length: match[1].length };
};
const closingFence = (text, opening) => {
  const match = text.match(/^ {0,3}(`+|~+)[ \t]*$/);
  return Boolean(match && match[1][0] === opening.char && match[1].length >= opening.length);
};

const prose = (text) =>
  text
    .replace(/(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)/g, "`")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\]\([^)]*\)/g, "]");

export function checkPlan(text) {
  const problems = [];
  const raw = text.split(/\r?\n/);
  const lines = [];
  let fence = null;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const n = i + 1;
    let code = Boolean(fence);
    if (fence && closingFence(line, fence)) {
      code = false;
      fence = null;
    } else if (!fence) {
      fence = openingFence(line);
      code = Boolean(fence);
    }
    lines.push({ n, text: line, code });
    if (code) continue;
    const plain = prose(line);
    if (/[\u2013\u2014]/.test(plain)) problems.push(`${n}: long dash`);
    if (/[\u2018\u2019\u201c\u201d]/.test(plain)) problems.push(`${n}: curly quote`);
    if (/: \S/.test(plain)) problems.push(`${n}: mid-sentence colon`);
  }

  const h2 = (line) => (!line.code && line.text.startsWith("## ") ? line.text.slice(3).trim() : null);
  const sections = [];
  for (const line of lines) {
    const title = h2(line);
    if (title !== null) sections.push({ title, n: line.n, body: [] });
    else if (sections.length) sections.at(-1).body.push(line);
  }
  const find = (title) => sections.find((section) => section.title === title);
  const bodyText = (section) => section.body.map((line) => line.text).join("\n");

  if (!lines.some((line) => !line.code && line.text.startsWith("# "))) problems.push("1: no H1 title");
  const howToRead = find("How to read this");
  if (!howToRead) problems.push('missing "## How to read this"');
  if (howToRead) {
    const text = bodyText(howToRead);
    for (const marker of HOW_TO_READ_MARKERS) {
      if (!text.includes(marker)) problems.push(`How to read this lacks "${marker}"`);
    }
  }

  const program = find("Program checklist");
  if (!program) problems.push('missing "## Program checklist"');
  if (program) {
    const h3s = program.body.filter((line) => !line.code && line.text.startsWith("### ")).map((line) => line.text.slice(4).trim());
    let cursor = 0;
    for (const name of PROGRAM_H3) {
      const at = h3s.findIndex((title, index) => index >= cursor && title.startsWith(name));
      if (at === -1) problems.push(`Program checklist lacks "### ${name}" in order`);
      else cursor = at + 1;
    }
    const h3Blocks = {};
    let current = null;
    for (const line of program.body) {
      if (!line.code && line.text.startsWith("### ")) {
        current = line.text.slice(4).trim();
        h3Blocks[current] = [];
      } else if (current) h3Blocks[current].push(line);
    }
    const textOf = (name) => {
      const key = Object.keys(h3Blocks).find((title) => title.startsWith(name));
      return key ? h3Blocks[key].map((line) => line.text).join("\n") : "";
    };
    const mechanics = textOf("PR mechanics");
    if (!mechanics.includes("npm run guard:flow")) problems.push("PR mechanics lacks the guard check");
    if (!mechanics.includes("node scripts/machine-programs.mjs --check")) problems.push("PR mechanics lacks the programs check");
    const verdict = textOf("Verdict and merge");
    if (!verdict.includes("One audit lane on `gpt-6-luna`")) problems.push("Verdict and merge lacks one audit lane on gpt-6-luna");
    if (!verdict.includes("second only for a named risk")) problems.push("Verdict and merge lacks the named-risk second audit lane");
  }

  const close = find("Close the program");
  if (!close) problems.push('missing "## Close the program"');
  const programIndex = sections.indexOf(program);
  const closeIndex = sections.indexOf(close);
  const prSections = programIndex === -1 || closeIndex === -1 ? [] : sections.slice(programIndex + 1, closeIndex);
  if (prSections.length === 0) problems.push("no PR sections between Program checklist and Close the program");
  if (closeIndex !== -1) {
    const tail = sections.slice(closeIndex + 1);
    for (const section of tail) {
      if (!section.title.startsWith("Appendix")) problems.push(`"## ${section.title}" after Close the program is not an appendix`);
    }
    if (!tail.some((section) => section.title.includes("Prototype evidence"))) problems.push('no "## Appendix ... Prototype evidence" section');
  }

  const report = [];
  for (const pr of prSections) {
    const heads = [];
    for (const line of pr.body) {
      if (line.code) continue;
      const match = line.text.match(/^\*\*([^*]+)\*\*(.*)$/);
      if (match && SUB_BLOCKS.includes(match[1])) heads.push({ name: match[1], n: line.n, rest: match[2].trim(), lines: [] });
      else if (heads.length) heads.at(-1).lines.push(line);
    }
    const names = heads.map((head) => head.name);
    if (names.join("|") !== SUB_BLOCKS.join("|")) {
      problems.push(`${pr.title}: sub-blocks are [${names.join(", ")}], expected [${SUB_BLOCKS.join(", ")}]`);
    }
    const block = (name) => heads.find((head) => head.name === name);
    const boxes = (block) => (block ? block.lines.filter((line) => !line.code && BOX.test(line.text)).map((line) => ({ n: line.n, text: line.text.match(BOX)[1] })) : []);

    const depends = block("Depends on.");
    if (depends && depends.rest === "") problems.push(`${pr.title}: Depends on names nothing`);
    for (const name of ["Files.", "Build.", "You see.", "Verify, unit.", "Merge."]) {
      const target = block(name);
      if (target && boxes(target).length === 0) problems.push(`${pr.title}: ${name} has no box`);
    }
    for (const name of ["Verify, unit.", "Verify, perf."]) {
      const target = block(name);
      if (target && !target.rest.startsWith(RULE)) problems.push(`${pr.title}: ${name} does not open with the rule`);
    }

    const live = block("Verify, live.");
    if (live) {
      const liveText = [live.rest, ...live.lines.map((line) => line.text)].join("\n");
      for (const marker of ["One independent live checker", "fresh session", "never the author"]) {
        if (!liveText.includes(marker)) problems.push(`${pr.title}: Verify, live lacks "${marker}"`);
      }
      const lanes = boxes(live).map((box) => ({ ...box, match: box.text.match(SCENARIO) })).filter((box) => box.match);
      const other = boxes(live).filter((box) => !SCENARIO.test(box.text));
      if (other.length) problems.push(`${pr.title}: live box is not a scenario`);
      if (lanes.length < 2) problems.push(`${pr.title}: Verify, live has ${lanes.length} scenarios, at least 2 expected`);
      if (!lanes.some((lane) => lane.text.includes("Regression against trunk"))) problems.push(`${pr.title}: Verify, live lacks a regression scenario against trunk`);
      for (const lane of lanes) {
        if (!lane.text.includes("Save `")) problems.push(`${pr.title}: scenario ${lane.match[1]} names no screenshot`);
        if (!lane.text.includes("Pass when")) problems.push(`${pr.title}: scenario ${lane.match[1]} has no pass condition`);
      }
      if (liveText.includes("Ten lanes")) problems.push(`${pr.title}: Verify, live still uses the ten-lane shape`);
    }

    const perf = block("Verify, perf.");
    if (perf) {
      const items = boxes(perf).map((box) => box.text.split(" ")[0]);
      if (items.join("|") !== PERF_ITEMS.join("|")) problems.push(`${pr.title}: perf boxes are [${items.join(", ")}], expected [${PERF_ITEMS.join(", ")}]`);
    }

    const gate = block("Review gate.");
    if (gate) {
      const gateBoxes = boxes(gate);
      if (gate.rest.startsWith("None.")) {
        if (gateBoxes.length) problems.push(`${pr.title}: Review gate says None but has boxes`);
      } else {
        const gateText = gate.lines.map((line) => line.text).join("\n");
        if (gateBoxes.length === 0) problems.push(`${pr.title}: Review gate has no box`);
        for (const word of ["screenshot", "video", "operator"]) {
          if (!gateText.includes(word)) problems.push(`${pr.title}: Review gate lacks "${word}"`);
        }
      }
    }

    report.push(`${pr.title}  scenarios=${block("Verify, live.") ? boxes(block("Verify, live.")).length : 0}`);
  }

  return { report, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node check-plan.mjs <plan.md>");
    process.exit(2);
  }
  const { report, problems } = checkPlan(fs.readFileSync(file, "utf8"));
  for (const line of report) console.log(line);
  console.log(`${report.length} PR sections, ${problems.length} problems`);
  for (const problem of problems) console.error(`${file}: ${problem}`);
  process.exit(problems.length ? 1 : 0);
}
