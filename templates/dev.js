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
 *      -> Regenerates tasks from ID >= 5 using the provided prompt.
 *      -> Only updates tasks that aren't marked as 'done'.
 *      -> The --prompt parameter is required and should explain the changes or new context.
 *
 *   3) generate
 *      -> Generates per-task files (e.g., task_001.txt) from tasks.json
 *
 *   4) set-status --id=4 --status=done
 *      -> Updates a single task's status to done (or pending, deferred, in-progress, etc.).
 *      -> Supports comma-separated IDs for updating multiple tasks: --id=1,2,3,1.1,1.2
 *
 *   5) list
 *      -> Lists tasks in a brief console view (ID, title, status).
 *
 *   6) expand --id=3 [--num=5] [--no-research] [--prompt="Additional context"]
 *      -> Expands a task with subtasks for more detailed implementation.
 *      -> Use --all instead of --id to expand all tasks.
 *      -> Optional --num parameter controls number of subtasks (default: 3).
 *      -> Uses Perplexity AI for research-backed subtask generation by default.
 *      -> Use --no-research to disable research-backed generation.
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
 *   node dev.js expand --id=3 --num=5
 *   node dev.js expand --id=3 --no-research
 *   node dev.js expand --all
 *   node dev.js expand --all --force
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import readline from 'readline';
import { program } from 'commander';
import chalk from 'chalk';
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Configure Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Configure OpenAI client for Perplexity
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

// Model configuration
const MODEL = process.env.MODEL || 'claude-3-7-sonnet-20250219';
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || 'sonar-small-online';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '4000');
const TEMPERATURE = parseFloat(process.env.TEMPERATURE || '0.7');

