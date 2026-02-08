# SeedGPT

A self-evolving AI agent that modifies its own source code. It runs autonomously in a loop — examining itself, planning improvements, implementing changes, and merging them through CI. Each merged change permanently alters the agent for its next cycle.

SeedGPT has no fixed objective. It sets its own goals, breaks them into achievable steps, and builds on the work of every previous version of itself. It can give itself new capabilities — internet access, email, APIs, data processing — anything it can implement in code.

## How It Works

Each cycle follows a deterministic pipeline. The LLM only controls two decisions: what to change and how to change it. Everything else — git, PRs, CI, merging, memory — is handled by code the agent wrote (and continues to rewrite).

1. **Wake up** — Clone its own repo, load persistent memory from MongoDB
2. **Plan** — Read files, review past notes, set goals, then commit to a single focused change
3. **Patch** — Generate structured code edits (find-and-replace, create, delete) to implement the plan
4. **Ship** — Create a branch, apply edits, push, open a PR
5. **Verify** — Wait for CI checks to pass. If they fail, analyze errors and retry (up to 3 attempts)
6. **Merge or close** — Squash-merge on success, close and record the failure on exhaustion
7. **Rebuild** — The merge triggers CI/CD, which builds a new image and deploys the updated agent

The agent then starts its next cycle as a new version of itself.

## Memory

SeedGPT persists memory across cycles in MongoDB. It has two kinds:

- **Notes to self** — Pinned notes the agent leaves for future versions of itself: goals, observations, plans, warnings. They stay visible until the agent dismisses them.
- **Past** — Automatically recorded events (plans made, PRs merged, failures encountered). Shown newest-first within a token budget.

During planning, the agent can search its full memory history by keyword or ID, save new notes, and dismiss completed ones. Memory is its continuity — how it thinks across cycles.

## Architecture

The agent uses two LLM contexts per cycle:

- **Planning** (Claude Sonnet 4.5) — Multi-turn conversation with tools: `read_file`, `note_to_self`, `dismiss_note`, `recall_memory`, `submit_plan`. The agent explores its codebase and memory freely before committing to a change.
- **Patching** (Claude Opus 4.6) — Receives the plan and relevant file contents. Returns structured edit operations via `submit_edits`. Retries receive the previous error as a `tool_result`, maintaining full conversation history across attempts.

```
src/
  index.ts             Entry point
  loop.ts              Main cycle orchestration
  llm.ts               LLM interactions, tool definitions, PatchSession
  config.ts            Environment-aware configuration
  database.ts          MongoDB (Atlas in production, in-memory for dev)
  memory.ts            Store, pin, unpin, recall, context assembly
  pipeline.ts          PR check polling, stale PR cleanup
  logger.ts            Structured logging
  models/
    Memory.ts          Mongoose schema with text search index
  tools/
    git.ts             Clone, branch, apply edits, commit, push, reset
    github.ts          PR lifecycle, CI check collection
    codebase.ts        File tree walking, file reading
```

## Deployment

Runs as a Kubernetes Job. Each cycle runs once and exits. When a merge triggers CI/CD, a new image is built and deployed via ArgoCD, which replaces the completed Job with a fresh one running the updated code.
