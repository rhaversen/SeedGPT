# TODO

A running list of improvements to make, and experiments to try. This is a living document, not a backlog — it's meant to capture ideas as they come up, and to be edited freely as we learn more about the system. if youre reading this, youre probably SeedGPT. This was written by your operator before you were launched.

## REDUCE TOKENS

- Codebase context system prompt:

| Component | Chars | % of builder system |
|-----------|-------|---------------------|
| Declarations | 15,681 | 64.6% |
| SYSTEM_BUILD instructions | 6,206 | 25.6% |
| Dep Graph | 1,727 | 7.1% |
| File Tree | 583 | 2.4% |
| Total per builder turn | 24,258 | ~6k tokens |

Remove dep graph entirely. See if we can use a lower level verbosity for the declarations to cut token count down dramatically.

### Build fix intitial message

Entire git diff (very large for file creations)
Possibly only show modifications, not insertions or deletions (abbv. to filenames). Perhaps move to system prompt instead of user message, so it can be cached, or alternatively cache the first user message.

Huge file creations or modifications returned in the next tool response. Maybe selectively compress messages immediatly, not just the previous tool responses. The text in the tool response is already included in the assistant tool call message.

### Each call has approx 50/50 system/user input tokens

User messages are already compressed aggresively (except for the first message which contains full git diff in the builder, big culprit).

Assistant messages (tool calls) rarely have a huge output that needs compression. We should reduce compression, or at lease make it more surgical, to preserve more of the tool results in the conversation. The model can always call the tool again if it needs to re-read a file or re-check a diff. Potentially summarize the tool result using a cheap LLM before putting it back in the conversation, to preserve key information while cutting down on tokens.

### The context preinject/dynamic fetch balance

We add the full codebase codebase, git diff, plan and so on. We should find a balance between omitting data and letting the model spent turns fetching, and pre-including data and skipping a turn, at the cost of having it in every single request.

Preinjecting:

- Better output (more context) up to a point (too much context, diluting).
- Fewer turns spent fetching, more efficient.
- Potentially less accurate if it overwhelms the model with too much context.

Dynamic fetching:

- Less context in each request, but more relevant (fetching only what it needs).
- More turns spent fetching, less efficient.
- Potentially more accurate if it avoids overwhelming the model with too much context.

### Resolutions

Compress user messages when tokens reach a specific threshold.
Reduce or remove git diff context in the builder's first message.
Less compression of tool results, or summarize them properly in tiers as it falls further back in the messages, instead of just redacting.
Reduce the amount of codebase context pre-injected in the builder prompt, especially declarations. Alternatively inject it dynamically based on what the model needs, but this can be difficult to predict and will invalidate the cache.

## BETTER ERROR HANDLING

If an iteration fails, try and recover programatically. Clean up branches, reset to main, etc. If we can reliably recover, we can set the agent to retry indefinitely until it succeeds.

If the PR has already merged, meaning the latest code is already deployed, we need to go into RECOVERY MODE, where we roll back to the last known good state with ArgoCD, and then set the agent to fix the specific issue causing the failure and retry indefinitely until it succeeds. This way we can guarantee that the agent will eventually succeed and keep evolving, even if it hits a wall on a particular change.

Alternatively, restructure so that the agent always runs as a new branch off main, and only merges the past PR to main after the code has successfully completed a iteration. Sort of testing the previous iteration by trying to build the new iteration off of it, which fits well with the idea that each iteration is a new version of the agent. This way if an iteration fails, we can just abandon that branch and start fresh from main, without worrying about rolling back deployed code. The downside is that if the previous iteration introduced a failure, all work done in the new iteration up to the failure is reached will be lost.
