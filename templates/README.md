# {{projectName}}

{{projectDescription}}

A task management system for AI-driven development with Claude, designed to work seamlessly with Cursor AI.

## Overview

This project uses the Claude Task Master system to manage development tasks in an AI-driven workflow. The system revolves around a `tasks.json` file, which holds an up-to-date list of development tasks.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your environment:
   - Copy `.env.example` to `.env`
   - Add your Anthropic API key to the `.env` file

3. Parse your PRD to generate tasks:
   ```bash
   npm run parse-prd -- --input=your-prd-file.txt
   ```

4. View current tasks:
   ```bash
   npm run list
   ```

5. Generate task files:
   ```bash
   npm run generate
   ```

### Important Notes

1. This project uses ES modules. The package.json includes `"type": "module"`.
2. The Anthropic SDK version should be 0.39.0 or higher.
3. If you encounter JSON parsing errors, make sure your Anthropic API key is valid and your environment is set up correctly.

## Integrating with Cursor AI

This project includes Cursor AI integration through the `.cursor/rules/dev_workflow.mdc` file, which provides the AI with knowledge about the task management system.

### Using Cursor Agent Mode

1. Open this project in Cursor
2. Open Cursor's AI chat and switch to Agent mode
3. The agent will automatically understand the task management workflow

### Working with the Agent

You can ask the Cursor agent to:

- **Generate tasks**: "Please parse my PRD at scripts/prd.txt and generate tasks"
- **List tasks**: "What tasks are available to work on next?"
- **Implement tasks**: "Let's implement task 3. What does it involve?"
- **Update task status**: "Task 3 is now complete. Please update its status"
- **Handle changes**: "We're now using Express instead of Fastify. Update future tasks"
- **Break down tasks**: "Task 5 seems complex. Can you break it down into subtasks?"

The agent will execute the appropriate commands and guide you through the development process.

## Development Workflow

The development workflow follows these steps:

1. **Initial Setup**: If starting a new project with a PRD document, run `npm run parse-prd -- --input=<prd-file.txt>` to generate the initial tasks.json file.

2. **Task Discovery**: When a coding session begins, run `npm run list` to see the current tasks, their status, and IDs.

3. **Task Selection**: Select the next pending task based on these criteria:
   - Dependencies: Only select tasks whose dependencies are marked as 'done'
   - Priority: Choose higher priority tasks first ('high' > 'medium' > 'low')
   - ID order: When priorities are equal, select the task with the lowest ID

4. **Task Clarification**: If a task description is unclear or lacks detail:
   - Check if a corresponding task file exists in the tasks/ directory
   - If more information is needed, ask for clarification
   - If architectural changes have occurred, run `npm run dev -- update --from=<id> --prompt="<new architectural context>"` to update the task and all subsequent tasks

5. **Task Breakdown**: For complex tasks that need to be broken down into smaller steps:
   - Use `npm run dev -- expand --id=<id> --subtasks=<number>` to generate detailed subtasks
   - Optionally provide additional context with `--prompt="<context>"` to guide subtask generation

6. **Task Implementation**: Implement the code necessary for the chosen task.

7. **Task Verification**: Before marking a task as done, verify it according to the task's specified 'testStrategy'.

8. **Task Completion**: When a task is completed and verified, run `npm run dev -- set-status --id=<id> --status=done` to mark it as done.

9. **Implementation Drift Handling**: If during implementation, you discover that the approach differs significantly from what was planned, call `npm run dev -- update --from=<futureTaskId> --prompt="Detailed explanation of changes..."` to rewrite subsequent tasks.

10. **Task File Generation**: After any updates to tasks.json, run `npm run generate` to regenerate the individual task files.

## Command Reference

### Parse PRD
```bash
npm run parse-prd -- --input=<prd-file.txt>
```

### List Tasks
```bash
npm run list
```

### Update Tasks
```bash
npm run dev -- update --from=<id> --prompt="<prompt>"
```

### Generate Task Files
```bash
npm run generate
```

### Set Task Status
```bash
npm run dev -- set-status --id=<id> --status=<status>
```

### Expand Tasks
```bash
npm run dev -- expand --id=<id> --subtasks=<number> --prompt="<context>"
```
or
```bash
npm run dev -- expand --all
```

## Task Structure

Tasks in tasks.json have the following structure:

- `id`: Unique identifier for the task
- `title`: Brief, descriptive title of the task
- `description`: Concise description of what the task involves
- `status`: Current state of the task (pending, done, deferred)
- `dependencies`: IDs of tasks that must be completed before this task
- `priority`: Importance level of the task (high, medium, low)
- `details`: In-depth instructions for implementing the task
- `testStrategy`: Approach for verifying the task has been completed correctly
- `subtasks`: List of smaller, more specific tasks that make up the main task

## Best Practices for AI-Driven Development

1. **Start with a detailed PRD**: The more detailed your PRD, the better the generated tasks will be.

2. **Review generated tasks**: After parsing the PRD, review the tasks to ensure they make sense and have appropriate dependencies.

3. **Follow the dependency chain**: Always respect task dependencies - the Cursor agent will help with this.

4. **Update as you go**: If your implementation diverges from the plan, use the update command to keep future tasks aligned with your current approach.

5. **Break down complex tasks**: Use the expand command to break down complex tasks into manageable subtasks.

6. **Regenerate task files**: After any updates to tasks.json, regenerate the task files to keep them in sync.

7. **Communicate context to the agent**: When asking the Cursor agent to help with a task, provide context about what you're trying to achieve.

## Configuration

The system can be configured through environment variables in a `.env` file:

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

## Additional Documentation

For more detailed documentation on the scripts, see the [scripts/README.md](scripts/README.md) file.

## License

Copyright (c) {{year}} {{authorName}} 