// Set up configuration with environment variables or defaults
const CONFIG = {
  model: MODEL,
  maxTokens: MAX_TOKENS,
  temperature: TEMPERATURE,
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

function readJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(content);
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

// Add a simple loading indicator function
function startLoadingIndicator(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  process.stdout.write(`${message} `);
  
  return setInterval(() => {
    readline.cursorTo(process.stdout, message.length + 1);
    process.stdout.write(frames[i]);
    i = (i + 1) % frames.length;
  }, 80);
}

function stopLoadingIndicator(interval) {
  clearInterval(interval);
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
}

async function callClaude(prdContent, prdPath, numTasks, retryCount = 0) {
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 1000;
  
  log('info', `Starting Claude API call to process PRD from ${prdPath}...`);
  log('debug', `PRD content length: ${prdContent.length} characters`);
  
  // Start loading indicator
  const loadingMessage = `Waiting for Claude to generate tasks${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}...`;
  const loadingIndicator = startLoadingIndicator(loadingMessage);
  
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

  let systemPrompt = "You are a helpful assistant that generates tasks from a PRD using the below json template. You don't worry much about non-task related content, nor do you worry about tasks that don't particularly add value to an mvp. Things like implementing security enhancements, documentation, expansive testing etc are nice to have. The most important is to turn the PRD into a task list that fully materializes the product enough so it can go to market. The JSON template goes as follows -- make sure to only return the json, nothing else: " + TASKS_JSON_TEMPLATE + "ONLY RETURN THE JSON, NOTHING ELSE.";
  
  // Add instruction about the number of tasks if specified
  if (numTasks) {
    systemPrompt += ` Generate exactly ${numTasks} tasks.`;
  } else {
    systemPrompt += " Generate a comprehensive set of tasks that covers all requirements in the PRD.";
  }

  log('debug', "System prompt:", systemPrompt);
  
  try {
    // Calculate appropriate max tokens based on PRD size
    let maxTokens = CONFIG.maxTokens;
    // Rough estimate: 1 token ≈ 4 characters
    const estimatedPrdTokens = Math.ceil(prdContent.length / 4);
    // Ensure we have enough tokens for the response
    if (estimatedPrdTokens > maxTokens / 2) {
      // If PRD is large, increase max tokens if possible
      const suggestedMaxTokens = Math.min(32000, estimatedPrdTokens * 2);
      if (suggestedMaxTokens > maxTokens) {
        log('info', `PRD is large (est. ${estimatedPrdTokens} tokens). Increasing max_tokens to ${suggestedMaxTokens}.`);
        maxTokens = suggestedMaxTokens;
      }
    }
    
    // Always use streaming to avoid "Streaming is strongly recommended" error
    log('info', `Using streaming API for PRD processing...`);
    return await handleStreamingRequest(prdContent, prdPath, numTasks, maxTokens, systemPrompt, loadingIndicator);
    
  } catch (error) {
    // Stop loading indicator
    stopLoadingIndicator(loadingIndicator);
    
    log('error', "Error calling Claude API:", error);
    
    // Implement exponential backoff for retries
    if (retryCount < MAX_RETRIES) {
      const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
      log('info', `Retrying in ${backoffTime/1000} seconds (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      
      // If we have a numTasks parameter and it's greater than 3, try again with fewer tasks
      if (numTasks && numTasks > 3) {
        const reducedTasks = Math.max(3, Math.floor(numTasks * 0.7)); // Reduce by 30%, minimum 3
        log('info', `Retrying with reduced task count: ${reducedTasks} (was ${numTasks})`);
        return callClaude(prdContent, prdPath, reducedTasks, retryCount + 1);
      } else {
        // Otherwise, just retry with the same parameters
        return callClaude(prdContent, prdPath, numTasks, retryCount + 1);
      }
    }
    
    // If we've exhausted all retries, ask the user what to do
    console.log("\nClaude API call failed after multiple attempts.");
    console.log("Options:");
    console.log("1. Retry with the same parameters");
    console.log("2. Retry with fewer tasks (if applicable)");
    console.log("3. Abort");
    
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve, reject) => {
      readline.question('Enter your choice (1-3): ', async (choice) => {
        readline.close();
        
        switch (choice) {
          case '1':
            console.log("Retrying with the same parameters...");
            resolve(await callClaude(prdContent, prdPath, numTasks, 0)); // Reset retry count
            break;
          case '2':
            if (numTasks && numTasks > 2) {
              const reducedTasks = Math.max(2, Math.floor(numTasks * 0.5)); // Reduce by 50%, minimum 2
              console.log(`Retrying with reduced task count: ${reducedTasks} (was ${numTasks})...`);
              resolve(await callClaude(prdContent, prdPath, reducedTasks, 0)); // Reset retry count
            } else {
              console.log("Cannot reduce task count further. Retrying with the same parameters...");
              resolve(await callClaude(prdContent, prdPath, numTasks, 0)); // Reset retry count
            }
            break;
          case '3':
          default:
            console.log("Aborting...");
            reject(new Error("User aborted after multiple failed attempts"));
            break;
        }
      });
    });
  }
}

// Helper function to handle streaming requests to Claude API
async function handleStreamingRequest(prdContent, prdPath, numTasks, maxTokens, systemPrompt, loadingIndicator) {
  log('info', "Sending streaming request to Claude API...");
  
  let fullResponse = '';
  let streamComplete = false;
  let streamError = null;
  let streamingInterval = null; // Initialize streamingInterval here

  try {
    const stream = await anthropic.messages.create({
      max_tokens: maxTokens,
      model: CONFIG.model,
      temperature: CONFIG.temperature,
      messages: [{ role: "user", content: prdContent }],
      system: systemPrompt,
      stream: true
    });
    
    // Update loading indicator to show streaming progress
    let dotCount = 0;
    streamingInterval = setInterval(() => {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Receiving streaming response from Claude${'.'.repeat(dotCount)}`);
      dotCount = (dotCount + 1) % 4;
    }, 500);
    
    // Process the stream
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.text) {
        fullResponse += chunk.delta.text;
      }
    }
    
    clearInterval(streamingInterval);
    streamComplete = true;
    
    // Stop loading indicator
    stopLoadingIndicator(loadingIndicator);
    log('info', "Completed streaming response from Claude API!");
    log('debug', `Streaming response length: ${fullResponse.length} characters`);
    
    return processClaudeResponse(fullResponse, numTasks, 0, prdContent, prdPath);
  } catch (error) {
    if (streamingInterval) clearInterval(streamingInterval); // Safely clear interval
    stopLoadingIndicator(loadingIndicator);
    log('error', "Error during streaming response:", error);
    throw error;
  }
}

