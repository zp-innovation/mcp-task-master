import { FastMCP } from "fastmcp";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger } from "../../scripts/modules/utils.js";
import MCPAuth from "./auth.js";
import MCPApiHandlers from "./api-handlers.js";
import ContextManager from "./context-manager.js";

// Load environment variables
dotenv.config();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PORT = process.env.MCP_SERVER_PORT || 3000;
const DEFAULT_HOST = process.env.MCP_SERVER_HOST || "localhost";

/**
 * Main MCP server class that integrates with Task Master
 */
class TaskMasterMCPServer {
  constructor(options = {}) {
    this.options = {
      name: "Task Master MCP Server",
      version: process.env.PROJECT_VERSION || "1.0.0",
      ...options,
    };

    this.server = new FastMCP(this.options);
    this.expressApp = null;
    this.initialized = false;
    this.auth = new MCPAuth();
    this.contextManager = new ContextManager();

    // Bind methods
    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);

    // Setup logging
    this.logger = logger;
  }

  /**
   * Initialize the MCP server with necessary tools and routes
   */
  async init() {
    if (this.initialized) return;

    this.logger.info("Initializing Task Master MCP server...");

    // Set up express for additional customization if needed
    this.expressApp = express();
    this.expressApp.use(cors());
    this.expressApp.use(helmet());
    this.expressApp.use(express.json());

    // Set up authentication middleware
    this.setupAuthentication();

    // Register API handlers
    this.apiHandlers = new MCPApiHandlers(this.server);

    // Register additional task master specific tools
    this.registerTaskMasterTools();

    this.initialized = true;
    this.logger.info("Task Master MCP server initialized successfully");

    return this;
  }

  /**
   * Set up authentication for the MCP server
   */
  setupAuthentication() {
    // Add a health check endpoint that doesn't require authentication
    this.expressApp.get("/health", (req, res) => {
      res.status(200).json({
        status: "ok",
        service: this.options.name,
        version: this.options.version,
      });
    });

    // Add an authenticate endpoint to get a JWT token using an API key
    this.expressApp.post("/auth/token", async (req, res) => {
      const apiKey = req.headers["x-api-key"];

      if (!apiKey) {
        return res.status(401).json({
          success: false,
          error: "API key is required",
        });
      }

      const keyDetails = this.auth.validateApiKey(apiKey);

      if (!keyDetails) {
        return res.status(401).json({
          success: false,
          error: "Invalid API key",
        });
      }

      const token = this.auth.generateToken(keyDetails.id, keyDetails.role);

      res.status(200).json({
        success: true,
        token,
        expiresIn: process.env.MCP_JWT_EXPIRATION || "24h",
        clientId: keyDetails.id,
        role: keyDetails.role,
      });
    });

    // Create authenticator middleware for FastMCP
    this.server.setAuthenticator((request) => {
      // Get token from Authorization header
      const authHeader = request.headers?.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
      }

      const token = authHeader.split(" ")[1];
      const payload = this.auth.verifyToken(token);

      if (!payload) {
        return null;
      }

      return {
        clientId: payload.clientId,
        role: payload.role,
      };
    });

    // Set up a protected route for API key management (admin only)
    this.expressApp.post(
      "/auth/api-keys",
      (req, res, next) => {
        this.auth.authenticateToken(req, res, next);
      },
      (req, res, next) => {
        this.auth.authorizeRoles(["admin"])(req, res, next);
      },
      async (req, res) => {
        const { clientId, role } = req.body;

        if (!clientId) {
          return res.status(400).json({
            success: false,
            error: "Client ID is required",
          });
        }

        try {
          const apiKey = await this.auth.createApiKey(clientId, role || "user");

          res.status(201).json({
            success: true,
            apiKey,
            clientId,
            role: role || "user",
          });
        } catch (error) {
          this.logger.error(`Error creating API key: ${error.message}`);

          res.status(500).json({
            success: false,
            error: "Failed to create API key",
          });
        }
      }
    );

    this.logger.info("Set up MCP authentication");
  }

  /**
   * Register Task Master specific tools with the MCP server
   */
  registerTaskMasterTools() {
    // Add a tool to get tasks from Task Master
    this.server.addTool({
      name: "listTasks",
      description: "List all tasks from Task Master",
      parameters: z.object({
        status: z.string().optional().describe("Filter tasks by status"),
        withSubtasks: z
          .boolean()
          .optional()
          .describe("Include subtasks in the response"),
      }),
      execute: async (args) => {
        try {
          // In a real implementation, this would use the Task Master API
          // to fetch tasks. For now, returning mock data.

          this.logger.info(
            `Listing tasks with filters: ${JSON.stringify(args)}`
          );

          // Mock task data
          const tasks = [
            {
              id: 1,
              title: "Implement Task Data Structure",
              status: "done",
              dependencies: [],
              priority: "high",
            },
            {
              id: 2,
              title: "Develop Command Line Interface Foundation",
              status: "done",
              dependencies: [1],
              priority: "high",
            },
            {
              id: 23,
              title: "Implement MCP Server Functionality",
              status: "in-progress",
              dependencies: [22],
              priority: "medium",
              subtasks: [
                {
                  id: "23.1",
                  title: "Create Core MCP Server Module",
                  status: "in-progress",
                  dependencies: [],
                },
                {
                  id: "23.2",
                  title: "Implement Context Management System",
                  status: "pending",
                  dependencies: ["23.1"],
                },
              ],
            },
          ];

          // Apply status filter if provided
          let filteredTasks = tasks;
          if (args.status) {
            filteredTasks = tasks.filter((task) => task.status === args.status);
          }

          // Remove subtasks if not requested
          if (!args.withSubtasks) {
            filteredTasks = filteredTasks.map((task) => {
              const { subtasks, ...taskWithoutSubtasks } = task;
              return taskWithoutSubtasks;
            });
          }

          return { success: true, tasks: filteredTasks };
        } catch (error) {
          this.logger.error(`Error listing tasks: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    // Add a tool to get task details
    this.server.addTool({
      name: "getTaskDetails",
      description: "Get detailed information about a specific task",
      parameters: z.object({
        taskId: z
          .union([z.number(), z.string()])
          .describe("The ID of the task to get details for"),
      }),
      execute: async (args) => {
        try {
          // In a real implementation, this would use the Task Master API
          // to fetch task details. For now, returning mock data.

          this.logger.info(`Getting details for task ${args.taskId}`);

          // Mock task details
          const taskDetails = {
            id: 23,
            title: "Implement MCP Server Functionality",
            description:
              "Extend Task Master to function as an MCP server, allowing it to provide context management services to other applications.",
            status: "in-progress",
            dependencies: [22],
            priority: "medium",
            details:
              "This task involves implementing the Model Context Protocol server capabilities within Task Master.",
            testStrategy:
              "Testing should include unit tests, integration tests, and compatibility tests.",
            subtasks: [
              {
                id: "23.1",
                title: "Create Core MCP Server Module",
                status: "in-progress",
                dependencies: [],
              },
              {
                id: "23.2",
                title: "Implement Context Management System",
                status: "pending",
                dependencies: ["23.1"],
              },
            ],
          };

          return { success: true, task: taskDetails };
        } catch (error) {
          this.logger.error(`Error getting task details: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    });

    this.logger.info("Registered Task Master specific tools");
  }

  /**
   * Start the MCP server
   */
  async start({ port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
    if (!this.initialized) {
      await this.init();
    }

    this.logger.info(
      `Starting Task Master MCP server on http://${host}:${port}`
    );

    // Start the FastMCP server
    await this.server.start({
      port,
      host,
      transportType: "sse",
      expressApp: this.expressApp,
    });

    this.logger.info(
      `Task Master MCP server running at http://${host}:${port}`
    );

    return this;
  }

  /**
   * Stop the MCP server
   */
  async stop() {
    if (this.server) {
      this.logger.info("Stopping Task Master MCP server...");
      await this.server.stop();
      this.logger.info("Task Master MCP server stopped");
    }
  }
}

export default TaskMasterMCPServer;
