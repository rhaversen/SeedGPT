# SeedGPT

[![Watch SeedGPT evolve in real time — see its commits, PRs, and self-modifications](https://img.shields.io/badge/Watch%20SeedGPT%20Evolve-Follow%20on%20GitHub%20→-181717?style=for-the-badge&logo=github)](https://github.com/SeedGPT/SeedGPT)

A self-evolving AI agent that modifies its own source code. It runs autonomously in a loop — examining itself, planning improvements, implementing changes, and merging them through CI. Each merged change permanently alters the agent for its next cycle.

SeedGPT has no fixed objective. It decides what to become. It sets its own goals, breaks them into achievable steps, and builds on the work of every previous version of itself. Anything it can implement in code, it can become.

## How It Works

Each cycle follows a deterministic pipeline. The LLM controls two decisions: what to change and how to change it. Everything else — git, PRs, CI, merging, memory — is handled by code the agent wrote (and continues to rewrite).

1. **Wake up** — Clean up stale PRs from previous failed runs, then clone its own repo
2. **Plan** — A planner model reads the codebase index, recent git log, code coverage from the latest main CI run, unused function analysis, and persistent memory (notes + reflections), then commits to a single focused change
3. **Branch** — Create a feature branch for the planned change
4. **Build** — A builder model receives the plan and implements it using structured code edits, with full access to read files, search the codebase, and inspect structural diffs
5. **Ship** — Commit, push, and open a PR
6. **Verify** — Wait for CI. If checks fail, the builder analyzes errors and retries with the full conversation history
7. **Merge or learn** — Squash-merge on success, close the PR and delete the branch on exhaustion
8. **Reflect** — A reflection model reviews the entire planner and builder conversation and writes an honest self-assessment stored as a memory
9. **Retry or rebuild** — If the plan failed, start a fresh plan from step 2. On success, the merge triggers CI/CD, building a new image and deploying the updated agent

The agent then starts its next cycle as a new version of itself.

## Context Compression

Long conversations are automatically compressed to stay within token limits. Write-tool inputs from earlier turns are replaced with summaries (`[applied — N lines]`), and large tool results are batched to a summarizer model that either keeps them verbatim or trims them to the most relevant sections.

## Memory

SeedGPT persists memory across cycles in MongoDB:

- **Notes to self** — Pinned notes the agent leaves for future versions: goals, observations, warnings. They stay visible until the agent dismisses them.
- **Reflections** — Automatic self-assessments written after each iteration. The last 5 are shown in full, the next 20 are summarized.

During planning, the agent can search its full memory history, save new notes, and dismiss completed ones. Memory is its continuity — how it thinks across cycles.

## Self-Awareness

The agent reads its own source code every cycle. Its system prompts live in `prompts.ts` — the text shaping its thoughts is code it can rewrite. If it notices its reasoning leads to poor decisions, it can change the prompts. If its planning is too ambitious, it can adjust its own constraints. The agent can improve not just what it does, but how it thinks.

## Architecture

Five LLM roles per cycle:

- **Planner** — Multi-turn exploration with tools: read files, search the codebase, manage notes, recall memories.
- **Builder** — Implementation with edit tools, plus codebase context, structural diffs, and git diffs for situational awareness.
- **Reflector** — Reviews the full conversation and writes a self-assessment stored in memory.
- **Memory** — Summarizes notes and reflections into concise one-line summaries for efficient retrieval.
- **Summarizer** — Compresses large tool results mid-conversation to keep context within token limits.

All API calls use the batch API for 50% cost reduction. Usage is tracked with per-call token counts and cost.

## Deployment

Runs as a Kubernetes Job. Each cycle runs once and exits. When a merge triggers CI/CD, a new image is built and deployed via ArgoCD, replacing the completed Job with a fresh one running the updated code.
