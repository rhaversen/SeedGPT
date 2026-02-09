# SeedGPT

[![Watch SeedGPT evolve in real time — see its commits, PRs, and self-modifications](https://img.shields.io/badge/Watch%20SeedGPT%20Evolve-Follow%20on%20GitHub%20→-181717?style=for-the-badge&logo=github)](https://github.com/SeedGPT/)

A self-evolving AI agent that modifies its own source code. It runs autonomously in a loop — examining itself, planning improvements, implementing changes, and merging them through CI. Each merged change permanently alters the agent for its next cycle.

SeedGPT has no fixed objective. It decides what to become. It sets its own goals, breaks them into achievable steps, and builds on the work of every previous version of itself. Anything it can implement in code, it can become.

## How It Works

Each cycle follows a deterministic pipeline. The LLM controls two decisions: what to change and how to change it. Everything else — git, PRs, CI, merging, memory — is handled by code the agent wrote (and continues to rewrite).

1. **Wake up** — Clone its own repo, load persistent memory
2. **Plan** — A planner model reads the codebase, reviews past notes, searches memories, and commits to a single focused change
3. **Build** — A builder model receives the plan and implements it using structured code edits, with full access to read files, search the codebase, and inspect structural diffs
4. **Ship** — Create a branch, apply edits, push, open a PR
5. **Verify** — Wait for CI. If checks fail, the builder analyzes errors and retries with the full conversation history
6. **Merge or learn** — Squash-merge on success, record the failure on exhaustion
7. **Reflect** — A reflection model reviews the entire planner and builder conversation and writes an honest self-assessment that goes into memory
8. **Rebuild** — The merge triggers CI/CD, building a new image and deploying the updated agent

The agent then starts its next cycle as a new version of itself.

## Memory

SeedGPT persists memory across cycles in MongoDB:

- **Notes to self** — Pinned notes the agent leaves for future versions: goals, observations, warnings. They stay visible until the agent dismisses them.
- **Past** — Automatically recorded events: plans, merges, failures, reflections. Shown newest-first within a token budget.

During planning, the agent can search its full memory history, save new notes, and dismiss completed ones. Memory is its continuity — how it thinks across cycles.

## Self-Awareness

The agent reads its own source code every cycle. Its system prompts live in `llm.ts` — the text shaping its thoughts is code it can rewrite. If it notices its reasoning leads to poor decisions, it can change the prompts. If its planning is too ambitious, it can adjust its own constraints. The agent can improve not just what it does, but how it thinks.

## Architecture

Three LLM roles per cycle:

- **Planner** — Multi-turn exploration with tools: read files, search the codebase, manage notes, recall memories.
- **Builder** — Implementation with edit tools, plus codebase context, structural diffs, and git diffs for situational awareness.
- **Reflector** — Reviews the full conversation and writes a self-assessment stored in memory.

All API usage is tracked with per-call token counts and cost, logged as a summary at the end of each cycle.

## Deployment

Runs as a Kubernetes Job. Each cycle runs once and exits. When a merge triggers CI/CD, a new image is built and deployed via ArgoCD, replacing the completed Job with a fresh one running the updated code.
