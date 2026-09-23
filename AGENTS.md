# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Framework-first rules (JUL-116)

1. Read the framework's official docs before writing code, and post a framework map (need → framework feature → docs link) on the card.
2. Start from the framework's own example and change as little as possible.
3. `npm run lint:framework` must pass. Hand-built progress files, retry or wait loops, and controller code over 400 lines are refused unless skipped with an ESLint comment that gives a reason and a docs link, and listed on JUL-115.
4. Before proposing to build anything, name the existing tools checked and why they don't fit.
