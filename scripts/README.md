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
7. **Research-backed subtask generation**—use Perplexity AI to generate more informed and contextually relevant subtasks.

## Configuration

The script can be configured through environment variables in a `.env` file at the root of the project:

### Required Configuration
- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude

### Optional Configuration
- `MODEL`: Specify which Claude model to use (default: "claude-3-7-sonnet-20250219")
- `MAX_TOKENS`: Maximum tokens for model responses (default: 4000)
- `TEMPERATURE`: Temperature for model responses (default: 0.7)
- `PERPLEXITY_API_KEY`: Your Perplexity API key for research-backed subtask generation
- `PERPLEXITY_MODEL`: Specify which Perplexity model to use (default: "sonar-medium-online")
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

## Listing Tasks

The `list` command allows you to view all tasks and their status:

```bash
# List all tasks
node scripts/dev.js list

# List tasks with a specific status
node scripts/dev.js list --status=pending

# List tasks and include their subtasks
node scripts/dev.js list --with-subtasks

# List tasks with a specific status and include their subtasks
node scripts/dev.js list --status=pending --with-subtasks
```

## Updating Tasks

The `update` command allows you to update tasks based on new information or implementation changes:

```bash
# Update tasks starting from ID 4 with a new prompt
node scripts/dev.js update --from=4 --prompt="Refactor tasks from ID 4 onward to use Express instead of Fastify"

# Update all tasks (default from=1)
node scripts/dev.js update --prompt="Add authentication to all relevant tasks"

# Specify a different tasks file
node scripts/dev.js update --file=custom-tasks.json --from=5 --prompt="Change database from MongoDB to PostgreSQL"
```

Notes:
- The `--prompt` parameter is required and should explain the changes or new context
- Only tasks that aren't marked as 'done' will be updated
- Tasks with ID >= the specified --from value will be updated

## Expanding Tasks

The `expand` command allows you to break down tasks into subtasks for more detailed implementation:

```bash
# Expand a specific task with 3 subtasks (default)
node scripts/dev.js expand --id=3

# Expand a specific task with 5 subtasks
node scripts/dev.js expand --id=3 --num=5

# Expand a task with additional context
node scripts/dev.js expand --id=3 --prompt="Focus on security aspects"

# Expand all pending tasks that don't have subtasks
node scripts/dev.js expand --all

# Force regeneration of subtasks for all pending tasks
node scripts/dev.js expand --all --force

# Use Perplexity AI for research-backed subtask generation
node scripts/dev.js expand --id=3 --research

# Use Perplexity AI for research-backed generation on all pending tasks
node scripts/dev.js expand --all --research
```

Notes:
- Tasks marked as 'done' or 'completed' are always skipped
- By default, tasks that already have subtasks are skipped unless `--force` is used
- Subtasks include title, description, dependencies, and acceptance criteria
- The `--research` flag uses Perplexity AI to generate more informed and contextually relevant subtasks
- If Perplexity API is unavailable, the script will fall back to using Anthropic's Claude

## AI Integration

The script integrates with two AI services:

1. **Anthropic Claude**: Used for parsing PRDs, generating tasks, and creating subtasks.
2. **Perplexity AI**: Used for research-backed subtask generation when the `--research` flag is specified.

The Perplexity integration uses the OpenAI client to connect to Perplexity's API, which provides enhanced research capabilities for generating more informed subtasks. If the Perplexity API is unavailable or encounters an error, the script will automatically fall back to using Anthropic's Claude.

To use the Perplexity integration:
1. Obtain a Perplexity API key
2. Add `PERPLEXITY_API_KEY` to your `.env` file
3. Optionally specify `PERPLEXITY_MODEL` in your `.env` file (default: "sonar-medium-online")
4. Use the `--research` flag with the `expand` command

## Logging

The script supports different logging levels controlled by the `LOG_LEVEL` environment variable:
- `debug`: Detailed information, typically useful for troubleshooting
- `info`: Confirmation that things are working as expected (default)
- `warn`: Warning messages that don't prevent execution
- `error`: Error messages that might prevent execution

When `DEBUG=true` is set, debug logs are also written to a `dev-debug.log` file in the project root.
