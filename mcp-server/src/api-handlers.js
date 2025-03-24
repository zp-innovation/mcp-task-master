import { z } from "zod";
import { logger } from "../../scripts/modules/utils.js";
import ContextManager from "./context-manager.js";

/**
 * MCP API Handlers class
 * Implements handlers for the MCP API endpoints
 */
class MCPApiHandlers {
  constructor(server) {
    this.server = server;
    this.contextManager = new ContextManager();
    this.logger = logger;

    // Bind methods
    this.registerEndpoints = this.registerEndpoints.bind(this);
    this.setupContextHandlers = this.setupContextHandlers.bind(this);
    this.setupModelHandlers = this.setupModelHandlers.bind(this);
    this.setupExecuteHandlers = this.setupExecuteHandlers.bind(this);

    // Register all handlers
    this.registerEndpoints();
  }

  /**
   * Register all MCP API endpoints
   */
  registerEndpoints() {
    this.setupContextHandlers();
    this.setupModelHandlers();
    this.setupExecuteHandlers();

    this.logger.info("Registered all MCP API endpoint handlers");
  }

  /**
   * Set up handlers for the /context endpoint
   */
  setupContextHandlers() {
    // Add a tool to create context
    this.server.addTool({
      name: "createContext",
      description:
        "Create a new context with the given data and optional metadata",
      parameters: z.object({
        contextId: z.string().describe("Unique identifier for the context"),
        data: z.any().describe("The context data to store"),
        metadata: z
          .object({})
          .optional()
          .describe("Optional metadata for the context"),
      }),
      execute: async (args) => {
        try {
          const context = await this.contextManager.createContext(
            args.contextId,
            args.data,
            args.metadata || {}
          );
          return { success: true, context };
        } catch (error) {
          this.logger.error(`Error creating context: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to get context
    this.server.addTool({
      name: "getContext",
      description:
        "Retrieve a context by its ID, optionally a specific version",
      parameters: z.object({
        contextId: z.string().describe("The ID of the context to retrieve"),
        versionId: z
          .string()
          .optional()
          .describe("Optional specific version ID to retrieve"),
      }),
      execute: async (args) => {
        try {
          const context = await this.contextManager.getContext(
            args.contextId,
            args.versionId
          );
          return { success: true, context };
        } catch (error) {
          this.logger.error(`Error retrieving context: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to update context
    this.server.addTool({
      name: "updateContext",
      description: "Update an existing context with new data and/or metadata",
      parameters: z.object({
        contextId: z.string().describe("The ID of the context to update"),
        data: z
          .any()
          .optional()
          .describe("New data to update the context with"),
        metadata: z
          .object({})
          .optional()
          .describe("New metadata to update the context with"),
        createNewVersion: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to create a new version (true) or update in place (false)"
          ),
      }),
      execute: async (args) => {
        try {
          const context = await this.contextManager.updateContext(
            args.contextId,
            args.data || {},
            args.metadata || {},
            args.createNewVersion
          );
          return { success: true, context };
        } catch (error) {
          this.logger.error(`Error updating context: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to delete context
    this.server.addTool({
      name: "deleteContext",
      description: "Delete a context by its ID",
      parameters: z.object({
        contextId: z.string().describe("The ID of the context to delete"),
      }),
      execute: async (args) => {
        try {
          const result = await this.contextManager.deleteContext(
            args.contextId
          );
          return { success: result };
        } catch (error) {
          this.logger.error(`Error deleting context: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to list contexts with pagination and advanced filtering
    this.server.addTool({
      name: "listContexts",
      description:
        "List available contexts with filtering, pagination and sorting",
      parameters: z.object({
        // Filtering parameters
        filters: z
          .object({
            tag: z.string().optional().describe("Filter contexts by tag"),
            metadataKey: z
              .string()
              .optional()
              .describe("Filter contexts by metadata key"),
            metadataValue: z
              .string()
              .optional()
              .describe("Filter contexts by metadata value"),
            createdAfter: z
              .string()
              .optional()
              .describe("Filter contexts created after date (ISO format)"),
            updatedAfter: z
              .string()
              .optional()
              .describe("Filter contexts updated after date (ISO format)"),
          })
          .optional()
          .describe("Filters to apply to the context list"),

        // Pagination parameters
        limit: z
          .number()
          .optional()
          .default(100)
          .describe("Maximum number of contexts to return"),
        offset: z
          .number()
          .optional()
          .default(0)
          .describe("Number of contexts to skip"),

        // Sorting parameters
        sortBy: z
          .string()
          .optional()
          .default("updated")
          .describe("Field to sort by (id, created, updated, size)"),
        sortDirection: z
          .enum(["asc", "desc"])
          .optional()
          .default("desc")
          .describe("Sort direction"),

        // Search query
        query: z.string().optional().describe("Free text search query"),
      }),
      execute: async (args) => {
        try {
          const result = await this.contextManager.listContexts(args);
          return {
            success: true,
            ...result,
          };
        } catch (error) {
          this.logger.error(`Error listing contexts: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to get context history
    this.server.addTool({
      name: "getContextHistory",
      description: "Get the version history of a context",
      parameters: z.object({
        contextId: z
          .string()
          .describe("The ID of the context to get history for"),
      }),
      execute: async (args) => {
        try {
          const history = await this.contextManager.getContextHistory(
            args.contextId
          );
          return {
            success: true,
            history,
            contextId: args.contextId,
          };
        } catch (error) {
          this.logger.error(`Error getting context history: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to merge contexts
    this.server.addTool({
      name: "mergeContexts",
      description: "Merge multiple contexts into a new context",
      parameters: z.object({
        contextIds: z
          .array(z.string())
          .describe("Array of context IDs to merge"),
        newContextId: z.string().describe("ID for the new merged context"),
        metadata: z
          .object({})
          .optional()
          .describe("Optional metadata for the new context"),
      }),
      execute: async (args) => {
        try {
          const mergedContext = await this.contextManager.mergeContexts(
            args.contextIds,
            args.newContextId,
            args.metadata || {}
          );
          return {
            success: true,
            context: mergedContext,
          };
        } catch (error) {
          this.logger.error(`Error merging contexts: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to add tags to a context
    this.server.addTool({
      name: "addTags",
      description: "Add tags to a context",
      parameters: z.object({
        contextId: z.string().describe("The ID of the context to tag"),
        tags: z
          .array(z.string())
          .describe("Array of tags to add to the context"),
      }),
      execute: async (args) => {
        try {
          const context = await this.contextManager.addTags(
            args.contextId,
            args.tags
          );
          return { success: true, context };
        } catch (error) {
          this.logger.error(`Error adding tags to context: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to remove tags from a context
    this.server.addTool({
      name: "removeTags",
      description: "Remove tags from a context",
      parameters: z.object({
        contextId: z
          .string()
          .describe("The ID of the context to remove tags from"),
        tags: z
          .array(z.string())
          .describe("Array of tags to remove from the context"),
      }),
      execute: async (args) => {
        try {
          const context = await this.contextManager.removeTags(
            args.contextId,
            args.tags
          );
          return { success: true, context };
        } catch (error) {
          this.logger.error(
            `Error removing tags from context: ${error.message}`
          );
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to truncate context
    this.server.addTool({
      name: "truncateContext",
      description: "Truncate a context to a maximum size",
      parameters: z.object({
        contextId: z.string().describe("The ID of the context to truncate"),
        maxSize: z
          .number()
          .describe("Maximum size (in characters) for the context"),
        strategy: z
          .enum(["start", "end", "middle"])
          .default("end")
          .describe("Truncation strategy: start, end, or middle"),
      }),
      execute: async (args) => {
        try {
          const context = await this.contextManager.truncateContext(
            args.contextId,
            args.maxSize,
            args.strategy
          );
          return { success: true, context };
        } catch (error) {
          this.logger.error(`Error truncating context: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    this.logger.info("Registered context endpoint handlers");
  }

  /**
   * Set up handlers for the /models endpoint
   */
  setupModelHandlers() {
    // Add a tool to list available models
    this.server.addTool({
      name: "listModels",
      description: "List all available models with their capabilities",
      parameters: z.object({}),
      execute: async () => {
        // Here we could get models from a more dynamic source
        // For now, returning static list of models supported by Task Master
        const models = [
          {
            id: "claude-3-opus-20240229",
            provider: "anthropic",
            capabilities: [
              "text-generation",
              "embeddings",
              "context-window-100k",
            ],
          },
          {
            id: "claude-3-7-sonnet-20250219",
            provider: "anthropic",
            capabilities: [
              "text-generation",
              "embeddings",
              "context-window-200k",
            ],
          },
          {
            id: "sonar-medium-online",
            provider: "perplexity",
            capabilities: ["text-generation", "web-search", "research"],
          },
        ];

        return { success: true, models };
      },
    });

    // Add a tool to get model details
    this.server.addTool({
      name: "getModelDetails",
      description: "Get detailed information about a specific model",
      parameters: z.object({
        modelId: z.string().describe("The ID of the model to get details for"),
      }),
      execute: async (args) => {
        // Here we could get model details from a more dynamic source
        // For now, returning static information
        const modelsMap = {
          "claude-3-opus-20240229": {
            id: "claude-3-opus-20240229",
            provider: "anthropic",
            capabilities: [
              "text-generation",
              "embeddings",
              "context-window-100k",
            ],
            maxTokens: 100000,
            temperature: { min: 0, max: 1, default: 0.7 },
            pricing: { input: 0.000015, output: 0.000075 },
          },
          "claude-3-7-sonnet-20250219": {
            id: "claude-3-7-sonnet-20250219",
            provider: "anthropic",
            capabilities: [
              "text-generation",
              "embeddings",
              "context-window-200k",
            ],
            maxTokens: 200000,
            temperature: { min: 0, max: 1, default: 0.7 },
            pricing: { input: 0.000003, output: 0.000015 },
          },
          "sonar-medium-online": {
            id: "sonar-medium-online",
            provider: "perplexity",
            capabilities: ["text-generation", "web-search", "research"],
            maxTokens: 4096,
            temperature: { min: 0, max: 1, default: 0.7 },
          },
        };

        const model = modelsMap[args.modelId];
        if (!model) {
          return {
            success: false,
            error: `Model with ID ${args.modelId} not found`,
          };
        }

        return { success: true, model };
      },
    });

    this.logger.info("Registered models endpoint handlers");
  }

  /**
   * Set up handlers for the /execute endpoint
   */
  setupExecuteHandlers() {
    // Add a tool to execute operations with context
    this.server.addTool({
      name: "executeWithContext",
      description: "Execute an operation with the provided context",
      parameters: z.object({
        operation: z.string().describe("The operation to execute"),
        contextId: z.string().describe("The ID of the context to use"),
        parameters: z
          .record(z.any())
          .optional()
          .describe("Additional parameters for the operation"),
        versionId: z
          .string()
          .optional()
          .describe("Optional specific context version to use"),
      }),
      execute: async (args) => {
        try {
          // Get the context first, with version if specified
          const context = await this.contextManager.getContext(
            args.contextId,
            args.versionId
          );

          // Execute different operations based on the operation name
          switch (args.operation) {
            case "generateTask":
              return await this.executeGenerateTask(context, args.parameters);
            case "expandTask":
              return await this.executeExpandTask(context, args.parameters);
            case "analyzeComplexity":
              return await this.executeAnalyzeComplexity(
                context,
                args.parameters
              );
            case "mergeContexts":
              return await this.executeMergeContexts(context, args.parameters);
            case "searchContexts":
              return await this.executeSearchContexts(args.parameters);
            case "extractInsights":
              return await this.executeExtractInsights(
                context,
                args.parameters
              );
            case "syncWithRepository":
              return await this.executeSyncWithRepository(
                context,
                args.parameters
              );
            default:
              return {
                success: false,
                error: `Unknown operation: ${args.operation}`,
              };
          }
        } catch (error) {
          this.logger.error(`Error executing operation: ${error.message}`);
          return {
            success: false,
            error: error.message,
            operation: args.operation,
            contextId: args.contextId,
          };
        }
      },
    });

    // Add tool for batch operations
    this.server.addTool({
      name: "executeBatchOperations",
      description: "Execute multiple operations in a single request",
      parameters: z.object({
        operations: z
          .array(
            z.object({
              operation: z.string().describe("The operation to execute"),
              contextId: z.string().describe("The ID of the context to use"),
              parameters: z
                .record(z.any())
                .optional()
                .describe("Additional parameters"),
              versionId: z
                .string()
                .optional()
                .describe("Optional context version"),
            })
          )
          .describe("Array of operations to execute in sequence"),
      }),
      execute: async (args) => {
        const results = [];
        let hasErrors = false;

        for (const op of args.operations) {
          try {
            const context = await this.contextManager.getContext(
              op.contextId,
              op.versionId
            );

            let result;
            switch (op.operation) {
              case "generateTask":
                result = await this.executeGenerateTask(context, op.parameters);
                break;
              case "expandTask":
                result = await this.executeExpandTask(context, op.parameters);
                break;
              case "analyzeComplexity":
                result = await this.executeAnalyzeComplexity(
                  context,
                  op.parameters
                );
                break;
              case "mergeContexts":
                result = await this.executeMergeContexts(
                  context,
                  op.parameters
                );
                break;
              case "searchContexts":
                result = await this.executeSearchContexts(op.parameters);
                break;
              case "extractInsights":
                result = await this.executeExtractInsights(
                  context,
                  op.parameters
                );
                break;
              case "syncWithRepository":
                result = await this.executeSyncWithRepository(
                  context,
                  op.parameters
                );
                break;
              default:
                result = {
                  success: false,
                  error: `Unknown operation: ${op.operation}`,
                };
                hasErrors = true;
            }

            results.push({
              operation: op.operation,
              contextId: op.contextId,
              result: result,
            });

            if (!result.success) {
              hasErrors = true;
            }
          } catch (error) {
            this.logger.error(
              `Error in batch operation ${op.operation}: ${error.message}`
            );
            results.push({
              operation: op.operation,
              contextId: op.contextId,
              result: {
                success: false,
                error: error.message,
              },
            });
            hasErrors = true;
          }
        }

        return {
          success: !hasErrors,
          results: results,
        };
      },
    });

    this.logger.info("Registered execute endpoint handlers");
  }

  /**
   * Execute the generateTask operation
   * @param {object} context - The context to use
   * @param {object} parameters - Additional parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeGenerateTask(context, parameters = {}) {
    // This is a placeholder for actual task generation logic
    // In a real implementation, this would use Task Master's task generation

    this.logger.info(`Generating task with context ${context.id}`);

    // Improved task generation with more detailed result
    const task = {
      id: Math.floor(Math.random() * 1000),
      title: parameters.title || "New Task",
      description: parameters.description || "Task generated from context",
      status: "pending",
      dependencies: parameters.dependencies || [],
      priority: parameters.priority || "medium",
      details: `This task was generated using context ${
        context.id
      }.\n\n${JSON.stringify(context.data, null, 2)}`,
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedFrom: context.id,
        contextVersion: context.metadata.version,
        generatedBy: parameters.user || "system",
      },
    };

    return {
      success: true,
      task,
      contextUsed: {
        id: context.id,
        version: context.metadata.version,
      },
    };
  }

  /**
   * Execute the expandTask operation
   * @param {object} context - The context to use
   * @param {object} parameters - Additional parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeExpandTask(context, parameters = {}) {
    // This is a placeholder for actual task expansion logic
    // In a real implementation, this would use Task Master's task expansion

    this.logger.info(`Expanding task with context ${context.id}`);

    // Enhanced task expansion with more configurable options
    const numSubtasks = parameters.numSubtasks || 3;
    const subtaskPrefix = parameters.subtaskPrefix || "";
    const subtasks = [];

    for (let i = 1; i <= numSubtasks; i++) {
      subtasks.push({
        id: `${subtaskPrefix}${i}`,
        title: parameters.titleTemplate
          ? parameters.titleTemplate.replace("{i}", i)
          : `Subtask ${i}`,
        description: parameters.descriptionTemplate
          ? parameters.descriptionTemplate
              .replace("{i}", i)
              .replace("{taskId}", parameters.taskId || "unknown")
          : `Subtask ${i} for ${parameters.taskId || "unknown task"}`,
        dependencies: i > 1 ? [i - 1] : [],
        status: "pending",
        metadata: {
          expandedAt: new Date().toISOString(),
          expandedFrom: context.id,
          contextVersion: context.metadata.version,
          expandedBy: parameters.user || "system",
        },
      });
    }

    return {
      success: true,
      taskId: parameters.taskId,
      subtasks,
      contextUsed: {
        id: context.id,
        version: context.metadata.version,
      },
    };
  }

  /**
   * Execute the analyzeComplexity operation
   * @param {object} context - The context to use
   * @param {object} parameters - Additional parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeAnalyzeComplexity(context, parameters = {}) {
    // This is a placeholder for actual complexity analysis logic
    // In a real implementation, this would use Task Master's complexity analysis

    this.logger.info(`Analyzing complexity with context ${context.id}`);

    // Enhanced complexity analysis with more detailed factors
    const complexityScore = Math.floor(Math.random() * 10) + 1;
    const recommendedSubtasks = Math.floor(complexityScore / 2) + 1;

    // More detailed analysis with weighted factors
    const factors = [
      {
        name: "Task scope breadth",
        score: Math.floor(Math.random() * 10) + 1,
        weight: 0.3,
        description: "How broad is the scope of this task",
      },
      {
        name: "Technical complexity",
        score: Math.floor(Math.random() * 10) + 1,
        weight: 0.4,
        description: "How technically complex is the implementation",
      },
      {
        name: "External dependencies",
        score: Math.floor(Math.random() * 10) + 1,
        weight: 0.2,
        description: "How many external dependencies does this task have",
      },
      {
        name: "Risk assessment",
        score: Math.floor(Math.random() * 10) + 1,
        weight: 0.1,
        description: "What is the risk level of this task",
      },
    ];

    return {
      success: true,
      analysis: {
        taskId: parameters.taskId || "unknown",
        complexityScore,
        recommendedSubtasks,
        factors,
        recommendedTimeEstimate: `${complexityScore * 2}-${
          complexityScore * 4
        } hours`,
        metadata: {
          analyzedAt: new Date().toISOString(),
          analyzedUsing: context.id,
          contextVersion: context.metadata.version,
          analyzedBy: parameters.user || "system",
        },
      },
      contextUsed: {
        id: context.id,
        version: context.metadata.version,
      },
    };
  }

  /**
   * Execute the mergeContexts operation
   * @param {object} primaryContext - The primary context to use
   * @param {object} parameters - Additional parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeMergeContexts(primaryContext, parameters = {}) {
    this.logger.info(
      `Merging contexts with primary context ${primaryContext.id}`
    );

    if (
      !parameters.contextIds ||
      !Array.isArray(parameters.contextIds) ||
      parameters.contextIds.length === 0
    ) {
      return {
        success: false,
        error: "No context IDs provided for merging",
      };
    }

    if (!parameters.newContextId) {
      return {
        success: false,
        error: "New context ID is required for the merged context",
      };
    }

    try {
      // Add the primary context to the list if not already included
      if (!parameters.contextIds.includes(primaryContext.id)) {
        parameters.contextIds.unshift(primaryContext.id);
      }

      const mergedContext = await this.contextManager.mergeContexts(
        parameters.contextIds,
        parameters.newContextId,
        {
          mergedAt: new Date().toISOString(),
          mergedBy: parameters.user || "system",
          mergeStrategy: parameters.strategy || "concatenate",
          ...parameters.metadata,
        }
      );

      return {
        success: true,
        mergedContext,
        sourceContexts: parameters.contextIds,
      };
    } catch (error) {
      this.logger.error(`Error merging contexts: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute the searchContexts operation
   * @param {object} parameters - Search parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeSearchContexts(parameters = {}) {
    this.logger.info(
      `Searching contexts with query: ${parameters.query || ""}`
    );

    try {
      const searchResults = await this.contextManager.listContexts({
        query: parameters.query || "",
        filters: parameters.filters || {},
        limit: parameters.limit || 100,
        offset: parameters.offset || 0,
        sortBy: parameters.sortBy || "updated",
        sortDirection: parameters.sortDirection || "desc",
      });

      return {
        success: true,
        ...searchResults,
      };
    } catch (error) {
      this.logger.error(`Error searching contexts: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute the extractInsights operation
   * @param {object} context - The context to analyze
   * @param {object} parameters - Additional parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeExtractInsights(context, parameters = {}) {
    this.logger.info(`Extracting insights from context ${context.id}`);

    // Placeholder for actual insight extraction
    // In a real implementation, this would perform analysis on the context data

    const insights = [
      {
        type: "summary",
        content: `Summary of context ${context.id}`,
        confidence: 0.85,
      },
      {
        type: "key_points",
        content: ["First key point", "Second key point", "Third key point"],
        confidence: 0.78,
      },
      {
        type: "recommendations",
        content: ["First recommendation", "Second recommendation"],
        confidence: 0.72,
      },
    ];

    return {
      success: true,
      insights,
      contextUsed: {
        id: context.id,
        version: context.metadata.version,
      },
      metadata: {
        extractedAt: new Date().toISOString(),
        model: parameters.model || "default",
        extractedBy: parameters.user || "system",
      },
    };
  }

  /**
   * Execute the syncWithRepository operation
   * @param {object} context - The context to sync
   * @param {object} parameters - Additional parameters
   * @returns {Promise<object>} The result of the operation
   */
  async executeSyncWithRepository(context, parameters = {}) {
    this.logger.info(`Syncing context ${context.id} with repository`);

    // Placeholder for actual repository sync
    // In a real implementation, this would sync the context with an external repository

    return {
      success: true,
      syncStatus: "complete",
      syncedTo: parameters.repository || "default",
      syncTimestamp: new Date().toISOString(),
      contextUsed: {
        id: context.id,
        version: context.metadata.version,
      },
    };
  }
}

export default MCPApiHandlers;
