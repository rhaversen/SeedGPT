// split(task_id) – Break a large task into subtasks
// add(parent_id, new_task) – Add new task (child/sibling/root)
// propose_update(task_id, field, value) – Suggest edits
// remove(task_id) – Retire a stagnant/invalid task
// set_status(task_id, status) – in_progress / done
// set_priority / set_difficulty
// approve(task_id) – Mark as OK
// reject(task_id, reason) – Flag for revision


const TOOL_SPECS = [
  {
    "name": "read_features",
    "description": "Retrieves a list of available software features or user stories that can be implemented. This tool returns a predefined list of feature requests such as authentication, payment processing, error handling improvements, documentation, and database optimizations. Use this tool when you need to see what development tasks are available to work on. The tool does not require any parameters and will always return the same static list of features. It does not provide details about feature priority, complexity, or implementation status.",
    "input_schema": { "type": "object", "properties": {}, "required": [] }
  },
  {
    "name": "search_codebase",
    "description": "Searches through Python files in the current project directory for a specific text query. This tool performs a case-insensitive search across all .py files recursively, limiting results to the first 10 matching files for performance. For each file containing the query, it returns the file path, line number, and the actual line content where the first match was found. Use this tool when you need to locate specific code patterns, function names, variable usage, or any text within the codebase. The search is literal text matching and does not support regex or advanced search patterns.",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The text string to search for within Python files. The search is case-insensitive and matches exact text sequences."
        }
      },
      "required": ["query"]
    }
  },
  {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 5
  },
  {
    "name": "create_branch",
    "description": "Creates a new Git branch from the current branch and switches to it. This tool takes a branch name, sanitizes it by converting spaces to hyphens and making it lowercase, then executes 'git checkout -b' to create and switch to the new branch. Use this tool when starting work on a new feature or bug fix that requires a separate development branch. The tool will fail if a branch with the same name already exists or if there are uncommitted changes that prevent branch creation. It returns the sanitized branch name on success.",
    "input_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "The desired name for the new Git branch. Spaces will be converted to hyphens and the name will be lowercased for Git compatibility."
        }
      },
      "required": ["name"]
    }
  },
  {
    "name": "create_patch",
    "description": "Applies a Git patch (diff) to the current working directory and commits the changes. This tool writes the provided diff content to a temporary patch file, applies it using 'git apply', stages all changes with 'git add .', and commits with a standard 'Agent patch' message. Use this tool when you have generated code changes in diff format that need to be applied to the repository. The tool will fail if the patch cannot be applied cleanly due to conflicts or if the diff format is invalid. The temporary patch file is automatically cleaned up regardless of success or failure.",
    "input_schema": {
      "type": "object",
      "properties": {
        "diff": {
          "type": "string",
          "description": "The Git diff/patch content to apply. This should be a properly formatted unified diff that can be processed by 'git apply'."
        }
      },
      "required": ["diff"]
    }
  },
  {
    "name": "merge",
    "description": "Merges the current Git branch into the main branch. This tool first determines the current branch name, switches to the main branch, and then merges the original branch into main. Use this tool when you have completed development on a feature branch and want to integrate the changes into the main codebase. The tool will fail if there are merge conflicts that cannot be automatically resolved, if the main branch doesn't exist, or if there are uncommitted changes. The pr parameter is currently accepted but not used in the implementation.",
    "input_schema": {
      "type": "object",
      "properties": {
        "pr": {
          "type": "integer",
          "description": "Pull request number (currently not used in implementation but required for the tool interface)."
        }
      },
      "required": ["pr"]
    }
  },
  {
    "name": "delete_branch",
    "description": "Deletes a Git branch from the local repository. This tool executes 'git branch -d' to remove the specified branch. Use this tool to clean up feature branches after they have been merged or are no longer needed. The tool will fail if you try to delete the currently checked out branch, if the branch doesn't exist, or if the branch contains unmerged changes (Git's safety check). For force deletion of unmerged branches, this tool cannot be used as it only performs safe deletion.",
    "input_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "The exact name of the Git branch to delete. The branch must exist and cannot be the currently checked out branch."
        }
      },
      "required": ["name"]
    }
  }
]