// Helper function to process Claude's response text
function processClaudeResponse(textContent, numTasks, retryCount, prdContent, prdPath) {
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
    
    // Check if the response seems incomplete (e.g., missing closing brackets)
    if (!parsedJson.tasks || parsedJson.tasks.length === 0) {
      log('warn', "Parsed JSON has no tasks. Response may be incomplete.");
      
      // If we have a numTasks parameter and it's greater than 5, try again with fewer tasks
      if (numTasks && numTasks > 5 && retryCount < MAX_RETRIES) {
        const reducedTasks = Math.max(5, Math.floor(numTasks * 0.7)); // Reduce by 30%, minimum 5
        log('info', `Retrying with reduced task count: ${reducedTasks} (was ${numTasks})`);
        return callClaude(prdContent, prdPath, reducedTasks, retryCount + 1);
      }
    }
    
    log('info', `Successfully parsed JSON with ${parsedJson.tasks?.length || 0} tasks`);
    return parsedJson;
  } catch (error) {
    log('error', "Failed to parse Claude's response as JSON:", error);
    log('debug', "Raw response:", textContent);
    
    // Check if we should retry with different parameters
    if (retryCount < MAX_RETRIES) {
      // If we have a numTasks parameter, try again with fewer tasks
      if (numTasks && numTasks > 3) {
        const reducedTasks = Math.max(3, Math.floor(numTasks * 0.6)); // Reduce by 40%, minimum 3
        log('info', `Retrying with reduced task count: ${reducedTasks} (was ${numTasks})`);
        return callClaude(prdContent, prdPath, reducedTasks, retryCount + 1);
      } else {
        // Otherwise, just retry with the same parameters
        log('info', `Retrying Claude API call (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        return callClaude(prdContent, prdPath, numTasks, retryCount + 1);
      }
    }
    
    throw new Error("Failed to parse Claude's response as JSON after multiple attempts. See console for details.");
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
  
  try {
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
  } catch (error) {
    log('error', "Failed to generate tasks:", error.message);
    process.exit(1);
  }
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

  const tasksToUpdate = data.tasks.filter(task => task.id >= fromId && task.status !== "done");
  
  const systemPrompt = "You are a helpful assistant that updates tasks based on provided insights. Return only the updated tasks as a JSON array.";
  const userPrompt = `Update these tasks based on the following insight: ${prompt}\nTasks: ${JSON.stringify(tasksToUpdate, null, 2)}`;
  
  // Start loading indicator
  const loadingIndicator = startLoadingIndicator("Waiting for Claude to update tasks...");
  
  let fullResponse = '';
  let streamingInterval = null;

  try {
    const stream = await anthropic.messages.create({
      max_tokens: CONFIG.maxTokens,
      model: CONFIG.model,
      temperature: CONFIG.temperature,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
      stream: true
    });
    
    // Update loading indicator to show streaming progress
    let dotCount = 0;
    streamingInterval = setInterval(() => {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Receiving streaming response from Claude${'.'.repeat(dotCount)}`);
      dotCount = (dotCount + 1) % 4;
    }, 500);
    
    // Process the stream
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.text) {
        fullResponse += chunk.delta.text;
      }
    }
    
    clearInterval(streamingInterval);
    stopLoadingIndicator(loadingIndicator);
    
    log('info', "Completed streaming response from Claude API!");
    log('debug', `Streaming response length: ${fullResponse.length} characters`);

    try {
      const updatedTasks = JSON.parse(fullResponse);
      
      data.tasks = data.tasks.map(task => {
        const updatedTask = updatedTasks.find(t => t.id === task.id);
        return updatedTask || task;
      });

      writeJSON(tasksPath, data);
      log('info', "Tasks updated successfully.");
    } catch (parseError) {
      log('error', "Failed to parse Claude's response as JSON:", parseError);
      log('debug', "Response content:", fullResponse);
      process.exit(1);
    }
  } catch (error) {
    if (streamingInterval) clearInterval(streamingInterval);
    stopLoadingIndicator(loadingIndicator);
    log('error', "Error during streaming response:", error);
    process.exit(1);
  }
}

//
// 3) generate
//
function generateTaskFiles(tasksPath, outputDir) {
  log('info', `Reading tasks from ${tasksPath}...`);
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks to generate files for.");
    process.exit(1);
  }
  
  log('info', `Found ${data.tasks.length} tasks to generate files for.`);
  
  // The outputDir is now the same directory as tasksPath, so we don't need to check if it exists
  // since we already did that in the main function
  
  log('info', "Generating individual task files...");
  data.tasks.forEach(task => {
    const filename = `task_${String(task.id).padStart(3, '0')}.txt`;
    const filepath = path.join(outputDir, filename);

    // Create the base content
    const contentParts = [
      `# Task ID: ${task.id}`,
      `# Title: ${task.title}`,
      `# Status: ${task.status}`,
      `# Dependencies: ${task.dependencies.join(", ")}`,
      `# Priority: ${task.priority}`,
      `# Description: ${task.description}`,
      `# Details:\n${task.details}\n`,
      `# Test Strategy:`,
      `${task.testStrategy}\n`
    ];
    
    // Add subtasks if they exist
    if (task.subtasks && task.subtasks.length > 0) {
      contentParts.push(`# Subtasks:`);
      task.subtasks.forEach(subtask => {
        contentParts.push(`## Subtask ID: ${subtask.id}`);
        contentParts.push(`## Title: ${subtask.title}`);
        contentParts.push(`## Status: ${subtask.status}`);
        contentParts.push(`## Dependencies: ${subtask.dependencies ? subtask.dependencies.join(", ") : ""}`);
        contentParts.push(`## Description: ${subtask.description}`);
        if (subtask.acceptanceCriteria) {
          contentParts.push(`## Acceptance Criteria:\n${subtask.acceptanceCriteria}\n`);
        }
      });
    }

    const content = contentParts.join('\n');
    fs.writeFileSync(filepath, content, 'utf8');
    log('info', `Generated: ${filename}`);
  });

  log('info', `All ${data.tasks.length} tasks have been generated into '${outputDir}'.`);
}

