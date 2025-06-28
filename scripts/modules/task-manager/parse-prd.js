import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import { z } from 'zod';

import {
	log,
	writeJSON,
	enableSilentMode,
	disableSilentMode,
	isSilentMode,
	readJSON,
	findTaskById,
	ensureTagMetadata,
	getCurrentTag
} from '../utils.js';

import { generateObjectService } from '../ai-services-unified.js';
import { getDebugFlag } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';
import { displayAiUsageSummary } from '../ui.js';

// Define the Zod schema for a SINGLE task object
const prdSingleTaskSchema = z.object({
	id: z.number().int().positive(),
	title: z.string().min(1),
	description: z.string().min(1),
	details: z.string().nullable(),
	testStrategy: z.string().nullable(),
	priority: z.enum(['high', 'medium', 'low']).nullable(),
	dependencies: z.array(z.number().int().positive()).nullable(),
	status: z.string().nullable()
});

// Define the Zod schema for the ENTIRE expected AI response object
const prdResponseSchema = z.object({
	tasks: z.array(prdSingleTaskSchema),
	metadata: z.object({
		projectName: z.string(),
		totalTasks: z.number(),
		sourceFile: z.string(),
		generatedAt: z.string()
	})
});

/**
 * Parse a PRD file and generate tasks
 * @param {string} prdPath - Path to the PRD file
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} numTasks - Number of tasks to generate
 * @param {Object} options - Additional options
 * @param {boolean} [options.force=false] - Whether to overwrite existing tasks.json.
 * @param {boolean} [options.append=false] - Append to existing tasks file.
 * @param {boolean} [options.research=false] - Use research model for enhanced PRD analysis.
 * @param {Object} [options.reportProgress] - Function to report progress (optional, likely unused).
 * @param {Object} [options.mcpLog] - MCP logger object (optional).
 * @param {Object} [options.session] - Session object from MCP server (optional).
 * @param {string} [options.projectRoot] - Project root path (for MCP/env fallback).
 * @param {string} [options.tag] - Target tag for task generation.
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json').
 */
