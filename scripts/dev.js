#!/usr/bin/env node

/**
 * dev.js
 *
 * Subcommands:
 *   1) parse-prd --input=some-prd.txt [--tasks=10]
 *      -> Creates/overwrites tasks.json with a set of tasks (naive or LLM-based).
 *      -> Optional --tasks parameter limits the number of tasks generated.
 *
 *   2) update --from=5 --prompt="We changed from Slack to Discord."
 *      -> Regenerates tasks from ID >= 5 using the provided prompt (or naive approach).
 *
 *   3) generate
 *      -> Generates per-task files (e.g., task_001.txt) from tasks.json
 *
 *   4) set-status --id=4 --status=done
 *      -> Updates a single task's status to done (or pending, deferred, etc.).
 *
 *   5) list
 *      -> Lists tasks in a brief console view (ID, title, status).
 *
 *   6) expand --id=3 --subtasks=5 [--prompt="Additional context"]
 *      -> Expands a task with subtasks for more detailed implementation.
 *      -> Use --all instead of --id to expand all tasks.
 *      -> Optional --subtasks parameter controls number of subtasks (default: 3).
 *      -> Add --force when using --all to regenerate subtasks for tasks that already have them.
 *      -> Note: Tasks marked as 'done' or 'completed' are always skipped.
 *
 * Usage examples:
 *   node dev.js parse-prd --input=sample-prd.txt
 *   node dev.js parse-prd --input=sample-prd.txt --tasks=10
 *   node dev.js update --from=4 --prompt="Refactor tasks from ID 4 onward"
 *   node dev.js generate
 *   node dev.js set-status --id=3 --status=done
 *   node dev.js list
 *   node dev.js expand --id=3 --subtasks=5
 *   node dev.js expand --all
 *   node dev.js expand --all --force
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';

// Set up configuration with environment variables or defaults
const CONFIG = {
  model: process.env.MODEL || "claude-3-7-sonnet-20250219",
  maxTokens: parseInt(process.env.MAX_TOKENS || "4000"),
  temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
  debug: process.env.DEBUG === "true",
  logLevel: process.env.LOG_LEVEL || "info",
  defaultSubtasks: parseInt(process.env.DEFAULT_SUBTASKS || "3"),
  defaultPriority: process.env.DEFAULT_PRIORITY || "medium",
  projectName: process.env.PROJECT_NAME || "MCP SaaS MVP",
  projectVersion: process.env.PROJECT_VERSION || "1.0.0"
};

// Set up logging based on log level
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function log(level, ...args) {
  if (LOG_LEVELS[level] >= LOG_LEVELS[CONFIG.logLevel]) {
    if (level === 'error') {
      console.error(...args);
    } else if (level === 'warn') {
      console.warn(...args);
    } else {
      console.log(...args);
    }
  }
  
  // Additional debug logging to file if debug mode is enabled
  if (CONFIG.debug && level === 'debug') {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [DEBUG] ${args.join(' ')}\n`;
    fs.appendFileSync('dev-debug.log', logMessage);
  }
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function readJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(content);
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

async function callClaude(prdContent, prdPath, numTasks) {
  log('info', `Starting Claude API call to process PRD from ${prdPath}...`);
  log('debug', `PRD content length: ${prdContent.length} characters`);
  
  const TASKS_JSON_TEMPLATE = `
  {
    "meta": {
      "projectName": "${CONFIG.projectName}",
      "version": "${CONFIG.projectVersion}",
      "source": "${prdPath}",
      "description": "Tasks generated from ${prdPath.split('/').pop()}"
    },
    "tasks": [
      {
        "id": 1,
        "title": "Set up project scaffolding",
        "description": "Initialize repository structure with Wrangler configuration for Cloudflare Workers, set up D1 database schema, and configure development environment.",
        "status": "pending",
        "dependencies": [],
        "priority": "high",
        "details": "Create the initial project structure including:\n- Wrangler configuration for Cloudflare Workers\n- D1 database schema setup\n- Development environment configuration\n- Basic folder structure for the project",
        "testStrategy": "Verify that the project structure is set up correctly and that the development environment can be started without errors."
      },
      {
        "id": 2,
        "title": "Implement GitHub OAuth flow",
        "description": "Create authentication system using GitHub OAuth for user sign-up and login, storing authenticated user profiles in D1 database.",
        "status": "pending",
        "dependencies": [1],
        "priority": "${CONFIG.defaultPriority}",
        "details": "Implement the GitHub OAuth flow for user authentication:\n- Create OAuth application in GitHub\n- Implement OAuth callback endpoint\n- Store user profiles in D1 database\n- Create session management",
        "testStrategy": "Test the complete OAuth flow from login to callback to session creation. Verify user data is correctly stored in the database."
      }
    ]
  }`

  let systemPrompt = "You are a helpful assistant that generates tasks from a PRD using the following template: " + TASKS_JSON_TEMPLATE + "ONLY RETURN THE JSON, NOTHING ELSE.";
  
  // Add instruction about the number of tasks if specified
  if (numTasks) {
    systemPrompt += ` Generate exactly ${numTasks} tasks.`;
  } else {
    systemPrompt += " Generate a comprehensive set of tasks that covers all requirements in the PRD.";
  }

  log('debug', "System prompt:", systemPrompt);
  log('info', "Sending request to Claude API...");
  
  const response = await anthropic.messages.create({
    max_tokens: CONFIG.maxTokens,
    model: CONFIG.model,
    temperature: CONFIG.temperature,
    messages: [
      { 
        role: "user", 
        content: prdContent 
      }
    ],
    system: systemPrompt
  });
  log('info', "Received response from Claude API!");

  // Extract the text content from the response
  const textContent = response.content[0].text;
  log('debug', `Response length: ${textContent.length} characters`);
  
  try {
    // Check if the response is wrapped in a Markdown code block and extract the JSON
    log('info', "Parsing response as JSON...");
    let jsonText = textContent;
    const codeBlockMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      log('debug', "Detected JSON wrapped in Markdown code block, extracting...");
      jsonText = codeBlockMatch[1];
    }
    
    // Try to parse the response as JSON
    const parsedJson = JSON.parse(jsonText);
    log('info', `Successfully parsed JSON with ${parsedJson.tasks?.length || 0} tasks`);
    return parsedJson;
  } catch (error) {
    log('error', "Failed to parse Claude's response as JSON:", error);
    log('debug', "Raw response:", textContent);
    throw new Error("Failed to parse Claude's response as JSON. See console for details.");
  }
}

//
// 1) parse-prd
//
async function parsePRD(prdPath, tasksPath, numTasks) {
  if (!fs.existsSync(prdPath)) {
    log('error', `PRD file not found: ${prdPath}`);
    process.exit(1);
  }

  log('info', `Reading PRD file from: ${prdPath}`);
  const prdContent = fs.readFileSync(prdPath, 'utf8');
  log('info', `PRD file read successfully. Content length: ${prdContent.length} characters`);

  // call claude to generate the tasks.json
  log('info', "Calling Claude to generate tasks from PRD...");
  const claudeResponse = await callClaude(prdContent, prdPath, numTasks);
  let tasks = claudeResponse.tasks || [];
  log('info', `Claude generated ${tasks.length} tasks from the PRD`);

  // Limit the number of tasks if specified
  if (numTasks && numTasks > 0 && numTasks < tasks.length) {
    log('info', `Limiting to the first ${numTasks} tasks as specified`);
    tasks = tasks.slice(0, numTasks);
  }

  log('info', "Creating tasks.json data structure...");
  const data = {
    meta: {
      projectName: CONFIG.projectName,
      version: CONFIG.projectVersion,
      source: prdPath,
      description: "Tasks generated from PRD",
      totalTasksGenerated: claudeResponse.tasks?.length || 0,
      tasksIncluded: tasks.length
    },
    tasks
  };

  log('info', `Writing ${tasks.length} tasks to ${tasksPath}...`);
  writeJSON(tasksPath, data);
  log('info', `Parsed PRD from '${prdPath}' -> wrote ${tasks.length} tasks to '${tasksPath}'.`);
}

//
// 2) update
//
async function updateTasks(tasksPath, fromId, prompt) {
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "Invalid or missing tasks.json.");
    process.exit(1);
  }
  log('info', `Updating tasks from ID >= ${fromId} with prompt: ${prompt}`);

  // In real usage, you'd feed data.tasks + prompt to an LLM. We'll just do a naive approach:
  data.tasks.forEach(task => {
    if (task.id >= fromId && task.status !== "done") {
      task.description += ` [UPDATED: ${prompt}]`;
    }
  });

  writeJSON(tasksPath, data);
  log('info', "Tasks updated successfully.");
}

//
// 3) generate
//
function generateTaskFiles(tasksPath, outputDir) {
  log('info', `Reading tasks from ${tasksPath}...`);
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks to generate. Please run parse-prd first.");
    process.exit(1);
  }
  
  log('info', `Found ${data.tasks.length} tasks to generate files for.`);
  
  // The outputDir is now the same directory as tasksPath, so we don't need to check if it exists
  // since we already did that in the main function
  
  log('info', "Generating individual task files...");
  data.tasks.forEach(task => {
    const filename = `task_${String(task.id).padStart(3, '0')}.txt`;
    const filepath = path.join(outputDir, filename);

    const content = [
      `# Task ID: ${task.id}`,
      `# Title: ${task.title}`,
      `# Status: ${task.status}`,
      `# Dependencies: ${task.dependencies.join(", ")}`,
      `# Priority: ${task.priority}`,
      `# Description: ${task.description}`,
      `# Details:\n${task.details}\n`,
      `# Test Strategy:`,
      `${task.testStrategy}\n`
    ].join('\n');

    fs.writeFileSync(filepath, content, 'utf8');
    log('info', `Generated: ${filename}`);
  });

  log('info', `All ${data.tasks.length} tasks have been generated into '${outputDir}'.`);
}

//
// 4) set-status
//
function setTaskStatus(tasksPath, taskId, newStatus) {
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks found.");
    process.exit(1);
  }

  const task = data.tasks.find(t => t.id === taskId);
  if (!task) {
    log('error', `Task with ID=${taskId} not found.`);
    process.exit(1);
  }

  const oldStatus = task.status;
  task.status = newStatus;
  writeJSON(tasksPath, data);
  log('info', `Task ID=${taskId} status changed from '${oldStatus}' to '${newStatus}'.`);
}

//
// 5) list tasks
//
function listTasks(tasksPath) {
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks found.");
    process.exit(1);
  }

  log('info', `Tasks in ${tasksPath}:`);
  data.tasks.forEach(t => {
    log('info', `- ID=${t.id}, [${t.status}] ${t.title}`);
  });
}

//
// 6) expand task with subtasks
//
async function expandTask(tasksPath, taskId, numSubtasks, additionalContext = '') {
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks found.");
    process.exit(1);
  }

  // Use default subtasks count from config if not specified
  numSubtasks = numSubtasks || CONFIG.defaultSubtasks;
  
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) {
    log('error', `Task with ID=${taskId} not found.`);
    process.exit(1);
  }
  
  // Skip tasks that are already completed
  if (task.status === 'done' || task.status === 'completed') {
    log('info', `Skipping task ID=${taskId} "${task.title}" - task is already marked as ${task.status}.`);
    log('info', `Use set-status command to change the status if you want to modify this task.`);
    return false;
  }

  log('info', `Expanding task: ${task.title}`);
  
  // Initialize subtasks array if it doesn't exist
  if (!task.subtasks) {
    task.subtasks = [];
  }
  
  // Calculate next subtask ID
  const nextSubtaskId = task.subtasks.length > 0 
    ? Math.max(...task.subtasks.map(st => st.id)) + 1 
    : 1;
  
  // Generate subtasks using Claude
  const subtasks = await generateSubtasks(task, numSubtasks, nextSubtaskId, additionalContext);
  
  // Add new subtasks to the task
  task.subtasks = [...task.subtasks, ...subtasks];
  
  // Update tasks.json
  writeJSON(tasksPath, data);
  log('info', `Added ${subtasks.length} subtasks to task ID=${taskId}.`);
  
  // Print the new subtasks
  log('info', "New subtasks:");
  subtasks.forEach(st => {
    log('info', `- ${st.id}. ${st.title}`);
  });
  
  return true;
}

//
// Expand all tasks with subtasks
//
async function expandAllTasks(tasksPath, numSubtasks, additionalContext = '', forceRegenerate = false) {
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks found.");
    process.exit(1);
  }

  log('info', `Expanding all ${data.tasks.length} tasks with subtasks...`);
  
  let tasksExpanded = 0;
  let tasksSkipped = 0;
  let tasksCompleted = 0;
  
  // Process each task sequentially to avoid overwhelming the API
  for (const task of data.tasks) {
    // Skip tasks that are already completed
    if (task.status === 'done' || task.status === 'completed') {
      log('info', `Skipping task ID=${task.id} "${task.title}" - task is already marked as ${task.status}.`);
      tasksCompleted++;
      continue;
    }
    
    // Skip tasks that already have subtasks unless force regeneration is enabled
    if (!forceRegenerate && task.subtasks && task.subtasks.length > 0) {
      log('info', `Skipping task ID=${task.id} "${task.title}" - already has ${task.subtasks.length} subtasks`);
      tasksSkipped++;
      continue;
    }
    
    const success = await expandTask(tasksPath, task.id, numSubtasks, additionalContext);
    if (success) {
      tasksExpanded++;
    }
  }
  
  log('info', `Expansion complete: ${tasksExpanded} tasks expanded, ${tasksSkipped} tasks skipped (already had subtasks), ${tasksCompleted} tasks skipped (already completed).`);
  
  if (tasksSkipped > 0) {
    log('info', `Tip: Use --force flag to regenerate subtasks for all tasks, including those that already have subtasks.`);
  }
  
  if (tasksCompleted > 0) {
    log('info', `Note: Completed tasks are always skipped. Use set-status command to change task status if needed.`);
  }
}

//
// Generate subtasks using Claude
//
async function generateSubtasks(task, numSubtasks, nextSubtaskId, additionalContext = '') {
  log('info', `Generating ${numSubtasks} subtasks for task: ${task.title}`);
  
  const existingSubtasksText = task.subtasks && task.subtasks.length > 0
    ? `\nExisting subtasks:\n${task.subtasks.map(st => `${st.id}. ${st.title}: ${st.description}`).join('\n')}`
    : '';
  
  const prompt = `
Task Title: ${task.title}
Task Description: ${task.description}
Task Details: ${task.details || ''}
${existingSubtasksText}
${additionalContext ? `\nAdditional Context: ${additionalContext}` : ''}

Please generate ${numSubtasks} detailed subtasks for this task. Each subtask should be specific, actionable, and help accomplish the main task. The subtasks should cover different aspects of the main task and provide clear guidance on implementation.

For each subtask, provide:
1. A concise title
2. A detailed description
3. Dependencies (if any)
4. Acceptance criteria

Format each subtask as follows:

Subtask ${nextSubtaskId}: [Title]
Description: [Detailed description]
Dependencies: [List any dependencies by ID, or "None" if there are no dependencies]
Acceptance Criteria: [List specific criteria that must be met for this subtask to be considered complete]

Then continue with Subtask ${nextSubtaskId + 1}, and so on.
`;

  log('info', "Calling Claude to generate subtasks...");
  
  const response = await anthropic.messages.create({
    max_tokens: CONFIG.maxTokens,
    model: CONFIG.model,
    temperature: CONFIG.temperature,
    messages: [
      { 
        role: "user", 
        content: prompt 
      }
    ],
    system: "You are a helpful assistant that generates detailed subtasks for software development tasks. Your subtasks should be specific, actionable, and help accomplish the main task. Format each subtask with a title, description, dependencies, and acceptance criteria."
  });
  
  log('info', "Received response from Claude API!");
  
  // Extract the text content from the response
  const textContent = response.content[0].text;
  
  // Log the first part of the response for debugging
  log('debug', "Response preview:", textContent.substring(0, 200) + "...");
  
  // Parse the subtasks from the text response
  const subtasks = parseSubtasksFromText(textContent, nextSubtaskId, numSubtasks);
  
  return subtasks;
}

//
// Parse subtasks from Claude's text response
//
function parseSubtasksFromText(text, startId, expectedCount) {
  log('info', "Parsing subtasks from Claude's response...");
  
  const subtasks = [];
  
  // Try to extract subtasks using regex patterns
  // Looking for patterns like "Subtask 1: Title" or "Subtask 1 - Title"
  const subtaskRegex = /Subtask\s+(\d+)(?::|-)?\s+([^\n]+)(?:\n|$)(?:Description:?\s*)?([^]*?)(?:(?:\n|^)Dependencies:?\s*([^]*?))?(?:(?:\n|^)Acceptance Criteria:?\s*([^]*?))?(?=(?:\n\s*Subtask\s+\d+|$))/gi;
  
  let match;
  while ((match = subtaskRegex.exec(text)) !== null) {
    const [_, idStr, title, descriptionRaw, dependenciesRaw, acceptanceCriteriaRaw] = match;
    
    // Clean up the description
    let description = descriptionRaw ? descriptionRaw.trim() : '';
    
    // Extract dependencies
    let dependencies = [];
    if (dependenciesRaw) {
      const depText = dependenciesRaw.trim();
      if (depText && !depText.toLowerCase().includes('none')) {
        // Extract numbers from dependencies text
        const depNumbers = depText.match(/\d+/g);
        if (depNumbers) {
          dependencies = depNumbers.map(n => parseInt(n, 10));
        }
      }
    }
    
    // Extract acceptance criteria
    let acceptanceCriteria = acceptanceCriteriaRaw ? acceptanceCriteriaRaw.trim() : '';
    
    // Create the subtask object
    const subtask = {
      id: startId + subtasks.length,
      title: title.trim(),
      description: description,
      status: "pending",
      dependencies: dependencies,
      acceptanceCriteria: acceptanceCriteria
    };
    
    subtasks.push(subtask);
    
    // Break if we've found the expected number of subtasks
    if (subtasks.length >= expectedCount) {
      break;
    }
  }
  
  // If regex parsing failed or didn't find enough subtasks, try a different approach
  if (subtasks.length < expectedCount) {
    log('info', `Regex parsing found only ${subtasks.length} subtasks, trying alternative parsing...`);
    
    // Split by "Subtask X" headers
    const subtaskSections = text.split(/\n\s*Subtask\s+\d+/i);
    
    // Skip the first section (before the first "Subtask X" header)
    for (let i = 1; i < subtaskSections.length && subtasks.length < expectedCount; i++) {
      const section = subtaskSections[i];
      
      // Extract title
      const titleMatch = section.match(/^(?::|-)?\s*([^\n]+)/);
      const title = titleMatch ? titleMatch[1].trim() : `Subtask ${startId + subtasks.length}`;
      
      // Extract description
      let description = '';
      const descMatch = section.match(/Description:?\s*([^]*?)(?:Dependencies|Acceptance Criteria|$)/i);
      if (descMatch) {
        description = descMatch[1].trim();
      } else {
        // If no "Description:" label, use everything until Dependencies or Acceptance Criteria
        const contentMatch = section.match(/^(?::|-)?\s*[^\n]+\n([^]*?)(?:Dependencies|Acceptance Criteria|$)/i);
        if (contentMatch) {
          description = contentMatch[1].trim();
        }
      }
      
      // Extract dependencies
      let dependencies = [];
      const depMatch = section.match(/Dependencies:?\s*([^]*?)(?:Acceptance Criteria|$)/i);
      if (depMatch) {
        const depText = depMatch[1].trim();
        if (depText && !depText.toLowerCase().includes('none')) {
          const depNumbers = depText.match(/\d+/g);
          if (depNumbers) {
            dependencies = depNumbers.map(n => parseInt(n, 10));
          }
        }
      }
      
      // Extract acceptance criteria
      let acceptanceCriteria = '';
      const acMatch = section.match(/Acceptance Criteria:?\s*([^]*?)$/i);
      if (acMatch) {
        acceptanceCriteria = acMatch[1].trim();
      }
      
      // Create the subtask object
      const subtask = {
        id: startId + subtasks.length,
        title: title,
        description: description,
        status: "pending",
        dependencies: dependencies,
        acceptanceCriteria: acceptanceCriteria
      };
      
      subtasks.push(subtask);
    }
  }
  
  // If we still don't have enough subtasks, create generic ones
  if (subtasks.length < expectedCount) {
    log('info', `Parsing found only ${subtasks.length} subtasks, creating generic ones to reach ${expectedCount}...`);
    
    for (let i = subtasks.length; i < expectedCount; i++) {
      subtasks.push({
        id: startId + i,
        title: `Subtask ${startId + i}`,
        description: "Auto-generated subtask. Please update with specific details.",
        status: "pending",
        dependencies: [],
        acceptanceCriteria: ''
      });
    }
  }
  
  log('info', `Successfully parsed ${subtasks.length} subtasks.`);
  return subtasks;
}

// ------------------------------------------
// Main CLI
// ------------------------------------------
(async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const outputDir = path.resolve(process.cwd(), 'tasks');
  // Update tasksPath to be inside the tasks directory
  const tasksPath = path.resolve(outputDir, 'tasks.json');

  const inputArg = (args.find(a => a.startsWith('--input=')) || '').split('=')[1] || 'sample-prd.txt';
  const fromArg = (args.find(a => a.startsWith('--from=')) || '').split('=')[1];
  const promptArg = (args.find(a => a.startsWith('--prompt=')) || '').split('=')[1] || '';
  const idArg = (args.find(a => a.startsWith('--id=')) || '').split('=')[1];
  const statusArg = (args.find(a => a.startsWith('--status=')) || '').split('=')[1] || '';
  const tasksCountArg = (args.find(a => a.startsWith('--tasks=')) || '').split('=')[1];
  const numTasks = tasksCountArg ? parseInt(tasksCountArg, 10) : undefined;
  const subtasksArg = (args.find(a => a.startsWith('--subtasks=')) || '').split('=')[1];
  const numSubtasks = subtasksArg ? parseInt(subtasksArg, 10) : 3; // Default to 3 subtasks if not specified
  const forceFlag = args.includes('--force'); // Check if --force flag is present

  log('info', `Executing command: ${command}`);
  
  // Make sure the tasks directory exists
  if (!fs.existsSync(outputDir)) {
    log('info', `Creating tasks directory: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  switch (command) {
    case 'parse-prd':
      log('info', `Parsing PRD from ${inputArg} to generate tasks.json...`);
      if (numTasks) {
        log('info', `Limiting to ${numTasks} tasks as specified`);
      }
      await parsePRD(inputArg, tasksPath, numTasks);
      break;

    case 'update':
      if (!fromArg) {
        log('error', "Please specify --from=<id>. e.g. node dev.js update --from=3 --prompt='Changes...'");
        process.exit(1);
      }
      log('info', `Updating tasks from ID ${fromArg} based on prompt...`);
      await updateTasks(tasksPath, parseInt(fromArg, 10), promptArg);
      break;

    case 'generate':
      log('info', `Generating individual task files from ${tasksPath} to ${outputDir}...`);
      generateTaskFiles(tasksPath, outputDir);
      break;

    case 'set-status':
      if (!idArg) {
        log('error', "Missing --id=<taskId> argument.");
        process.exit(1);
      }
      if (!statusArg) {
        log('error', "Missing --status=<newStatus> argument (e.g. done, pending, deferred).");
        process.exit(1);
      }
      log('info', `Setting task ${idArg} status to "${statusArg}"...`);
      setTaskStatus(tasksPath, parseInt(idArg, 10), statusArg);
      break;

    case 'list':
      log('info', `Listing tasks from ${tasksPath}...`);
      listTasks(tasksPath);
      break;

    case 'expand':
      if (args.includes('--all')) {
        // Expand all tasks
        log('info', `Expanding all tasks with ${numSubtasks} subtasks each...`);
        await expandAllTasks(tasksPath, numSubtasks, promptArg, forceFlag);
      } else if (idArg) {
        // Expand a specific task
        log('info', `Expanding task ${idArg} with ${numSubtasks} subtasks...`);
        await expandTask(tasksPath, parseInt(idArg, 10), numSubtasks, promptArg);
      } else {
        log('error', "Error: Please specify a task ID with --id=<id> or use --all to expand all tasks.");
        process.exit(1);
      }
      break;

    default:
      log('info', `
Dev.js - Task Management Script

Subcommands:
  1) parse-prd --input=some-prd.txt [--tasks=10]
     -> Creates/overwrites tasks.json with a set of tasks.
     -> Optional --tasks parameter limits the number of tasks generated.

  2) update --from=5 --prompt="We changed from Slack to Discord."
     -> Regenerates tasks from ID >= 5 using the provided prompt.

  3) generate
     -> Generates per-task files (e.g., task_001.txt) from tasks.json

  4) set-status --id=4 --status=done
     -> Updates a single task's status to done (or pending, deferred, etc.).

  5) list
     -> Lists tasks in a brief console view (ID, title, status).
     
  6) expand --id=3 --subtasks=5 [--prompt="Additional context"]
     -> Expands a task with subtasks for more detailed implementation.
     -> Use --all instead of --id to expand all tasks.
     -> Optional --subtasks parameter controls number of subtasks (default: 3).
     -> Add --force when using --all to regenerate subtasks for tasks that already have them.
     -> Note: Tasks marked as 'done' or 'completed' are always skipped.

Usage examples:
  node dev.js parse-prd --input=scripts/prd.txt
  node dev.js parse-prd --input=scripts/prd.txt --tasks=10
  node dev.js update --from=4 --prompt="Refactor tasks from ID 4 onward"
  node dev.js generate
  node dev.js set-status --id=3 --status=done
  node dev.js list
  node dev.js expand --id=3 --subtasks=5
  node dev.js expand --all
  node dev.js expand --all --force
      `);
      break;
  }
})().catch(err => {
  log('error', err);
  process.exit(1);
});