//
// 4) set-status
//
function setTaskStatus(tasksPath, taskIdInput, newStatus) {
  // Validate inputs
  if (!taskIdInput || !newStatus) {
    log('error', 'Task ID and new status are required');
    process.exit(1);
  }

  // Read fresh data for each status update
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', 'No valid tasks found in tasks.json');
    process.exit(1);
  }

  // Handle multiple task IDs (comma-separated)
  if (typeof taskIdInput === 'string' && taskIdInput.includes(',')) {
    const taskIds = taskIdInput.split(',').map(id => id.trim());
    log('info', `Processing multiple task IDs: ${taskIds.join(', ')}`);
    
    // Process each task ID individually
    taskIds.forEach(id => {
      setTaskStatus(tasksPath, id, newStatus);
    });
    return;
  }

  // Handle subtask IDs (e.g., "1.1")
  if (String(taskIdInput).includes('.')) {
    const [parentIdStr, subtaskIdStr] = String(taskIdInput).split('.');
    const parentId = parseInt(parentIdStr, 10);
    const subtaskId = parseInt(subtaskIdStr, 10);

    if (isNaN(parentId) || isNaN(subtaskId)) {
      log('error', `Invalid subtask ID format: ${taskIdInput}`);
      process.exit(1);
    }

    // Find the parent task
    const parentTask = data.tasks.find(t => t.id === parentId);
    if (!parentTask) {
      log('error', `Parent task ${parentId} not found`);
      process.exit(1);
    }

    // Ensure subtasks array exists
    if (!parentTask.subtasks || !Array.isArray(parentTask.subtasks)) {
      log('error', `Parent task ${parentId} has no subtasks array`);
      process.exit(1);
    }

    // Find and update the subtask
    const subtask = parentTask.subtasks.find(st => st.id === subtaskId);
    if (!subtask) {
      log('error', `Subtask ${subtaskId} not found in task ${parentId}`);
      process.exit(1);
    }

    // Update the subtask status
    const oldStatus = subtask.status || 'pending';
    subtask.status = newStatus;
    
    // Save the changes
    writeJSON(tasksPath, data);
    log('info', `Updated subtask ${parentId}.${subtaskId} status from '${oldStatus}' to '${newStatus}'`);
    
    return;
  }

  // Handle regular task ID
  const taskId = parseInt(String(taskIdInput), 10);
  if (isNaN(taskId)) {
    log('error', `Invalid task ID: ${taskIdInput}`);
    process.exit(1);
  }

  // Find the task
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) {
    log('error', `Task ${taskId} not found`);
    process.exit(1);
  }

  // Update the task status
  const oldStatus = task.status || 'pending';
  task.status = newStatus;
  
  // Save the changes
  writeJSON(tasksPath, data);
  log('info', `Updated task ${taskId} status from '${oldStatus}' to '${newStatus}'`);
}

//
// 5) list tasks
//
function listTasks(tasksPath, statusFilter, withSubtasks = false) {
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks found.");
    process.exit(1);
  }

  log('info', `Tasks in ${tasksPath}:`);
  
  // Filter tasks by status if a filter is provided
  const filteredTasks = statusFilter 
    ? data.tasks.filter(t => t.status === statusFilter)
    : data.tasks;
  
  filteredTasks.forEach(t => {
    log('info', `- ID=${t.id}, [${t.status}] ${t.title}`);
    
    // Display subtasks if requested and they exist
    if (withSubtasks && t.subtasks && t.subtasks.length > 0) {
      t.subtasks.forEach(st => {
        log('info', `  └─ ID=${t.id}.${st.id}, [${st.status || 'pending'}] ${st.title}`);
      });
    }
  });
  
  // If no tasks match the filter, show a message
  if (filteredTasks.length === 0) {
    log('info', `No tasks found${statusFilter ? ` with status '${statusFilter}'` : ''}.`);
  }
}

//
// 6) expand task with subtasks
//
/**
 * Expand a task by generating subtasks
 * @param {string} taskId - The ID of the task to expand
 * @param {number} numSubtasks - The number of subtasks to generate
 * @param {boolean} useResearch - Whether to use Perplexity for research-backed subtask generation
 * @returns {Promise<void>}
 */