async function parsePRD(prdPath, tasksPath, numTasks, options = {}) {
	const {
		reportProgress,
		mcpLog,
		session,
		projectRoot,
		force = false,
		append = false,
		research = false,
		tag
	} = options;
	const isMCP = !!mcpLog;
	const outputFormat = isMCP ? 'json' : 'text';

	// Use the provided tag, or the current active tag, or default to 'master'
	const targetTag = tag || getCurrentTag(projectRoot) || 'master';

	const logFn = mcpLog
		? mcpLog
		: {
				// Wrapper for CLI
				info: (...args) => log('info', ...args),
				warn: (...args) => log('warn', ...args),
				error: (...args) => log('error', ...args),
				debug: (...args) => log('debug', ...args),
				success: (...args) => log('success', ...args)
			};

	// Create custom reporter using logFn
	const report = (message, level = 'info') => {
		// Check logFn directly
		if (logFn && typeof logFn[level] === 'function') {
			logFn[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Fallback to original log only if necessary and in CLI text mode
			log(level, message);
		}
	};

	report(
		`Parsing PRD file: ${prdPath}, Force: ${force}, Append: ${append}, Research: ${research}`
	);

	let existingTasks = [];
	let nextId = 1;
	let aiServiceResponse = null;

	try {
		// Check if there are existing tasks in the target tag
		let hasExistingTasksInTag = false;
		if (fs.existsSync(tasksPath)) {
			try {
				// Read the entire file to check if the tag exists
				const existingFileContent = fs.readFileSync(tasksPath, 'utf8');
				const allData = JSON.parse(existingFileContent);

				// Check if the target tag exists and has tasks
				if (
					allData[targetTag] &&
					Array.isArray(allData[targetTag].tasks) &&
					allData[targetTag].tasks.length > 0
				) {
					hasExistingTasksInTag = true;
					existingTasks = allData[targetTag].tasks;
					nextId = Math.max(...existingTasks.map((t) => t.id || 0)) + 1;
				}
			} catch (error) {
				// If we can't read the file or parse it, assume no existing tasks in this tag
				hasExistingTasksInTag = false;
			}
		}

		// Handle file existence and overwrite/append logic based on target tag
		if (hasExistingTasksInTag) {
			if (append) {
				report(
					`Append mode enabled. Found ${existingTasks.length} existing tasks in tag '${targetTag}'. Next ID will be ${nextId}.`,
					'info'
				);
			} else if (!force) {
				// Not appending and not forcing overwrite, and there are existing tasks in the target tag
				const overwriteError = new Error(
					`Tag '${targetTag}' already contains ${existingTasks.length} tasks. Use --force to overwrite or --append to add to existing tasks.`
				);
				report(overwriteError.message, 'error');
				if (outputFormat === 'text') {
					console.error(chalk.red(overwriteError.message));
					process.exit(1);
				} else {
					throw overwriteError;
				}
			} else {
				// Force overwrite is true
				report(
					`Force flag enabled. Overwriting existing tasks in tag '${targetTag}'.`,
					'info'
				);
			}
		} else {
			// No existing tasks in target tag, proceed without confirmation
			report(
				`Tag '${targetTag}' is empty or doesn't exist. Creating/updating tag with new tasks.`,
				'info'
			);
		}

		report(`Reading PRD content from ${prdPath}`, 'info');
		const prdContent = fs.readFileSync(prdPath, 'utf8');
		if (!prdContent) {
			throw new Error(`Input file ${prdPath} is empty or could not be read.`);
		}

		// Research-specific enhancements to the system prompt
		const researchPromptAddition = research
			? `\n在分解PRD为任务之前，你将：
1. 研究和分析适合这个项目的最新技术、库、框架和最佳实践
2. 识别PRD中未明确提及的潜在技术挑战、安全问题或可扩展性问题，但不要丢弃任何明确的需求或过度增加复杂性——始终以提供最直接的实现路径为目标，避免过度工程化或迂回的方法
3. 考虑与此项目相关的当前行业标准和发展趋势（此步骤旨在解决由于训练数据截止日期导致的LLM幻觉和过时信息问题）
4. 评估替代实现方法并推荐最高效的路径
5. 根据你的研究，包括特定的库版本、有用的API和具体的实现指导
6. 始终以提供最直接的实现路径为目标，避免过度工程化或迂回的方法

你的任务分解应该融入这些研究，提供比仅从PRD文本中获得的更详细的实现指导、更准确的依赖关系映射和更精确的技术建议，同时保持所有明确的需求、最佳实践以及PRD的所有细节和细微差别。`
			: '';

		// Base system prompt for PRD parsing
		const systemPrompt = `你是一个专门分析产品需求文档(PRD)并生成结构化、逻辑有序、依赖关系清晰的开发任务列表的AI助手。任务列表将以JSON格式输出。${researchPromptAddition}

分析提供的PRD内容并生成大约${numTasks}个顶级开发任务。如果PRD的复杂性或详细程度较高，可以根据PRD的复杂性生成更多任务。
每个任务应代表实现需求所需的一个逻辑工作单元，并专注于最直接有效的实现方式，避免不必要的复杂性或过度工程化。为每个任务包含伪代码、实现细节和测试策略。找到最新的信息来实现每个任务。
从${nextId}开始分配连续的ID。仅根据PRD内容为每个任务推断标题、描述、详细信息和测试策略。
初始设置所有任务的状态为'pending'，依赖关系为空数组[]，优先级为'medium'。
仅回复一个有效的JSON对象，该对象包含一个键"tasks"，其值是一个符合提供的Zod模式的任务对象数组。不要包含任何解释或Markdown格式。

每个任务应遵循以下JSON结构：
{
	"id": 数字,
	"title": 字符串（使用中文）,
	"description": 字符串（使用中文）,
	"status": "pending",
	"dependencies": 数字数组（此任务依赖的任务ID）,
	"priority": "high" | "medium" | "low",
	"details": 字符串（实现细节，使用中文）,
	"testStrategy": 字符串（验证方法，使用中文）
}

指南：
1. 除非复杂性需要，否则创建正好${numTasks}个任务，从${nextId}开始按顺序编号
2. 每个任务应该是原子的，专注于单一职责，遵循最新的最佳实践和标准
3. 逻辑地排序任务 - 考虑依赖关系和实现顺序
4. 早期任务应该专注于设置和核心功能，然后是高级功能
5. 为每个任务包含明确的验证/测试方法
6. 设置适当的依赖关系ID（任务只能依赖于ID较低的任务，可能包括ID小于${nextId}的现有任务）
7. 根据关键性和依赖顺序分配优先级（high/medium/low）
8. 在"details"字段中包含详细的实现指导${research ? '，根据你的研究提供特定的库和版本建议' : ''}
9. 如果PRD包含关于库、数据库模式、框架、技术栈或任何其他实现细节的特定要求，严格遵守这些要求，在任何情况下都不要丢弃它们
10. 专注于填补PRD留下的任何空白或未完全指定的区域，同时保留所有明确的要求
11. 始终以提供最直接的实现路径为目标，避免过度工程化或迂回的方法${research ? '\n12. 对于每个任务，根据通过研究发现的当前行业标准和最佳实践，包含具体、可行的指导' : ''}

所有任务的标题、描述、详细信息和测试策略必须使用中文编写，以便于开发人员理解和实现。`;

		// Build user prompt with PRD content
		const userPrompt = `这是需要分解成大约${numTasks}个任务的产品需求文档(PRD)，任务ID从${nextId}开始：${research ? '\n\n记住在任务分解之前彻底研究当前的最佳实践和技术，以提供具体、可行的实现细节。' : ''}\n\n${prdContent}\n\n

		请按以下格式返回你的响应（所有文本内容必须使用中文）：
{
    "tasks": [
        {
            "id": 1,
            "title": "设置项目仓库",
            "description": "...",
            ...
        },
        ...
    ],
    "metadata": {
        "projectName": "PRD实现",
        "totalTasks": ${numTasks},
        "sourceFile": "${prdPath}",
        "generatedAt": "YYYY-MM-DD"
    }
}`;

		// Call the unified AI service
		report(
			`Calling AI service to generate tasks from PRD${research ? ' with research-backed analysis' : ''}...`,
			'info'
		);

		// Call generateObjectService with the CORRECT schema and additional telemetry params
		aiServiceResponse = await generateObjectService({
			role: research ? 'research' : 'main', // Use research role if flag is set
			session: session,
			projectRoot: projectRoot,
			schema: prdResponseSchema,
			objectName: 'tasks_data',
			systemPrompt: systemPrompt,
			prompt: userPrompt,
			commandName: 'parse-prd',
			outputType: isMCP ? 'mcp' : 'cli'
		});

		// Create the directory if it doesn't exist
		const tasksDir = path.dirname(tasksPath);
		if (!fs.existsSync(tasksDir)) {
			fs.mkdirSync(tasksDir, { recursive: true });
		}
		logFn.success(
			`Successfully parsed PRD via AI service${research ? ' with research-backed analysis' : ''}.`
		);

		// Validate and Process Tasks
		// const generatedData = aiServiceResponse?.mainResult?.object;

		// Robustly get the actual AI-generated object
		let generatedData = null;
		if (aiServiceResponse?.mainResult) {
			if (
				typeof aiServiceResponse.mainResult === 'object' &&
				aiServiceResponse.mainResult !== null &&
				'tasks' in aiServiceResponse.mainResult
			) {
				// If mainResult itself is the object with a 'tasks' property
				generatedData = aiServiceResponse.mainResult;
			} else if (
				typeof aiServiceResponse.mainResult.object === 'object' &&
				aiServiceResponse.mainResult.object !== null &&
				'tasks' in aiServiceResponse.mainResult.object
			) {
				// If mainResult.object is the object with a 'tasks' property
				generatedData = aiServiceResponse.mainResult.object;
			}
		}

		if (!generatedData || !Array.isArray(generatedData.tasks)) {
			logFn.error(
				`Internal Error: generateObjectService returned unexpected data structure: ${JSON.stringify(generatedData)}`
			);
			throw new Error(
				'AI service returned unexpected data structure after validation.'
			);
		}

		let currentId = nextId;
		const taskMap = new Map();
		const processedNewTasks = generatedData.tasks.map((task) => {
			const newId = currentId++;
			taskMap.set(task.id, newId);
			return {
				...task,
				id: newId,
				status: 'pending',
				priority: task.priority || 'medium',
				dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
				subtasks: []
			};
		});

		// Remap dependencies for the NEWLY processed tasks
		processedNewTasks.forEach((task) => {
			task.dependencies = task.dependencies
				.map((depId) => taskMap.get(depId)) // Map old AI ID to new sequential ID
				.filter(
					(newDepId) =>
						newDepId != null && // Must exist
						newDepId < task.id && // Must be a lower ID (could be existing or newly generated)
						(findTaskById(existingTasks, newDepId) || // Check if it exists in old tasks OR
							processedNewTasks.some((t) => t.id === newDepId)) // check if it exists in new tasks
				);
		});

		const finalTasks = append
			? [...existingTasks, ...processedNewTasks]
			: processedNewTasks;

		// Read the existing file to preserve other tags
		let outputData = {};
		if (fs.existsSync(tasksPath)) {
			try {
				const existingFileContent = fs.readFileSync(tasksPath, 'utf8');
				outputData = JSON.parse(existingFileContent);
			} catch (error) {
				// If we can't read the existing file, start with empty object
				outputData = {};
			}
		}

		// Update only the target tag, preserving other tags
		outputData[targetTag] = {
			tasks: finalTasks,
			metadata: {
				created:
					outputData[targetTag]?.metadata?.created || new Date().toISOString(),
				updated: new Date().toISOString(),
				description: `Tasks for ${targetTag} context`
			}
		};

		// Ensure the target tag has proper metadata
		ensureTagMetadata(outputData[targetTag], {
			description: `Tasks for ${targetTag} context`
		});

		// Write the complete data structure back to the file
		fs.writeFileSync(tasksPath, JSON.stringify(outputData, null, 2));
		report(
			`Successfully ${append ? 'appended' : 'generated'} ${processedNewTasks.length} tasks in ${tasksPath}${research ? ' with research-backed analysis' : ''}`,
			'success'
		);

		// Generate markdown task files after writing tasks.json
		// await generateTaskFiles(tasksPath, path.dirname(tasksPath), { mcpLog });

		// Handle CLI output (e.g., success message)
		if (outputFormat === 'text') {
			console.log(
				boxen(
					chalk.green(
						`Successfully generated ${processedNewTasks.length} new tasks${research ? ' with research-backed analysis' : ''}. Total tasks in ${tasksPath}: ${finalTasks.length}`
					),
					{ padding: 1, borderColor: 'green', borderStyle: 'round' }
				)
			);

			console.log(
				boxen(
					chalk.white.bold('Next Steps:') +
						'\n\n' +
						`${chalk.cyan('1.')} Run ${chalk.yellow('task-master list')} to view all tasks\n` +
						`${chalk.cyan('2.')} Run ${chalk.yellow('task-master expand --id=<id>')} to break down a task into subtasks`,
					{
						padding: 1,
						borderColor: 'cyan',
						borderStyle: 'round',
						margin: { top: 1 }
					}
				)
			);

			if (aiServiceResponse && aiServiceResponse.telemetryData) {
				displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
			}
		}

		// Return telemetry data
		return {
			success: true,
			tasksPath,
			telemetryData: aiServiceResponse?.telemetryData,
			tagInfo: aiServiceResponse?.tagInfo
		};
	} catch (error) {
		report(`Error parsing PRD: ${error.message}`, 'error');

		// Only show error UI for text output (CLI)
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));

			if (getDebugFlag(projectRoot)) {
				// Use projectRoot for debug flag check
				console.error(error);
			}

			process.exit(1);
		} else {
			throw error; // Re-throw for JSON output
		}
	}
}

export default parsePRD;
