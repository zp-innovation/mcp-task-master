#!/usr/bin/env node

/**
 * Claude Task Master CLI
 * Main entry point for globally installed package
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { Command } from 'commander';
import { displayHelp, displayBanner } from '../scripts/modules/ui.js';
import { registerCommands } from '../scripts/modules/commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Get package information
const packageJson = require('../package.json');
const version = packageJson.version;

// Get paths to script files
const devScriptPath = resolve(__dirname, '../scripts/dev.js');
const initScriptPath = resolve(__dirname, '../scripts/init.js');

// Helper function to run dev.js with arguments
function runDevScript(args) {
  const child = spawn('node', [devScriptPath, ...args], {
    stdio: 'inherit',
    cwd: process.cwd()
  });
  
  child.on('close', (code) => {
    process.exit(code);
  });
}

/**
 * Create a wrapper action that passes the command to dev.js
 * @param {string} commandName - The name of the command
 * @returns {Function} Wrapper action function
 */
function createDevScriptAction(commandName) {
  return (options, cmd) => {
    // Start with the command name
    const args = [commandName];
    
    // Handle direct arguments (non-option arguments)
    if (cmd && cmd.args && cmd.args.length > 0) {
      args.push(...cmd.args);
    }
    
    // Add all options
    Object.entries(options).forEach(([key, value]) => {
      // Skip the Command's built-in properties
      if (['parent', 'commands', 'options', 'rawArgs'].includes(key)) {
        return;
      }
      
      // Handle boolean flags
      if (typeof value === 'boolean') {
        if (value === true) {
          args.push(`--${key}`);
        } else if (key.startsWith('no-')) {
          // Handle --no-X options
          const baseOption = key.substring(3);
          args.push(`--${baseOption}`);
        }
      } else if (value !== undefined) {
        args.push(`--${key}`, value.toString());
      }
    });
    
    runDevScript(args);
  };
}

// Special case for the 'init' command which uses a different script
function registerInitCommand(program) {
  program
    .command('init')
    .description('Initialize a new project')
    .option('-y, --yes', 'Skip prompts and use default values')
    .option('-n, --name <name>', 'Project name')
    .option('-d, --description <description>', 'Project description')
    .option('-v, --version <version>', 'Project version')
    .option('-a, --author <author>', 'Author name')
    .option('--skip-install', 'Skip installing dependencies')
    .option('--dry-run', 'Show what would be done without making changes')
    .action((options) => {
      // Pass through any options to the init script
      const args = ['--yes', 'name', 'description', 'version', 'author', 'skip-install', 'dry-run']
        .filter(opt => options[opt])
        .map(opt => {
          if (opt === 'yes' || opt === 'skip-install' || opt === 'dry-run') {
            return `--${opt}`;
          }
          return `--${opt}=${options[opt]}`;
        });
      
      const child = spawn('node', [initScriptPath, ...args], {
        stdio: 'inherit',
        cwd: process.cwd()
      });
      
      child.on('close', (code) => {
        process.exit(code);
      });
    });
}

// Set up the command-line interface
const program = new Command();

program
  .name('task-master')
  .description('Claude Task Master CLI')
  .version(version)
  .addHelpText('afterAll', () => {
    // Use the same help display function as dev.js for consistency
    displayHelp();
    return ''; // Return empty string to prevent commander's default help
  });

// Add custom help option to directly call our help display
program.helpOption('-h, --help', 'Display help information');
program.on('--help', () => {
  displayHelp();
});

// Add special case commands
registerInitCommand(program);

program
  .command('dev')
  .description('Run the dev.js script')
  .allowUnknownOption(true)
  .action(() => {
    const args = process.argv.slice(process.argv.indexOf('dev') + 1);
    runDevScript(args);
  });

// Use a temporary Command instance to get all command definitions
const tempProgram = new Command();
registerCommands(tempProgram);

// For each command in the temp instance, add a modified version to our actual program
tempProgram.commands.forEach(cmd => {
  if (['init', 'dev'].includes(cmd.name())) {
    // Skip commands we've already defined specially
    return;
  }
  
  // Create a new command with the same name and description
  const newCmd = program
    .command(cmd.name())
    .description(cmd.description());
  
  // Copy all options
  cmd.options.forEach(opt => {
    newCmd.option(
      opt.flags,
      opt.description,
      opt.defaultValue
    );
  });
  
  // Set the action to proxy to dev.js
  newCmd.action(createDevScriptAction(cmd.name()));
});

// Parse the command line arguments
program.parse(process.argv);

// Show help if no command was provided (just 'task-master' with no args)
if (process.argv.length <= 2) {
  displayBanner();
  displayHelp();
  process.exit(0);
} 