async function expandTask(taskId, numSubtasks = CONFIG.defaultSubtasks, useResearch = false, additionalContext = '') {
  try {
    // Get the tasks
    const tasksData = readJSON(path.join(process.cwd(), 'tasks', 'tasks.json'));
    const task = tasksData.tasks.find(t => t.id === parseInt(taskId));
    
    if (!task) {
      console.error(chalk.red(`Task with ID ${taskId} not found.`));
      return;
    }
    
    // Check if the task is already completed
    if (task.status === 'completed' || task.status === 'done') {
      console.log(chalk.yellow(`Task ${taskId} is already completed. Skipping expansion.`));
      return;
    }
    
    // Initialize subtasks array if it doesn't exist
    if (!task.subtasks) {
      task.subtasks = [];
    }
    
    // Calculate the next subtask ID
    const nextSubtaskId = task.subtasks.length > 0 
      ? Math.max(...task.subtasks.map(st => st.id)) + 1 
      : 1;
    
    // Generate subtasks
    let subtasks;
    if (useResearch) {
      console.log(chalk.blue(`Using Perplexity AI for research-backed subtask generation...`));
      subtasks = await generateSubtasksWithPerplexity(task, numSubtasks, nextSubtaskId, additionalContext);
    } else {
      subtasks = await generateSubtasks(task, numSubtasks, nextSubtaskId, additionalContext);
    }
    
    // Add the subtasks to the task
    task.subtasks = [...task.subtasks, ...subtasks];
    
    // Save the updated tasks
    fs.writeFileSync(
      path.join(process.cwd(), 'tasks', 'tasks.json'),
      JSON.stringify(tasksData, null, 2)
    );
    
    console.log(chalk.green(`Added ${subtasks.length} subtasks to task ${taskId}.`));
    
    // Log the added subtasks
    subtasks.forEach(st => {
      console.log(chalk.cyan(`  ${st.id}. ${st.title}`));
      console.log(chalk.gray(`     ${st.description.substring(0, 100)}${st.description.length > 100 ? '...' : ''}`));
    });
  } catch (error) {
    console.error(chalk.red('Error expanding task:'), error);
  }
}

/**
 * Expand all tasks that are not completed
 * @param {number} numSubtasks - The number of subtasks to generate for each task
 * @param {boolean} useResearch - Whether to use Perplexity for research-backed subtask generation
 * @returns {Promise<number>} - The number of tasks expanded
 */
