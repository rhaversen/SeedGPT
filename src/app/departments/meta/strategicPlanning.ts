// Ensures task fits roadmap, priorities, long-term impact
// Is this worth doing?

// Ensures each task contributes to long-term evolution
// Sets/adjusts task priority, flags scope mismatch

// Strategic Planning watches the DAG for new epic nodes. When it sees one:
// It selects valuable epics (based on novelty, fit, priority).
// It converts the epic into one or more executable task nodes.
// The original epic node is marked converted and archived.

// Goal Alignment
// Does the task support one of your core system objectives?
// If not, it can reject (“off-roadmap”) or propose_update to tie it back to a goal.

// Roadmap & Sequencing
// Is this the right time to tackle it?
// It may set_priority (high/medium/low) or add_subtask “complete prerequisite X” if something must come first.

// Value Estimation
// Rough scoring of impact (1–10) and urgency (1–10).
// If impact is high but urgency low, assign medium priority; or vice versa.

// Scope & Granularity
// Is the task too big (an “epic”)?
// It can split into smaller deliverables that fit one iteration.

// Backlog Hygiene
// Identify stagnant epics that never matured: remove or downgrade_priority.
// Propose new tasks and stories to fill roadmap gaps.

// Break epics into stories
// Break stories into tasks