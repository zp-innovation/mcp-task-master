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
 *      -> If you set the status of a parent task to done, all its subtasks will be set to done.
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
 *      -> If a complexity report exists for the specified task, its recommended 
 *         subtask count and expansion prompt will be used (unless overridden).
 *
 *   7) analyze-complexity [options]
 *      -> Analyzes task complexity and generates expansion recommendations
 *      -> Generates a report in scripts/task-complexity-report.json by default 
 *      -> Uses configured LLM to assess task complexity and create tailored expansion prompts
 *      -> Can use Perplexity AI for research-backed analysis with --research flag
 *      -> Each task includes:
 *         - Complexity score (1-10)
 *         - Recommended number of subtasks (based on DEFAULT_SUBTASKS config)
 *         - Detailed expansion prompt
 *         - Reasoning for complexity assessment
 *         - Ready-to-run expansion command
 *      -> Options:
 *         --output, -o <file>: Specify output file path (default: 'scripts/task-complexity-report.json')
 *         --model, -m <model>: Override LLM model to use for analysis
 *         --threshold, -t <number>: Set minimum complexity score (1-10) for expansion recommendation (default: 5)
 *         --file, -f <path>: Use alternative tasks.json file instead of default
 *         --research, -r: Use Perplexity AI for research-backed complexity analysis
 *
 *   8) clear-subtasks
 *      -> Clears subtasks from specified tasks
 *      -> Supports comma-separated IDs for clearing multiple tasks: --id=1,2,3,1.1,1.2
 *      -> Use --all to clear subtasks from all tasks
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
 *   node dev.js analyze-complexity
 *   node dev.js analyze-complexity --output=custom-report.json
 *   node dev.js analyze-complexity --threshold=6 --model=claude-3.7-sonnet
 *   node dev.js analyze-complexity --research
 *   node dev.js clear-subtasks --id=1,2,3 --all
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
      
      // Add call to generate task files
      log('info', "Regenerating task files...");
      await generateTaskFiles(tasksPath, path.dirname(tasksPath));
      
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
    
    // Add call to generate task files
    log('info', "Regenerating task files...");
    generateTaskFiles(tasksPath, path.dirname(tasksPath));
    
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
  
  // Automatically update subtasks if the parent task is being marked as done
  if (newStatus === 'done' && task.subtasks && Array.isArray(task.subtasks) && task.subtasks.length > 0) {
    log('info', `Task ${taskId} has ${task.subtasks.length} subtasks that will be marked as done too.`);
    
    task.subtasks.forEach(subtask => {
      const oldSubtaskStatus = subtask.status || 'pending';
      subtask.status = newStatus;
      log('info', `  └─ Updated subtask ${taskId}.${subtask.id} status from '${oldSubtaskStatus}' to '${newStatus}'`);
    });
  }
  
  // Save the changes
  writeJSON(tasksPath, data);
  log('info', `Updated task ${taskId} status from '${oldStatus}' to '${newStatus}'`);
  
  // Add call to generate task files
  log('info', "Regenerating task files...");
  generateTaskFiles(tasksPath, path.dirname(tasksPath));
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
    
    // Check for complexity report
    const complexityReport = readComplexityReport();
    let recommendedSubtasks = numSubtasks;
    let recommendedPrompt = additionalContext;
    
    // If report exists and has data for this task, use it
    if (complexityReport) {
      const taskAnalysis = findTaskInComplexityReport(complexityReport, parseInt(taskId));
      if (taskAnalysis) {
        // Only use report values if not explicitly overridden by command line
        if (numSubtasks === CONFIG.defaultSubtasks && taskAnalysis.recommendedSubtasks) {
          recommendedSubtasks = taskAnalysis.recommendedSubtasks;
          console.log(chalk.blue(`Using recommended subtask count from complexity analysis: ${recommendedSubtasks}`));
        }
        
        if (!additionalContext && taskAnalysis.expansionPrompt) {
          recommendedPrompt = taskAnalysis.expansionPrompt;
          console.log(chalk.blue(`Using recommended prompt from complexity analysis`));
          console.log(chalk.gray(`Prompt: ${recommendedPrompt.substring(0, 100)}...`));
        }
      }
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
      subtasks = await generateSubtasksWithPerplexity(task, recommendedSubtasks, nextSubtaskId, recommendedPrompt);
    } else {
      subtasks = await generateSubtasks(task, recommendedSubtasks, nextSubtaskId, recommendedPrompt);
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
    
    // Generate task files to update the task file with the new subtasks
    console.log(chalk.blue(`Regenerating task files to include new subtasks...`));
    await generateTaskFiles('tasks/tasks.json', 'tasks');
    
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
    let tasksToExpand = tasksData.tasks.filter(task => 
      task.status !== 'completed' && task.status !== 'done'
    );
    
    if (tasksToExpand.length === 0) {
      console.log(chalk.yellow('No tasks to expand. All tasks are already completed.'));
      return 0;
    }
    
    // Check for complexity report
    const complexityReport = readComplexityReport();
    let usedComplexityReport = false;
    
    // If complexity report exists, sort tasks by complexity
    if (complexityReport && complexityReport.complexityAnalysis) {
      console.log(chalk.blue('Found complexity report. Prioritizing tasks by complexity score.'));
      usedComplexityReport = true;
      
      // Create a map of task IDs to their complexity scores
      const complexityMap = new Map();
      complexityReport.complexityAnalysis.forEach(analysis => {
        complexityMap.set(analysis.taskId, analysis.complexityScore);
      });
      
      // Sort tasks by complexity score (highest first)
      tasksToExpand.sort((a, b) => {
        const scoreA = complexityMap.get(a.id) || 0;
        const scoreB = complexityMap.get(b.id) || 0;
        return scoreB - scoreA;
      });
      
      // Log the sorted tasks
      console.log(chalk.blue('Tasks will be expanded in this order (by complexity):'));
      tasksToExpand.forEach(task => {
        const score = complexityMap.get(task.id) || 'N/A';
        console.log(chalk.blue(`  Task ${task.id}: ${task.title} (Complexity: ${score})`));
      });
    }
    
    console.log(chalk.blue(`\nExpanding ${tasksToExpand.length} tasks...`));
    
    let tasksExpanded = 0;
    // Keep track of expanded tasks and their results for verification
    const expandedTaskIds = [];
    
    // Expand each task
    for (const task of tasksToExpand) {
      console.log(chalk.blue(`\nExpanding task ${task.id}: ${task.title}`));
      
      // The check for usedComplexityReport is redundant since expandTask will handle it anyway
      await expandTask(task.id, numSubtasks, useResearch, additionalContext);
      expandedTaskIds.push(task.id);
      
      tasksExpanded++;
    }
    
    // Verification step - Check for dummy/generic subtasks
    // Read fresh data after all expansions
    const updatedTasksData = readJSON(path.join(process.cwd(), 'tasks', 'tasks.json'));
    const tasksNeedingRetry = [];
    
    console.log(chalk.blue('\nVerifying subtask quality...'));
    
    for (const taskId of expandedTaskIds) {
      const task = updatedTasksData.tasks.find(t => t.id === taskId);
      if (!task || !task.subtasks || task.subtasks.length === 0) continue;
      
      // Check for generic subtasks - patterns to look for:
      // 1. Auto-generated subtask in description
      // 2. Generic titles like "Subtask X"
      // 3. Common dummy titles we created like "Implementation" without custom descriptions
      const dummySubtasks = task.subtasks.filter(st => 
        st.description.includes("Auto-generated subtask") ||
        st.title.match(/^Subtask \d+$/) ||
        (st.description.includes("Update this auto-generated subtask") && 
         ["Implementation", "Testing", "Documentation", "Integration", "Error Handling", 
          "Refactoring", "Validation", "Configuration"].includes(st.title))
      );
      
      // If more than half the subtasks are generic, mark for retry
      if (dummySubtasks.length > Math.floor(task.subtasks.length / 2)) {
        tasksNeedingRetry.push({
          id: task.id,
          title: task.title,
          dummyCount: dummySubtasks.length,
          totalCount: task.subtasks.length
        });
      }
    }
    
    // If we found tasks with poor subtask quality, offer to retry them
    if (tasksNeedingRetry.length > 0) {
      console.log(chalk.yellow(`\nFound ${tasksNeedingRetry.length} tasks with low-quality subtasks that need retry:`));
      
      for (const task of tasksNeedingRetry) {
        console.log(chalk.yellow(`  Task ${task.id}: ${task.title} (${task.dummyCount}/${task.totalCount} generic subtasks)`));
      }
      
      // Ask user if they want to retry these tasks
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question(chalk.cyan('\nWould you like to retry expanding these tasks with enhanced prompts? (y/n): '), resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        console.log(chalk.blue('\nRetrying task expansion with enhanced prompts...'));
        
        // For each task needing retry, we'll expand it again with a modified prompt
        let retryCount = 0;
        for (const task of tasksNeedingRetry) {
          console.log(chalk.blue(`\nRetrying expansion for task ${task.id}...`));
          
          // Enhanced context to encourage better subtask generation
          const enhancedContext = `${additionalContext ? additionalContext + "\n\n" : ""}
IMPORTANT: The previous expansion attempt generated mostly generic subtasks. Please provide highly specific, 
detailed, and technically relevant subtasks for this task. Each subtask should be:
1. Specifically related to the task at hand, not generic
2. Technically detailed with clear implementation guidance
3. Unique and addressing a distinct aspect of the parent task
          
Be creative and thorough in your analysis. The subtasks should collectively represent a complete solution to the parent task.`;
          
          // Try with different settings - if research was off, turn it on, or increase subtasks slightly
          const retryResearch = useResearch ? true : !useResearch; // Try opposite of current setting, but prefer ON
          const retrySubtasks = numSubtasks < 6 ? numSubtasks + 1 : numSubtasks; // Increase subtasks slightly if not already high
          
          // Delete existing subtasks for this task before regenerating
          const currentTaskData = readJSON(path.join(process.cwd(), 'tasks', 'tasks.json'));
          const taskToUpdate = currentTaskData.tasks.find(t => t.id === task.id);
          if (taskToUpdate) {
            taskToUpdate.subtasks = []; // Clear existing subtasks
            // Save before expanding again
            fs.writeFileSync(
              path.join(process.cwd(), 'tasks', 'tasks.json'),
              JSON.stringify(currentTaskData, null, 2)
            );
          }
          
          // Try expansion again with enhanced context and possibly different settings
          await expandTask(task.id, retrySubtasks, retryResearch, enhancedContext);
          retryCount++;
        }
        
        console.log(chalk.green(`\nCompleted retry expansion for ${retryCount} tasks.`));
        tasksExpanded += retryCount; // Add retries to total expanded count
      } else {
        console.log(chalk.blue('\nSkipping retry. You can manually retry task expansion using the expand command.'));
      }
    } else {
      console.log(chalk.green('\nVerification complete. All subtasks appear to be of good quality.'));
    }
    
    console.log(chalk.green(`\nExpanded ${tasksExpanded} tasks.`));
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
  
  // Enhanced regex that's more tolerant of variations in formatting
  // This handles more cases like: subtask headings with or without numbers, different separators, etc.
  const subtaskRegex = /(?:^|\n)\s*(?:(?:Subtask\s*(?:\d+)?[:.-]?\s*)|(?:\d+\.\s*))([^\n]+)(?:\n|$)(?:(?:\n|^)Description\s*[:.-]?\s*([^]*?))?(?:(?:\n|^)Dependencies\s*[:.-]?\s*([^]*?))?(?:(?:\n|^)Acceptance Criteria\s*[:.-]?\s*([^]*?))?(?=\n\s*(?:(?:Subtask\s*(?:\d+)?[:.-]?\s*)|(?:\d+\.\s*))|$)/gmi;
  
  let match;
  while ((match = subtaskRegex.exec(text)) !== null) {
    const [_, title, descriptionRaw, dependenciesRaw, acceptanceCriteriaRaw] = match;
    
    // Skip if we couldn't extract a meaningful title
    if (!title || title.trim().length === 0) continue;
    
    // Clean up the description - if description is undefined, use the first paragraph of the section
    let description = descriptionRaw ? descriptionRaw.trim() : '';
    if (!description) {
      // Try to extract the first paragraph after the title as the description
      const sectionText = text.substring(match.index + match[0].indexOf(title) + title.length);
      const nextSection = sectionText.match(/\n\s*(?:Subtask|Dependencies|Acceptance Criteria)/i);
      if (nextSection) {
        description = sectionText.substring(0, nextSection.index).trim();
      }
    }
    
    // Extract dependencies
    let dependencies = [];
    if (dependenciesRaw) {
      const depText = dependenciesRaw.trim();
      if (depText && !/(none|n\/a|no dependencies)/i.test(depText)) {
        // Extract numbers from dependencies text
        const depNumbers = depText.match(/\d+/g);
        if (depNumbers) {
          dependencies = depNumbers.map(n => parseInt(n, 10));
        }
      }
    }
    
    // Extract acceptance criteria
    let acceptanceCriteria = '';
    if (acceptanceCriteriaRaw) {
      acceptanceCriteria = acceptanceCriteriaRaw.trim();
    } else {
      // Try to find acceptance criteria in the section if not explicitly labeled
      const acMatch = match[0].match(/(?:criteria|must|should|requirements|tests)(?:\s*[:.-])?\s*([^]*?)(?=\n\s*(?:Subtask|Dependencies)|$)/i);
      if (acMatch) {
        acceptanceCriteria = acMatch[1].trim();
      }
    }
    
    // Create the subtask object
    const subtask = {
      id: startId + subtasks.length,
      title: title.trim(),
      description: description || `Implement ${title.trim()}`, // Ensure we have at least a basic description
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
  
  // If regex parsing failed or didn't find enough subtasks, try additional parsing methods
  if (subtasks.length < expectedCount) {
    log('info', `Regex parsing found only ${subtasks.length} subtasks, trying alternative parsing...`);
    
    // Look for numbered lists (1. Task title)
    const numberedListRegex = /(?:^|\n)\s*(\d+)\.\s+([^\n]+)(?:\n|$)([^]*?)(?=(?:\n\s*\d+\.\s+)|$)/g;
    while (subtasks.length < expectedCount && (match = numberedListRegex.exec(text)) !== null) {
      const [_, num, title, detailsRaw] = match;
      
      // Skip if we've already captured this (might be duplicated by the first regex)
      if (subtasks.some(st => st.title.trim() === title.trim())) {
        continue;
      }
      
      const details = detailsRaw ? detailsRaw.trim() : '';
      
      // Create the subtask
      const subtask = {
        id: startId + subtasks.length,
        title: title.trim(),
        description: details || `Implement ${title.trim()}`,
        status: "pending",
        dependencies: [],
        acceptanceCriteria: ''
      };
      
      subtasks.push(subtask);
    }
    
    // Look for bulleted lists (- Task title or * Task title)
    const bulletedListRegex = /(?:^|\n)\s*[-*]\s+([^\n]+)(?:\n|$)([^]*?)(?=(?:\n\s*[-*]\s+)|$)/g;
    while (subtasks.length < expectedCount && (match = bulletedListRegex.exec(text)) !== null) {
      const [_, title, detailsRaw] = match;
      
      // Skip if we've already captured this
      if (subtasks.some(st => st.title.trim() === title.trim())) {
        continue;
      }
      
      const details = detailsRaw ? detailsRaw.trim() : '';
      
      // Create the subtask
      const subtask = {
        id: startId + subtasks.length,
        title: title.trim(),
        description: details || `Implement ${title.trim()}`,
        status: "pending",
        dependencies: [],
        acceptanceCriteria: ''
      };
      
      subtasks.push(subtask);
    }
    
    // As a last resort, look for potential titles using heuristics (e.g., sentences followed by paragraphs)
    if (subtasks.length < expectedCount) {
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      
      for (let i = 0; i < lines.length && subtasks.length < expectedCount; i++) {
        const line = lines[i].trim();
        
        // Skip if the line is too long to be a title, or contains typical non-title content
        if (line.length > 100 || /^(Description|Dependencies|Acceptance Criteria|Implementation|Details|Approach):/i.test(line)) {
          continue;
        }
        
        // Skip if it matches a pattern we already tried to parse
        if (/^(Subtask|Task|\d+\.|-|\*)/.test(line)) {
          continue;
        }
        
        // Skip if we've already captured this title
        if (subtasks.some(st => st.title.trim() === line.trim())) {
          continue;
        }
        
        // Get the next few lines as potential description
        let description = '';
        if (i + 1 < lines.length) {
          description = lines.slice(i + 1, i + 4).join('\n').trim();
        }
        
        // Create the subtask
        const subtask = {
          id: startId + subtasks.length,
          title: line,
          description: description || `Implement ${line}`,
          status: "pending",
          dependencies: [],
          acceptanceCriteria: ''
        };
        
        subtasks.push(subtask);
      }
    }
  }
  
  // If we still don't have enough subtasks, create more meaningful dummy ones based on context
  if (subtasks.length < expectedCount) {
    log('info', `Parsing found only ${subtasks.length} subtasks, creating intelligent dummy ones to reach ${expectedCount}...`);
    
    // Create a list of common subtask patterns to use
    const dummyTaskPatterns = [
      { title: "Implementation", description: "Implement the core functionality required for this task." },
      { title: "Testing", description: "Create comprehensive tests for the implemented functionality." },
      { title: "Documentation", description: "Document the implemented functionality and usage examples." },
      { title: "Integration", description: "Integrate the functionality with other components of the system." },
      { title: "Error Handling", description: "Implement robust error handling and edge case management." },
      { title: "Refactoring", description: "Refine and optimize the implementation for better performance and maintainability." },
      { title: "Validation", description: "Implement validation logic to ensure data integrity and security." },
      { title: "Configuration", description: "Create configuration options and settings for the functionality." }
    ];
    
    for (let i = subtasks.length; i < expectedCount; i++) {
      // Select a pattern based on the current subtask number
      const patternIndex = i % dummyTaskPatterns.length;
      const pattern = dummyTaskPatterns[patternIndex];
      
      subtasks.push({
        id: startId + i,
        title: pattern.title,
        description: pattern.description,
        status: "pending",
        dependencies: [],
        acceptanceCriteria: 'Update this auto-generated subtask with specific details relevant to the parent task.'
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

  // Define the research prompt for Perplexity
  const researchPrompt = `You are a software development expert tasked with breaking down complex development tasks into detailed subtasks. Please research the following task thoroughly, and generate ${numSubtasks} specific, actionable subtasks.

${prompt}

Format your response as specific, well-defined subtasks that could be assigned to developers. Be precise and technical in your descriptions.`;

  // Start loading indicator
  const loadingInterval = startLoadingIndicator('Researching and generating subtasks with AI');

  try {
    let responseText;
    
    try {
      // Try to use Perplexity first
      console.log(chalk.blue('Using Perplexity AI for research-backed subtask generation...'));
      const result = await perplexity.chat.completions.create({
        model: PERPLEXITY_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a technical analysis AI that helps break down software development tasks into detailed subtasks. Provide specific, actionable steps with clear definitions."
          },
          {
            role: "user",
            content: researchPrompt
          }
        ],
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

  program
    .command('analyze-complexity')
    .description('Analyze tasks and generate complexity-based expansion recommendations')
    .option('-o, --output <file>', 'Output file path for the report', 'scripts/task-complexity-report.json')
    .option('-m, --model <model>', 'LLM model to use for analysis (defaults to configured model)')
    .option('-t, --threshold <number>', 'Minimum complexity score to recommend expansion (1-10)', '5')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('-r, --research', 'Use Perplexity AI for research-backed complexity analysis')
    .action(async (options) => {
      const tasksPath = options.file || 'tasks/tasks.json';
      const outputPath = options.output;
      const modelOverride = options.model;
      const thresholdScore = parseFloat(options.threshold);
      const useResearch = options.research || false;
      
      console.log(chalk.blue(`Analyzing task complexity from: ${tasksPath}`));
      console.log(chalk.blue(`Output report will be saved to: ${outputPath}`));
      
      if (useResearch) {
        console.log(chalk.blue('Using Perplexity AI for research-backed complexity analysis'));
      }
      
      await analyzeTaskComplexity(options);
    });

  program
    .command('clear-subtasks')
    .description('Clear subtasks from specified tasks')
    .option('-f, --file <file>', 'Path to the tasks file', 'tasks/tasks.json')
    .option('-i, --id <ids>', 'Task IDs (comma-separated) to clear subtasks from')
    .option('--all', 'Clear subtasks from all tasks')
    .action(async (options) => {
      const tasksPath = options.file;
      const taskIds = options.id;
      const all = options.all;

      if (!taskIds && !all) {
        console.error(chalk.red('Error: Please specify task IDs with --id=<ids> or use --all to clear all tasks'));
        process.exit(1);
      }

      if (all) {
        // If --all is specified, get all task IDs
        const data = readJSON(tasksPath);
        if (!data || !data.tasks) {
          console.error(chalk.red('Error: No valid tasks found'));
          process.exit(1);
        }
        const allIds = data.tasks.map(t => t.id).join(',');
        clearSubtasks(tasksPath, allIds);
      } else {
        clearSubtasks(tasksPath, taskIds);
      }
    });

  await program.parseAsync(process.argv);
}

/**
 * Analyzes task complexity and generates expansion recommendations
 * @param {Object} options Command options
 */
async function analyzeTaskComplexity(options) {
  const tasksPath = options.file || 'tasks/tasks.json';
  const outputPath = options.output || 'scripts/task-complexity-report.json';
  const modelOverride = options.model;
  const thresholdScore = parseFloat(options.threshold || '5');
  const useResearch = options.research || false;
  
  console.log(chalk.blue(`Analyzing task complexity and generating expansion recommendations...`));
  
  try {
    // Read tasks.json
    console.log(chalk.blue(`Reading tasks from ${tasksPath}...`));
    const tasksData = readJSON(tasksPath);
    
    if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks) || tasksData.tasks.length === 0) {
      throw new Error('No tasks found in the tasks file');
    }
    
    console.log(chalk.blue(`Found ${tasksData.tasks.length} tasks to analyze.`));
    
    // Prepare the prompt for the LLM
    const prompt = generateComplexityAnalysisPrompt(tasksData);
    
    // Start loading indicator
    const loadingIndicator = startLoadingIndicator('Calling AI to analyze task complexity...');
    
    let fullResponse = '';
    let streamingInterval = null;
    
    try {
      // If research flag is set, use Perplexity first
      if (useResearch) {
        try {
          console.log(chalk.blue('Using Perplexity AI for research-backed complexity analysis...'));
          
          // Modify prompt to include more context for Perplexity and explicitly request JSON
          const researchPrompt = `You are conducting a detailed analysis of software development tasks to determine their complexity and how they should be broken down into subtasks.

Please research each task thoroughly, considering best practices, industry standards, and potential implementation challenges before providing your analysis.

CRITICAL: You MUST respond ONLY with a valid JSON array. Do not include ANY explanatory text, markdown formatting, or code block markers.

${prompt}

Your response must be a clean JSON array only, following exactly this format:
[
  {
    "taskId": 1,
    "taskTitle": "Example Task",
    "complexityScore": 7,
    "recommendedSubtasks": 4,
    "expansionPrompt": "Detailed prompt for expansion",
    "reasoning": "Explanation of complexity assessment"
  },
  // more tasks...
]

DO NOT include any text before or after the JSON array. No explanations, no markdown formatting.`;
          
          const result = await perplexity.chat.completions.create({
            model: PERPLEXITY_MODEL,
            messages: [
              {
                role: "system", 
                content: "You are a technical analysis AI that only responds with clean, valid JSON. Never include explanatory text or markdown formatting in your response."
              },
              {
                role: "user",
                content: researchPrompt
              }
            ],
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
          });
          
          // Extract the response text
          fullResponse = result.choices[0].message.content;
          console.log(chalk.green('Successfully generated complexity analysis with Perplexity AI'));
          
          if (streamingInterval) clearInterval(streamingInterval);
          stopLoadingIndicator(loadingIndicator);
          
          // ALWAYS log the first part of the response for debugging
          console.log(chalk.gray('Response first 200 chars:'));
          console.log(chalk.gray(fullResponse.substring(0, 200)));
        } catch (perplexityError) {
          console.log(chalk.yellow('Falling back to Claude for complexity analysis...'));
          console.log(chalk.gray('Perplexity error:'), perplexityError.message);
          
          // Continue to Claude as fallback
          await useClaudeForComplexityAnalysis();
        }
      } else {
        // Use Claude directly if research flag is not set
        await useClaudeForComplexityAnalysis();
      }
      
      // Helper function to use Claude for complexity analysis
      async function useClaudeForComplexityAnalysis() {
        // Call the LLM API with streaming
        const stream = await anthropic.messages.create({
          max_tokens: CONFIG.maxTokens,
          model: modelOverride || CONFIG.model,
          temperature: CONFIG.temperature,
          messages: [{ role: "user", content: prompt }],
          system: "You are an expert software architect and project manager analyzing task complexity. Respond only with valid JSON.",
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
        
        console.log(chalk.green("Completed streaming response from Claude API!"));
      }
      
      // Parse the JSON response
      console.log(chalk.blue(`Parsing complexity analysis...`));
      let complexityAnalysis;
      try {
        // Clean up the response to ensure it's valid JSON
        let cleanedResponse = fullResponse;
        
        // First check for JSON code blocks (common in markdown responses)
        const codeBlockMatch = fullResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          cleanedResponse = codeBlockMatch[1];
          console.log(chalk.blue("Extracted JSON from code block"));
        } else {
          // Look for a complete JSON array pattern
          // This regex looks for an array of objects starting with [ and ending with ]
          const jsonArrayMatch = fullResponse.match(/(\[\s*\{\s*"[^"]*"\s*:[\s\S]*\}\s*\])/);
          if (jsonArrayMatch) {
            cleanedResponse = jsonArrayMatch[1];
            console.log(chalk.blue("Extracted JSON array pattern"));
          } else {
            // Try to find the start of a JSON array and capture to the end
            const jsonStartMatch = fullResponse.match(/(\[\s*\{[\s\S]*)/);
            if (jsonStartMatch) {
              cleanedResponse = jsonStartMatch[1];
              // Try to find a proper closing to the array
              const properEndMatch = cleanedResponse.match(/([\s\S]*\}\s*\])/);
              if (properEndMatch) {
                cleanedResponse = properEndMatch[1];
              }
              console.log(chalk.blue("Extracted JSON from start of array to end"));
            }
          }
        }
        
        // Log the cleaned response for debugging
        console.log(chalk.gray("Attempting to parse cleaned JSON..."));
        console.log(chalk.gray("Cleaned response (first 100 chars):"));
        console.log(chalk.gray(cleanedResponse.substring(0, 100)));
        console.log(chalk.gray("Last 100 chars:"));
        console.log(chalk.gray(cleanedResponse.substring(cleanedResponse.length - 100)));
        
        // More aggressive cleaning - strip any non-JSON content at the beginning or end
        const strictArrayMatch = cleanedResponse.match(/(\[\s*\{[\s\S]*\}\s*\])/);
        if (strictArrayMatch) {
          cleanedResponse = strictArrayMatch[1];
          console.log(chalk.blue("Applied strict JSON array extraction"));
        }
        
        try {
          complexityAnalysis = JSON.parse(cleanedResponse);
        } catch (jsonError) {
          console.log(chalk.yellow("Initial JSON parsing failed, attempting to fix common JSON issues..."));
          
          // Try to fix common JSON issues
          // 1. Remove any trailing commas in arrays or objects
          cleanedResponse = cleanedResponse.replace(/,(\s*[\]}])/g, '$1');
          
          // 2. Ensure property names are double-quoted
          cleanedResponse = cleanedResponse.replace(/(\s*)(\w+)(\s*):(\s*)/g, '$1"$2"$3:$4');
          
          // 3. Replace single quotes with double quotes for property values
          cleanedResponse = cleanedResponse.replace(/:(\s*)'([^']*)'(\s*[,}])/g, ':$1"$2"$3');
          
          // 4. Add a special fallback option if we're still having issues
          try {
            complexityAnalysis = JSON.parse(cleanedResponse);
            console.log(chalk.green("Successfully parsed JSON after fixing common issues"));
          } catch (fixedJsonError) {
            console.log(chalk.red("Failed to parse JSON even after fixes, attempting more aggressive cleanup..."));
            
            // Try to extract and process each task individually
            try {
              const taskMatches = cleanedResponse.match(/\{\s*"taskId"\s*:\s*(\d+)[^}]*\}/g);
              if (taskMatches && taskMatches.length > 0) {
                console.log(chalk.yellow(`Found ${taskMatches.length} task objects, attempting to process individually`));
                
                complexityAnalysis = [];
                for (const taskMatch of taskMatches) {
                  try {
                    // Try to parse each task object individually
                    const fixedTask = taskMatch.replace(/,\s*$/, ''); // Remove trailing commas
                    const taskObj = JSON.parse(`${fixedTask}`);
                    if (taskObj && taskObj.taskId) {
                      complexityAnalysis.push(taskObj);
                    }
                  } catch (taskParseError) {
                    console.log(chalk.yellow(`Could not parse individual task: ${taskMatch.substring(0, 30)}...`));
                  }
                }
                
                if (complexityAnalysis.length > 0) {
                  console.log(chalk.green(`Successfully parsed ${complexityAnalysis.length} tasks individually`));
                } else {
                  throw new Error("Could not parse any tasks individually");
                }
              } else {
                throw fixedJsonError;
              }
            } catch (individualError) {
              console.log(chalk.red("All parsing attempts failed"));
              throw jsonError; // throw the original error
            }
          }
        }
        
        // Ensure complexityAnalysis is an array
        if (!Array.isArray(complexityAnalysis)) {
          console.log(chalk.yellow('Response is not an array, checking if it contains an array property...'));
          
          // Handle the case where the response might be an object with an array property
          if (complexityAnalysis.tasks || complexityAnalysis.analysis || complexityAnalysis.results) {
            complexityAnalysis = complexityAnalysis.tasks || complexityAnalysis.analysis || complexityAnalysis.results;
          } else {
            // If no recognizable array property, wrap it as an array if it's an object
            if (typeof complexityAnalysis === 'object' && complexityAnalysis !== null) {
              console.log(chalk.yellow('Converting object to array...'));
              complexityAnalysis = [complexityAnalysis];
            } else {
              throw new Error('Response does not contain a valid array or object');
            }
          }
        }
        
        // Final check to ensure we have an array
        if (!Array.isArray(complexityAnalysis)) {
          throw new Error('Failed to extract an array from the response');
        }
        
        // Check that we have an analysis for each task in the input file
        const taskIds = tasksData.tasks.map(t => t.id);
        const analysisTaskIds = complexityAnalysis.map(a => a.taskId);
        const missingTaskIds = taskIds.filter(id => !analysisTaskIds.includes(id));

        if (missingTaskIds.length > 0) {
          console.log(chalk.yellow(`Missing analysis for ${missingTaskIds.length} tasks: ${missingTaskIds.join(', ')}`));
          console.log(chalk.blue(`Attempting to analyze missing tasks...`));
          
          // Create a subset of tasksData with just the missing tasks
          const missingTasks = {
            meta: tasksData.meta,
            tasks: tasksData.tasks.filter(t => missingTaskIds.includes(t.id))
          };
          
          // Generate a prompt for just the missing tasks
          const missingTasksPrompt = generateComplexityAnalysisPrompt(missingTasks);
          
          // Call the same AI model to analyze the missing tasks
          let missingAnalysisResponse = '';
          
          try {
            // Start a new loading indicator
            const missingTasksLoadingIndicator = startLoadingIndicator('Analyzing missing tasks...');
            
            // Use the same AI model as the original analysis
            if (useResearch) {
              // Create the same research prompt but for missing tasks
              const missingTasksResearchPrompt = `You are conducting a detailed analysis of software development tasks to determine their complexity and how they should be broken down into subtasks.

Please research each task thoroughly, considering best practices, industry standards, and potential implementation challenges before providing your analysis.

CRITICAL: You MUST respond ONLY with a valid JSON array. Do not include ANY explanatory text, markdown formatting, or code block markers.

${missingTasksPrompt}

Your response must be a clean JSON array only, following exactly this format:
[
  {
    "taskId": 1,
    "taskTitle": "Example Task",
    "complexityScore": 7,
    "recommendedSubtasks": 4,
    "expansionPrompt": "Detailed prompt for expansion",
    "reasoning": "Explanation of complexity assessment"
  },
  // more tasks...
]

DO NOT include any text before or after the JSON array. No explanations, no markdown formatting.`;

              const result = await perplexity.chat.completions.create({
                model: PERPLEXITY_MODEL,
                messages: [
                  {
                    role: "system", 
                    content: "You are a technical analysis AI that only responds with clean, valid JSON. Never include explanatory text or markdown formatting in your response."
                  },
                  {
                    role: "user",
                    content: missingTasksResearchPrompt
                  }
                ],
                temperature: TEMPERATURE,
                max_tokens: MAX_TOKENS,
              });
              
              // Extract the response
              missingAnalysisResponse = result.choices[0].message.content;
            } else {
              // Use Claude
              const stream = await anthropic.messages.create({
                max_tokens: CONFIG.maxTokens,
                model: modelOverride || CONFIG.model,
                temperature: CONFIG.temperature,
                messages: [{ role: "user", content: missingTasksPrompt }],
                system: "You are an expert software architect and project manager analyzing task complexity. Respond only with valid JSON.",
                stream: true
              });
              
              // Process the stream
              for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.text) {
                  missingAnalysisResponse += chunk.delta.text;
                }
              }
            }
            
            // Stop the loading indicator
            stopLoadingIndicator(missingTasksLoadingIndicator);
            
            // Parse the response using the same parsing logic as before
            let missingAnalysis;
            try {
              // Clean up the response to ensure it's valid JSON (using same logic as above)
              let cleanedResponse = missingAnalysisResponse;
              
              // Use the same JSON extraction logic as before
              // ... (code omitted for brevity, it would be the same as the original parsing)
              
              // First check for JSON code blocks
              const codeBlockMatch = missingAnalysisResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (codeBlockMatch) {
                cleanedResponse = codeBlockMatch[1];
                console.log(chalk.blue("Extracted JSON from code block for missing tasks"));
              } else {
                // Look for a complete JSON array pattern
                const jsonArrayMatch = missingAnalysisResponse.match(/(\[\s*\{\s*"[^"]*"\s*:[\s\S]*\}\s*\])/);
                if (jsonArrayMatch) {
                  cleanedResponse = jsonArrayMatch[1];
                  console.log(chalk.blue("Extracted JSON array pattern for missing tasks"));
                } else {
                  // Try to find the start of a JSON array and capture to the end
                  const jsonStartMatch = missingAnalysisResponse.match(/(\[\s*\{[\s\S]*)/);
                  if (jsonStartMatch) {
                    cleanedResponse = jsonStartMatch[1];
                    // Try to find a proper closing to the array
                    const properEndMatch = cleanedResponse.match(/([\s\S]*\}\s*\])/);
                    if (properEndMatch) {
                      cleanedResponse = properEndMatch[1];
                    }
                    console.log(chalk.blue("Extracted JSON from start of array to end for missing tasks"));
                  }
                }
              }
              
              // More aggressive cleaning if needed
              const strictArrayMatch = cleanedResponse.match(/(\[\s*\{[\s\S]*\}\s*\])/);
              if (strictArrayMatch) {
                cleanedResponse = strictArrayMatch[1];
                console.log(chalk.blue("Applied strict JSON array extraction for missing tasks"));
              }
              
              try {
                missingAnalysis = JSON.parse(cleanedResponse);
              } catch (jsonError) {
                // Try to fix common JSON issues (same as before)
                cleanedResponse = cleanedResponse.replace(/,(\s*[\]}])/g, '$1');
                cleanedResponse = cleanedResponse.replace(/(\s*)(\w+)(\s*):(\s*)/g, '$1"$2"$3:$4');
                cleanedResponse = cleanedResponse.replace(/:(\s*)'([^']*)'(\s*[,}])/g, ':$1"$2"$3');
                
                try {
                  missingAnalysis = JSON.parse(cleanedResponse);
                  console.log(chalk.green("Successfully parsed JSON for missing tasks after fixing common issues"));
                } catch (fixedJsonError) {
                  // Try the individual task extraction as a last resort
                  console.log(chalk.red("Failed to parse JSON for missing tasks, attempting individual extraction..."));
                  
                  const taskMatches = cleanedResponse.match(/\{\s*"taskId"\s*:\s*(\d+)[^}]*\}/g);
                  if (taskMatches && taskMatches.length > 0) {
                    console.log(chalk.yellow(`Found ${taskMatches.length} task objects, attempting to process individually`));
                    
                    missingAnalysis = [];
                    for (const taskMatch of taskMatches) {
                      try {
                        const fixedTask = taskMatch.replace(/,\s*$/, '');
                        const taskObj = JSON.parse(`${fixedTask}`);
                        if (taskObj && taskObj.taskId) {
                          missingAnalysis.push(taskObj);
                        }
                      } catch (taskParseError) {
                        console.log(chalk.yellow(`Could not parse individual task: ${taskMatch.substring(0, 30)}...`));
                      }
                    }
                    
                    if (missingAnalysis.length === 0) {
                      throw new Error("Could not parse any missing tasks");
                    }
                  } else {
                    throw fixedJsonError;
                  }
                }
              }
              
              // Ensure it's an array
              if (!Array.isArray(missingAnalysis)) {
                if (missingAnalysis && typeof missingAnalysis === 'object') {
                  missingAnalysis = [missingAnalysis];
                } else {
                  throw new Error("Missing tasks analysis is not an array or object");
                }
              }
              
              // Add the missing analyses to the main analysis array
              console.log(chalk.green(`Successfully analyzed ${missingAnalysis.length} missing tasks`));
              complexityAnalysis = [...complexityAnalysis, ...missingAnalysis];
              
              // Re-check for missing tasks
              const updatedAnalysisTaskIds = complexityAnalysis.map(a => a.taskId);
              const stillMissingTaskIds = taskIds.filter(id => !updatedAnalysisTaskIds.includes(id));
              
              if (stillMissingTaskIds.length > 0) {
                console.log(chalk.yellow(`Warning: Still missing analysis for ${stillMissingTaskIds.length} tasks: ${stillMissingTaskIds.join(', ')}`));
              } else {
                console.log(chalk.green(`All tasks now have complexity analysis!`));
              }
            } catch (error) {
              console.error(chalk.red(`Error analyzing missing tasks: ${error.message}`));
              console.log(chalk.yellow(`Continuing with partial analysis...`));
            }
          } catch (error) {
            console.error(chalk.red(`Error during retry for missing tasks: ${error.message}`));
            console.log(chalk.yellow(`Continuing with partial analysis...`));
          }
        }
      } catch (error) {
        console.error(chalk.red(`Failed to parse LLM response as JSON: ${error.message}`));
        if (CONFIG.debug) {
          console.debug(chalk.gray(`Raw response: ${fullResponse}`));
        }
        throw new Error('Invalid response format from LLM. Expected JSON.');
      }
      
      // Create the final report
      const report = {
        meta: {
          generatedAt: new Date().toISOString(),
          tasksAnalyzed: tasksData.tasks.length,
          thresholdScore: thresholdScore,
          projectName: tasksData.meta?.projectName || 'Your Project Name',
          usedResearch: useResearch
        },
        complexityAnalysis: complexityAnalysis
      };
      
      // Write the report to file
      console.log(chalk.blue(`Writing complexity report to ${outputPath}...`));
      writeJSON(outputPath, report);
      
      console.log(chalk.green(`Task complexity analysis complete. Report written to ${outputPath}`));
      
      // Display a summary of findings
      const highComplexity = complexityAnalysis.filter(t => t.complexityScore >= 8).length;
      const mediumComplexity = complexityAnalysis.filter(t => t.complexityScore >= 5 && t.complexityScore < 8).length;
      const lowComplexity = complexityAnalysis.filter(t => t.complexityScore < 5).length;
      const totalAnalyzed = complexityAnalysis.length;
      
      console.log('\nComplexity Analysis Summary:');
      console.log('----------------------------');
      console.log(`Tasks in input file: ${tasksData.tasks.length}`);
      console.log(`Tasks successfully analyzed: ${totalAnalyzed}`);
      console.log(`High complexity tasks: ${highComplexity}`);
      console.log(`Medium complexity tasks: ${mediumComplexity}`);
      console.log(`Low complexity tasks: ${lowComplexity}`);
      console.log(`Sum verification: ${highComplexity + mediumComplexity + lowComplexity} (should equal ${totalAnalyzed})`);
      console.log(`Research-backed analysis: ${useResearch ? 'Yes' : 'No'}`);
      console.log(`\nSee ${outputPath} for the full report and expansion commands.`);
      
    } catch (error) {
      if (streamingInterval) clearInterval(streamingInterval);
      stopLoadingIndicator(loadingIndicator);
      throw error;
    }
  } catch (error) {
    console.error(chalk.red(`Error analyzing task complexity: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Generates the prompt for the LLM to analyze task complexity
 * @param {Object} tasksData The tasks data from tasks.json
 * @returns {string} The prompt for the LLM
 */
function generateComplexityAnalysisPrompt(tasksData) {
  return `
You are an expert software architect and project manager. Your task is to analyze the complexity of development tasks and determine how many subtasks each should be broken down into.

Below is a list of development tasks with their descriptions and details. For each task:
1. Assess its complexity on a scale of 1-10
2. Recommend the optimal number of subtasks (between ${Math.max(3, CONFIG.defaultSubtasks - 1)}-${Math.min(8, CONFIG.defaultSubtasks + 2)})
3. Suggest a specific prompt that would help generate good subtasks for this task
4. Explain your reasoning briefly

Tasks:
${tasksData.tasks.map(task => `
ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
Details: ${task.details}
Dependencies: ${JSON.stringify(task.dependencies || [])}
Priority: ${task.priority || 'medium'}
`).join('\n---\n')}

Analyze each task and return a JSON array with the following structure for each task:
[
  {
    "taskId": number,
    "taskTitle": string,
    "complexityScore": number (1-10),
    "recommendedSubtasks": number (${Math.max(3, CONFIG.defaultSubtasks - 1)}-${Math.min(8, CONFIG.defaultSubtasks + 2)}),
    "expansionPrompt": string (a specific prompt for generating good subtasks),
    "reasoning": string (brief explanation of your assessment)
  },
  ...
]

IMPORTANT: Make sure to include an analysis for EVERY task listed above, with the correct taskId matching each task's ID.
`;
}

/**
 * Sanitizes a prompt string for use in a shell command
 * @param {string} prompt The prompt to sanitize
 * @returns {string} Sanitized prompt
 */
function sanitizePrompt(prompt) {
  // Replace double quotes with escaped double quotes
  return prompt.replace(/"/g, '\\"');
}

/**
 * Reads and parses the complexity report if it exists
 * @param {string} customPath - Optional custom path to the report
 * @returns {Object|null} The parsed complexity report or null if not found
 */
function readComplexityReport(customPath = null) {
  try {
    const reportPath = customPath || path.join(process.cwd(), 'scripts', 'task-complexity-report.json');
    if (!fs.existsSync(reportPath)) {
      return null;
    }
    
    const reportData = fs.readFileSync(reportPath, 'utf8');
    return JSON.parse(reportData);
  } catch (error) {
    console.log(chalk.yellow(`Could not read complexity report: ${error.message}`));
    return null;
  }
}

/**
 * Finds a task analysis in the complexity report
 * @param {Object} report - The complexity report
 * @param {number} taskId - The task ID to find
 * @returns {Object|null} The task analysis or null if not found
 */
function findTaskInComplexityReport(report, taskId) {
  if (!report || !report.complexityAnalysis || !Array.isArray(report.complexityAnalysis)) {
    return null;
  }
  
  return report.complexityAnalysis.find(task => task.taskId === taskId);
}

//
// Clear subtasks from tasks
//
function clearSubtasks(tasksPath, taskIds) {
  log('info', `Reading tasks from ${tasksPath}...`);
  const data = readJSON(tasksPath);
  if (!data || !data.tasks) {
    log('error', "No valid tasks found.");
    process.exit(1);
  }

  // Handle multiple task IDs (comma-separated)
  const taskIdArray = taskIds.split(',').map(id => id.trim());
  let clearedCount = 0;

  taskIdArray.forEach(taskId => {
    const id = parseInt(taskId, 10);
    if (isNaN(id)) {
      log('error', `Invalid task ID: ${taskId}`);
      return;
    }

    const task = data.tasks.find(t => t.id === id);
    if (!task) {
      log('error', `Task ${id} not found`);
      return;
    }

    if (!task.subtasks || task.subtasks.length === 0) {
      log('info', `Task ${id} has no subtasks to clear`);
      return;
    }

    const subtaskCount = task.subtasks.length;
    task.subtasks = [];
    clearedCount++;
    log('info', `Cleared ${subtaskCount} subtasks from task ${id}`);
  });

  if (clearedCount > 0) {
    writeJSON(tasksPath, data);
    log('info', `Successfully cleared subtasks from ${clearedCount} task(s)`);

    // Regenerate task files to reflect changes
    log('info', "Regenerating task files...");
    generateTaskFiles(tasksPath, path.dirname(tasksPath));
  } else {
    log('info', "No subtasks were cleared");
  }
}

main().catch(err => {
  log('error', err);
  process.exit(1);
});