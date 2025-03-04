# Claude Task Master

A task management system for AI-driven development with Claude, designed to work seamlessly with Cursor AI.

## Requirements

- Node.js 14.0.0 or higher
- Anthropic API key (Claude API)
- Anthropic SDK version 0.39.0 or higher

## Installation

```bash
npm install claude-task-master
```

## Usage

### Initialize a new project

```bash
npx claude-task-init
```

This will prompt you for project details and set up a new project with the necessary files and structure.

### Important Notes

1. This package uses ES modules. Your package.json should include `"type": "module"`.
2. The Anthropic SDK version should be 0.39.0 or higher.

## Troubleshooting

### If `npx claude-task-init` doesn't respond:

Try running it with Node directly:

```bash
node node_modules/claude-task-master/scripts/init.js
```

Or clone the repository and run:

```bash
git clone https://github.com/eyaltoledano/claude-task-master.git
cd claude-task-master
node scripts/init.js
```

## Integrating with Cursor AI

Claude Task Master is designed to work seamlessly with [Cursor AI](https://www.cursor.so/), providing a structured workflow for AI-driven development.

### Setup with Cursor

1. After initializing your project, open it in Cursor
2. The `.cursor/rules/dev_workflow.mdc` file is automatically loaded by Cursor, providing the AI with knowledge about the task management system
3. Place your PRD document in the `scripts/` directory (e.g., `scripts/prd.txt`)
4. Open Cursor's AI chat and switch to Agent mode

### Initial Task Generation

In Cursor's AI chat, instruct the agent to generate tasks from your PRD:

```
Please use the dev.js script to parse my PRD and generate tasks. The PRD is located at scripts/prd.txt.
```

The agent will execute:
```bash
node scripts/dev.js parse-prd --input=scripts/prd.txt
```

This will:
- Parse your PRD document
- Generate a structured `tasks.json` file with tasks, dependencies, priorities, and test strategies
- The agent will understand this process due to the Cursor rules

### Generate Individual Task Files

Next, ask the agent to generate individual task files:

```
Please generate individual task files from tasks.json
```

The agent will execute:
```bash
node scripts/dev.js generate
```

This creates individual task files in the `tasks/` directory (e.g., `task_001.txt`, `task_002.txt`), making it easier to reference specific tasks.

## AI-Driven Development Workflow

The Cursor agent is pre-configured (via the rules file) to follow this workflow:

### 1. Task Discovery and Selection

Ask the agent to list available tasks:

```
What tasks are available to work on next?
```

The agent will:
- Run `node scripts/dev.js list` to see all tasks
- Analyze dependencies to determine which tasks are ready to be worked on
- Prioritize tasks based on priority level and ID order
- Suggest the next task(s) to implement

### 2. Task Implementation

When implementing a task, the agent will:
- Reference the task's details section for implementation specifics
- Consider dependencies on previous tasks
- Follow the project's coding standards
- Create appropriate tests based on the task's testStrategy

You can ask:
```
Let's implement task 3. What does it involve?
```

### 3. Task Verification

Before marking a task as complete, verify it according to:
- The task's specified testStrategy
- Any automated tests in the codebase
- Manual verification if required

### 4. Task Completion

When a task is completed, tell the agent:

```
Task 3 is now complete. Please update its status.
```

The agent will execute:
```bash
node scripts/dev.js set-status --id=3 --status=done
```

### 5. Handling Implementation Drift

If during implementation, you discover that:
- The current approach differs significantly from what was planned
- Future tasks need to be modified due to current implementation choices
- New dependencies or requirements have emerged

Tell the agent:
```
We've changed our approach. We're now using Express instead of Fastify. Please update all future tasks to reflect this change.
```

The agent will execute:
```bash
node scripts/dev.js update --from=4 --prompt="Now we are using Express instead of Fastify."
```

This will rewrite or re-scope subsequent tasks in tasks.json while preserving completed work.

### 6. Breaking Down Complex Tasks

For complex tasks that need more granularity:

```
Task 5 seems complex. Can you break it down into subtasks?
```

The agent will execute:
```bash
node scripts/dev.js expand --id=5 --subtasks=3
```

You can provide additional context:
```
Please break down task 5 with a focus on security considerations.
```

The agent will execute:
```bash
node scripts/dev.js expand --id=5 --prompt="Focus on security aspects"
```

You can also expand all pending tasks:
```
Please break down all pending tasks into subtasks.
```

The agent will execute:
```bash
node scripts/dev.js expand --all
```

## Manual Command Reference

While the Cursor agent will handle most commands for you, you can also run them manually:

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

## Example Cursor AI Interactions

### Starting a new project
```
I've just initialized a new project with Claude Task Master. I have a PRD at scripts/prd.txt. 
Can you help me parse it and set up the initial tasks?
```

### Working on tasks
```
What's the next task I should work on? Please consider dependencies and priorities.
```

### Implementing a specific task
```
I'd like to implement task 4. Can you help me understand what needs to be done and how to approach it?
```

### Handling changes
```
We've decided to use MongoDB instead of PostgreSQL. Can you update all future tasks to reflect this change?
```

### Completing work
```
I've finished implementing the authentication system described in task 2. All tests are passing. 
Please mark it as complete and tell me what I should work on next.
```

## Documentation

For more detailed documentation on the scripts, see the [scripts/README.md](scripts/README.md) file in your initialized project.

## License

MIT 