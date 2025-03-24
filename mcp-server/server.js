#!/usr/bin/env node

import TaskMasterMCPServer from "./src/index.js";
import dotenv from "dotenv";
import { logger } from "../scripts/modules/utils.js";

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.MCP_SERVER_PORT || 3000;
const HOST = process.env.MCP_SERVER_HOST || "localhost";

/**
 * Start the MCP server
 */
async function startServer() {
  const server = new TaskMasterMCPServer();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully...");
    await server.stop();
    process.exit(0);
  });

  try {
    await server.start({ port: PORT, host: HOST });
    logger.info(`MCP server running at http://${HOST}:${PORT}`);
    logger.info("Press Ctrl+C to stop");
  } catch (error) {
    logger.error(`Failed to start MCP server: ${error.message}`);
    process.exit(1);
  }
}

// Start the server
startServer();
