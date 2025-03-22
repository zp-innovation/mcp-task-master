# Task Master
### by [@eyaltoledano](https://x.com/eyaltoledano)

A task management system for AI-driven development with Claude.

## Installation

```bash
npm install -g task-master-ai
```

## Usage

### Initialize a new project

```bash
# Navigate to your project directory
mkdir my-new-project
cd my-new-project

# Initialize the project
task-master-init
```

This will create the necessary file structure for your project, including:

- `.cursor/rules/dev_workflow.mdc` - Cursor rules for AI-driven development
- `scripts/dev.js` - Task management script
- `scripts/README.md` - Documentation for the script
- `scripts/example_prd.txt` - Example PRD template
- `.env.example` - Example environment variables
- `.gitignore` - Git ignore file
- `package.json` - Project configuration
- `tasks.json` - Empty tasks file
- `tasks/` - Directory for task files

## Documentation

For more detailed documentation, see the README.md file in your initialized project.

## License

MIT 