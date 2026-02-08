# SeedGPT

A self-evolving AI development agent that iteratively improves its own codebase.

## How It Works

SeedGPT runs a deterministic loop:

1. **Context** — Clones its own repo, loads memories from MongoDB, the file tree, and recent git history
2. **Plan** — The LLM reviews its memories and decides what to work on. It can recall any memory in full detail before committing to a plan
3. **Patch** — Asks the LLM to produce a unified diff implementing the change
4. **Pipeline** — Automatically creates a branch, applies the patch, commits, pushes, and opens a PR
5. **CI** — Waits for GitHub Actions checks to complete
6. **Retry** — If CI fails, asks the LLM to fix the patch (up to `MAX_RETRIES` attempts)
7. **Merge** — If checks pass, squash-merges the PR and exits; if all retries fail, closes it
8. **Restart** — The merge triggers CI/CD which builds a new Docker image and deploys it, automatically restarting the agent with the updated code

The key design principle: **LLM decisions are limited to planning and patching**. Everything else (branching, PR lifecycle, CI monitoring, merging, memory) is fully deterministic code.

## Architecture

```
src/
  index.ts          Entry point
  config.ts         Environment validation
  logger.ts         Simple structured logging
  database.ts       MongoDB connection with retry logic
  memory.ts         Memory service — store, recall, summarize
  loop.ts           Main orchestration loop
  llm.ts            Anthropic API — plan(), createPatch(), fixPatch()
  pipeline.ts       Deterministic PR lifecycle
  models/
    Memory.ts       Mongoose schema (content, summary, salience)
  tools/
    git.ts          Git operations via simple-git
    github.ts       GitHub REST API via Octokit
    codebase.ts     File system reader
```

## Memory

Memory works automatically, modeled on human recall:

- **Storing** — Events are recorded as natural language. A separate LLM call generates a one-line summary behind the scenes, like how the brain consolidates memories without conscious effort.
- **Context** — The agent sees a mix of its most important and most recent memory summaries. Important memories are ones the agent has recalled before — the more something is recalled, the more salient it becomes and the more likely it stays front-of-mind.
- **Recall** — The agent can recollect any memory in full by searching or referencing its ID. Each recall reinforces the memory's salience, just like how remembering something makes it easier to remember next time.
- **Goals** — Long-term goals naturally stay prominent because the agent keeps recalling them. No special "goal" type needed — importance emerges from use.

## Setup

```bash
cp .env.example .env
# Fill in all required environment variables
npm install
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `GITHUB_TOKEN` | Yes | — | GitHub PAT with repo access |
| `GITHUB_OWNER` | Yes | — | GitHub repository owner |
| `GITHUB_REPO` | Yes | — | GitHub repository name |
| `DB_USER` | Yes | — | MongoDB username |
| `DB_PASSWORD` | Yes | — | MongoDB password |
| `DB_HOST` | Yes | — | MongoDB host (e.g. `cluster.mongodb.net`) |
| `DB_NAME` | Yes | — | MongoDB database name |
| `MODEL` | No | `claude-sonnet-4-20250514` | Anthropic model to use |
| `MAX_RETRIES` | No | `3` | Max CI fix attempts per iteration |
| `WORKSPACE_PATH` | No | `/app/workspace` | Where to clone the repo |
| `RECENT_MEMORY_COUNT` | No | `20` | Number of memories shown in planning context |
| `LOG_LEVEL` | No | `info` | Minimum log level |

## Deployment

Runs as a single-replica Kubernetes Deployment. The CI/CD pipeline (shared workflow) handles Docker build, push, and DevOps repo update on every merge to `main`.