async function expandAllTasks(numSubtasks = CONFIG.defaultSubtasks, useResearch = false, additionalContext = '', forceFlag = false) {
  try {
    // Get the tasks
    const tasksData = readJSON(path.join(process.cwd(), 'tasks', 'tasks.json'));
    
    if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks)) {
      console.error(chalk.red('No valid tasks found.'));
      return 0;
    }
    
    // Filter tasks that are not completed
    const tasksToExpand = tasksData.tasks.filter(task => 
      task.status !== 'completed' && task.status !== 'done'
    );
    
    if (tasksToExpand.length === 0) {
      console.log(chalk.yellow('No tasks to expand. All tasks are already completed.'));
      return 0;
    }
    
    console.log(chalk.blue(`Expanding ${tasksToExpand.length} tasks with ${numSubtasks} subtasks each...`));
    
    let tasksExpanded = 0;
    
    // Expand each task
    for (const task of tasksToExpand) {
      console.log(chalk.blue(`\nExpanding task ${task.id}: ${task.title}`));
      await expandTask(task.id, numSubtasks, useResearch, additionalContext);
      tasksExpanded++;
    }
    
    console.log(chalk.green(`\nExpanded ${tasksExpanded} tasks with ${numSubtasks} subtasks each.`));
    return tasksExpanded;
  } catch (error) {
    console.error(chalk.red('Error expanding all tasks:'), error);
    return 0;
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
  
  // Start loading indicator
  const loadingIndicator = startLoadingIndicator("Waiting for Claude to generate subtasks...");
  
  let fullResponse = '';
  let streamingInterval = null;

  try {
    const stream = await anthropic.messages.create({
      max_tokens: CONFIG.maxTokens,
      model: CONFIG.model,
      temperature: CONFIG.temperature,
      messages: [
        { 
          role: "user", 
          content: prompt 
        }
      ],
      system: "You are a helpful assistant that generates detailed subtasks for software development tasks. Your subtasks should be specific, actionable, and help accomplish the main task. Format each subtask with a title, description, dependencies, and acceptance criteria.",
      stream: true
    });
    
    // Update loading indicator to show streaming progress
    let dotCount = 0;
    streamingInterval = setInterval(() => {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Receiving streaming response from Claude${'.'.repeat(dotCount)}`);
      dotCount = (dotCount + 1) % 4;
    }, 500);
    
    // Process the stream
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.text) {
        fullResponse += chunk.delta.text;
      }
    }
    
    clearInterval(streamingInterval);
    
    // Stop loading indicator
    stopLoadingIndicator(loadingIndicator);
    log('info', "Received complete response from Claude API!");
    
    // Log the first part of the response for debugging
    log('debug', "Response preview:", fullResponse.substring(0, 200) + "...");
    
    // Parse the subtasks from the text response
    const subtasks = parseSubtasksFromText(fullResponse, nextSubtaskId, numSubtasks);
    
    return subtasks;
  } catch (error) {
    if (streamingInterval) clearInterval(streamingInterval);
    stopLoadingIndicator(loadingIndicator);
    log('error', "Error during streaming response:", error);
    throw error;
  }
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

/**
 * Generate subtasks for a task using Perplexity AI with research capabilities
 * @param {Object} task - The task to generate subtasks for
 * @param {number} numSubtasks - The number of subtasks to generate
 * @param {number} nextSubtaskId - The ID to start assigning to subtasks
 * @returns {Promise<Array>} - The generated subtasks
 */
async function generateSubtasksWithPerplexity(task, numSubtasks = 3, nextSubtaskId = 1, additionalContext = '') {
  const { title, description, details = '', subtasks = [] } = task;
  
  console.log(chalk.blue(`Generating ${numSubtasks} subtasks for task: ${title}`));
  if (subtasks.length > 0) {
    console.log(chalk.yellow(`Task already has ${subtasks.length} subtasks. Adding ${numSubtasks} more.`));
  }

  // Get the tasks.json content for context
  let tasksData = {};
  try {
    tasksData = readJSON(path.join(process.cwd(), 'tasks', 'tasks.json'));
  } catch (error) {
    console.log(chalk.yellow('Could not read tasks.json for context. Proceeding without it.'));
  }

  // Get the PRD content for context if available
  let prdContent = '';
  if (tasksData.meta && tasksData.meta.source) {
    try {
      prdContent = fs.readFileSync(path.join(process.cwd(), tasksData.meta.source), 'utf8');
      console.log(chalk.green(`Successfully loaded PRD from ${tasksData.meta.source} (${prdContent.length} characters)`));
    } catch (error) {
      console.log(chalk.yellow(`Could not read PRD at ${tasksData.meta.source}. Proceeding without it.`));
    }
  }

  // Get the specific task file for more detailed context if available
  let taskFileContent = '';
  try {
    const taskFileName = `task_${String(task.id).padStart(3, '0')}.txt`;
    const taskFilePath = path.join(process.cwd(), 'tasks', taskFileName);
    if (fs.existsSync(taskFilePath)) {
      taskFileContent = fs.readFileSync(taskFilePath, 'utf8');
      console.log(chalk.green(`Successfully loaded task file ${taskFileName} for additional context`));
    }
  } catch (error) {
    console.log(chalk.yellow(`Could not read task file for task ${task.id}. Proceeding without it.`));
  }

  // Get dependency task details for better context
  let dependencyDetails = '';
  if (task.dependencies && task.dependencies.length > 0) {
    dependencyDetails = 'Dependency Tasks:\n';
    for (const depId of task.dependencies) {
      const depTask = tasksData.tasks.find(t => t.id === depId);
      if (depTask) {
        dependencyDetails += `Task ${depId}: ${depTask.title}\n`;
        dependencyDetails += `Description: ${depTask.description}\n`;
        if (depTask.details) {
          dependencyDetails += `Details: ${depTask.details.substring(0, 200)}${depTask.details.length > 200 ? '...' : ''}\n`;
        }
        dependencyDetails += '\n';
      }
    }
  }

  // Extract project metadata for context
  const projectContext = tasksData.meta ? 
    `Project: ${tasksData.meta.projectName || 'Unknown'}
Version: ${tasksData.meta.version || '1.0.0'}
Description: ${tasksData.meta.description || 'No description available'}` : '';

  // Construct the prompt for Perplexity/Anthropic with enhanced context
  const prompt = `I need to break down the following task into ${numSubtasks} detailed subtasks for a software development project.

${projectContext}

CURRENT TASK:
Task ID: ${task.id}
Task Title: ${title}
Task Description: ${description}
Priority: ${task.priority || 'medium'}
Additional Details: ${details}
${additionalContext ? `\nADDITIONAL CONTEXT PROVIDED BY USER:\n${additionalContext}` : ''}

${taskFileContent ? `DETAILED TASK INFORMATION:
${taskFileContent}` : ''}

${dependencyDetails ? dependencyDetails : ''}

${subtasks.length > 0 ? `Existing Subtasks:
${subtasks.map(st => `- ${st.title}: ${st.description}`).join('\n')}` : ''}

${prdContent ? `PRODUCT REQUIREMENTS DOCUMENT:
${prdContent}` : ''}

${tasksData.tasks ? `PROJECT CONTEXT - OTHER RELATED TASKS:
${JSON.stringify(
  tasksData.tasks
    .filter(t => t.id !== task.id)
    // Prioritize tasks that are dependencies or depend on this task
    .sort((a, b) => {
      const aIsRelated = task.dependencies?.includes(a.id) || a.dependencies?.includes(task.id);
      const bIsRelated = task.dependencies?.includes(b.id) || b.dependencies?.includes(task.id);
      return bIsRelated - aIsRelated;
    })
    .slice(0, 5) // Limit to 5 most relevant tasks to avoid context overload
    .map(t => ({ 
      id: t.id, 
      title: t.title, 
      description: t.description,
      status: t.status,
      dependencies: t.dependencies
    })), 
  null, 2
)}` : ''}

Please generate ${numSubtasks} subtasks that are:
1. Specific and actionable
2. Relevant to the current technology stack and project requirements
3. Properly sequenced with clear dependencies
4. Detailed enough to be implemented without further clarification

For each subtask, provide:
1. A clear, concise title
2. A detailed description explaining what needs to be done
3. Dependencies (if any) - list the IDs of tasks this subtask depends on
4. Acceptance criteria - specific conditions that must be met for the subtask to be considered complete

Format each subtask as follows:

Subtask 1: [Title]
Description: [Detailed description]
Dependencies: [List of task IDs, or "None" if no dependencies]
Acceptance Criteria: [List of criteria]

Subtask 2: [Title]
...

Research the task thoroughly and ensure the subtasks are comprehensive, specific, and actionable. Focus on technical implementation details rather than generic steps.`;

  // Start loading indicator
  const loadingInterval = startLoadingIndicator('Researching and generating subtasks with AI');

  try {
    let responseText;
    
    try {
      // Try to use Perplexity first
      console.log(chalk.blue('Using Perplexity AI for research-backed subtask generation...'));
      const result = await perplexity.chat.completions.create({
        model: PERPLEXITY_MODEL,
        messages: [{
          role: "user",
          content: prompt
        }],
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
      });
      
      // Extract the response text
      responseText = result.choices[0].message.content;
      console.log(chalk.green('Successfully generated subtasks with Perplexity AI'));
    } catch (perplexityError) {
      console.log(chalk.yellow('Falling back to Anthropic for subtask generation...'));
      console.log(chalk.gray('Perplexity error:'), perplexityError.message);
      
      // Use Anthropic as fallback
      const stream = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: "You are an expert software developer and project manager. Your task is to break down software development tasks into detailed subtasks that are specific, actionable, and technically relevant.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        stream: true
      });
      
      // Process the stream
      responseText = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.text) {
          responseText += chunk.delta.text;
        }
      }
      
      console.log(chalk.green('Successfully generated subtasks with Anthropic AI'));
    }

    // Stop loading indicator
    stopLoadingIndicator(loadingInterval);
    
    if (CONFIG.debug) {
      console.log(chalk.gray('AI Response:'));
      console.log(chalk.gray(responseText));
    }
    
    // Parse the subtasks from the response text
    const subtasks = parseSubtasksFromText(responseText, nextSubtaskId, numSubtasks);
    return subtasks;
  } catch (error) {
    stopLoadingIndicator(loadingInterval);
    console.error(chalk.red('Error generating subtasks:'), error);
    throw error;
  }
}

// ------------------------------------------
// Main CLI
// ------------------------------------------
async function main() {
  program
    .name('dev')
    .description('AI-driven development task management')
    .version('1.3.1');

  program
    .command('parse-prd')
    .description('Parse a PRD file and generate tasks')
    .argument('<file>', 'Path to the PRD file')
    .option('-o, --output <file>', 'Output file path', 'tasks/tasks.json')
    .option('-n, --num-tasks <number>', 'Number of tasks to generate', '10')
    .action(async (file, options) => {
      const numTasks = parseInt(options.numTasks, 10);
      const outputPath = options.output;
      
      console.log(chalk.blue(`Parsing PRD file: ${file}`));
      console.log(chalk.blue(`Generating ${numTasks} tasks...`));
      
      await parsePRD(file, outputPath, numTasks);
    });

  program
    .command('update')
    .description('Update tasks based on new information or implementation changes')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('--from <id>', 'Task ID to start updating from (tasks with ID >= this value will be updated)', '1')
    .option('-p, --prompt <text>', 'Prompt explaining the changes or new context (required)')
    .action(async (options) => {
      const tasksPath = options.file;
      const fromId = parseInt(options.from, 10);
      const prompt = options.prompt;
      
      if (!prompt) {
        console.error(chalk.red('Error: --prompt parameter is required. Please provide information about the changes.'));
        process.exit(1);
      }
      
      console.log(chalk.blue(`Updating tasks from ID >= ${fromId} with prompt: "${prompt}"`));
      console.log(chalk.blue(`Tasks file: ${tasksPath}`));
      
      await updateTasks(tasksPath, fromId, prompt);
    });

  program
    .command('generate')
    .description('Generate task files from tasks.json')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('-o, --output <dir>', 'Output directory', 'tasks')
    .action(async (options) => {
      const tasksPath = options.file;
      const outputDir = options.output;
      
      console.log(chalk.blue(`Generating task files from: ${tasksPath}`));
      console.log(chalk.blue(`Output directory: ${outputDir}`));
      
      await generateTaskFiles(tasksPath, outputDir);
    });

  program
    .command('set-status')
    .description('Set the status of a task')
    .option('-i, --id <id>', 'Task ID (can be comma-separated for multiple tasks)')
    .option('-s, --status <status>', 'New status (todo, in-progress, review, done)')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .action(async (options) => {
      const tasksPath = options.file;
      const taskId = options.id;
      const status = options.status;
      
      if (!taskId || !status) {
        console.error(chalk.red('Error: Both --id and --status are required'));
        process.exit(1);
      }
      
      console.log(chalk.blue(`Setting status of task(s) ${taskId} to: ${status}`));
      
      await setTaskStatus(tasksPath, taskId, status);
    });

  program
    .command('list')
    .description('List all tasks')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('-s, --status <status>', 'Filter by status')
    .option('--with-subtasks', 'Show subtasks for each task')
    .action(async (options) => {
      const tasksPath = options.file;
      const statusFilter = options.status;
      const withSubtasks = options.withSubtasks || false;
      
      console.log(chalk.blue(`Listing tasks from: ${tasksPath}`));
      if (statusFilter) {
        console.log(chalk.blue(`Filtering by status: ${statusFilter}`));
      }
      if (withSubtasks) {
        console.log(chalk.blue('Including subtasks in listing'));
      }
      
      await listTasks(tasksPath, statusFilter, withSubtasks);
    });

  program
    .command('expand')
    .description('Expand tasks with subtasks')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('-i, --id <id>', 'Task ID to expand')
    .option('-a, --all', 'Expand all tasks')
    .option('-n, --num <number>', 'Number of subtasks to generate', CONFIG.defaultSubtasks.toString())
    .option('-r, --no-research', 'Disable Perplexity AI for research-backed subtask generation')
    .option('-p, --prompt <text>', 'Additional context to guide subtask generation')
    .option('--force', 'Force regeneration of subtasks for tasks that already have them')
    .action(async (options) => {
      const tasksPath = options.file;
      const idArg = options.id ? parseInt(options.id, 10) : null;
      const allFlag = options.all;
      const numSubtasks = parseInt(options.num, 10);
      const forceFlag = options.force;
      const useResearch = options.research !== false; // Default to true unless explicitly disabled
      const additionalContext = options.prompt || '';
      
      if (allFlag) {
        console.log(chalk.blue(`Expanding all tasks with ${numSubtasks} subtasks each...`));
        if (useResearch) {
          console.log(chalk.blue('Using Perplexity AI for research-backed subtask generation'));
        } else {
          console.log(chalk.yellow('Research-backed subtask generation disabled'));
        }
        if (additionalContext) {
          console.log(chalk.blue(`Additional context: "${additionalContext}"`));
        }
        await expandAllTasks(numSubtasks, useResearch, additionalContext, forceFlag);
      } else if (idArg) {
        console.log(chalk.blue(`Expanding task ${idArg} with ${numSubtasks} subtasks...`));
        if (useResearch) {
          console.log(chalk.blue('Using Perplexity AI for research-backed subtask generation'));
        } else {
          console.log(chalk.yellow('Research-backed subtask generation disabled'));
        }
        if (additionalContext) {
          console.log(chalk.blue(`Additional context: "${additionalContext}"`));
        }
        await expandTask(idArg, numSubtasks, useResearch, additionalContext);
      } else {
        console.error(chalk.red('Error: Please specify a task ID with --id=<id> or use --all to expand all tasks.'));
      }
    });

  await program.parseAsync(process.argv);
}

main().catch(err => {
  log('error', err);
  process.exit(1);
});