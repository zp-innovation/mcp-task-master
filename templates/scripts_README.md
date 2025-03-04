# Meta-Development Script

This folder contains a **meta-development script** (`dev.js`) and related utilities that manage tasks for an AI-driven or traditional software development workflow. The script revolves around a `tasks.json` file, which holds an up-to-date list of development tasks.

## Overview

In an AI-driven development process—particularly with tools like [Cursor](https://www.cursor.so/)—it's beneficial to have a **single source of truth** for tasks. This script allows you to:

1. **Parse** a PRD or requirements document (`.txt`) to initialize a set of tasks (`tasks.json`).
2. **List** all existing tasks (IDs, statuses, titles).
3. **Update** tasks to accommodate new prompts or architecture changes (useful if you discover "implementation drift").
4. **Generate** individual task files (e.g., `task_001.txt`) for easy reference or to feed into an AI coding workflow.
5. **Set task status**—mark tasks as `done`, `pending`, or `deferred` based on progress.
6. **Expand** tasks with subtasks—break down complex tasks into smaller, more manageable subtasks.

## Configuration

The script can be configured through environment variables in a `.env` file at the root of the project:

### Required Configuration
- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude

### Optional Configuration
- `MODEL`: Specify which Claude model to use (default: "claude-3-7-sonnet-20250219")
- `MAX_TOKENS`: Maximum tokens for model responses (default: 4000)
- `TEMPERATURE`: Temperature for model responses (default: 0.7)
- `DEBUG`: Enable debug logging (default: false)
- `LOG_LEVEL`: Log level - debug, info, warn, error (default: info)
- `DEFAULT_SUBTASKS`: Default number of subtasks when expanding (default: 3)
- `DEFAULT_PRIORITY`: Default priority for generated tasks (default: medium)
- `PROJECT_NAME`: Override default project name in tasks.json
- `PROJECT_VERSION`: Override default version in tasks.json

## How It Works

1. **`tasks.json`**:  
   - A JSON file at the project root containing an array of tasks (each with `id`, `title`, `description`, `status`, etc.).  
   - The `meta` field can store additional info like the project's name, version, or reference to the PRD.  
   - Tasks can have `subtasks` for more detailed implementation steps.

2. **Script Commands**  
   You can run the script via:

   ```bash
   node scripts/dev.js [command] [options]
   ```

   Available commands:

   - `parse-prd`: Generate tasks from a PRD document
   - `list`: Display all tasks with their status
   - `update`: Update tasks based on new information
   - `generate`: Create individual task files
   - `set-status`: Change a task's status
   - `expand`: Add subtasks to a task or all tasks

   Run `node scripts/dev.js` without arguments to see detailed usage information.

## Expanding Tasks

The `expand` command allows you to break down tasks into subtasks for more detailed implementation:

```bash
# Expand a specific task with 3 subtasks (default)
node scripts/dev.js expand --id=3

# Expand a specific task with 5 subtasks
node scripts/dev.js expand --id=3 --subtasks=5

# Expand a task with additional context
node scripts/dev.js expand --id=3 --prompt="Focus on security aspects"

# Expand all pending tasks that don't have subtasks
node scripts/dev.js expand --all

# Force regeneration of subtasks for all pending tasks
node scripts/dev.js expand --all --force
```

Notes:
- Tasks marked as 'done' or 'completed' are always skipped
- By default, tasks that already have subtasks are skipped unless `--force` is used
- Subtasks include title, description, dependencies, and acceptance criteria

## Logging

The script supports different logging levels controlled by the `LOG_LEVEL` environment variable:
- `debug`: Detailed information, typically useful for troubleshooting
- `info`: Confirmation that things are working as expected (default)
- `warn`: Warning messages that don't prevent execution
- `error`: Error messages that might prevent execution

When `DEBUG=true` is set, debug logs are also written to a `dev-debug.log` file in the project root.
