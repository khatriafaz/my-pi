# my-pi

Opinionated pi setup for Afaz.

This repository contains Afaz's personal [`pi`](https://github.com/khatriafaz/my-pi) extension setup.

## What's included

- **`update_plan` tool** — a Codex-style planning/checklist tool for agents, with one active `in_progress` step at a time.
- **`/exit` command** — cleanly exits pi.

## Files

- `index.ts` is intentionally minimal and only wires feature modules into pi.
- `update-plan.ts` registers the `update_plan` tool and plan status UI.
- `exit-command.ts` registers the `/exit` command.
- `conversation-resources.ts` contains the inactive conversation resources feature and is not loaded by `index.ts`.

## Purpose

This setup makes pi feel more like Afaz's preferred agent workflow: persistent task planning and a clean exit command.
