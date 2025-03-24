import jwt from "jsonwebtoken";
import { logger } from "../../scripts/modules/utils.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_KEYS_FILE =
  process.env.MCP_API_KEYS_FILE || path.join(__dirname, "../api-keys.json");
const JWT_SECRET =
  process.env.MCP_JWT_SECRET || "task-master-mcp-server-secret";
const JWT_EXPIRATION = process.env.MCP_JWT_EXPIRATION || "24h";

/**
 * Authentication middleware and utilities for MCP server
 */
class MCPAuth {
  constructor() {
    this.apiKeys = new Map();
    this.logger = logger;
    this.loadApiKeys();
  }

  /**
   * Load API keys from disk
   */
  async loadApiKeys() {
    try {
      // Create API keys file if it doesn't exist
      try {
        await fs.access(API_KEYS_FILE);
      } catch (error) {
        // File doesn't exist, create it with a default admin key
        const defaultApiKey = this.generateApiKey();
        const defaultApiKeys = {
          keys: [
            {
              id: "admin",
              key: defaultApiKey,
              role: "admin",
              created: new Date().toISOString(),
            },
          ],
        };

        await fs.mkdir(path.dirname(API_KEYS_FILE), { recursive: true });
        await fs.writeFile(
          API_KEYS_FILE,
          JSON.stringify(defaultApiKeys, null, 2),
          "utf8"
        );

        this.logger.info(
          `Created default API keys file with admin key: ${defaultApiKey}`
        );
      }

      // Load API keys
      const data = await fs.readFile(API_KEYS_FILE, "utf8");
      const apiKeys = JSON.parse(data);

      apiKeys.keys.forEach((key) => {
        this.apiKeys.set(key.key, {
          id: key.id,
          role: key.role,
          created: key.created,
        });
      });

      this.logger.info(`Loaded ${this.apiKeys.size} API keys`);
    } catch (error) {
      this.logger.error(`Failed to load API keys: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save API keys to disk
   */
  async saveApiKeys() {
    try {
      const keys = [];

      this.apiKeys.forEach((value, key) => {
        keys.push({
          id: value.id,
          key,
          role: value.role,
          created: value.created,
        });
      });

      await fs.writeFile(
        API_KEYS_FILE,
        JSON.stringify({ keys }, null, 2),
        "utf8"
      );

      this.logger.info(`Saved ${keys.length} API keys`);
    } catch (error) {
      this.logger.error(`Failed to save API keys: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a new API key
   * @returns {string} The generated API key
   */
  generateApiKey() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Create a new API key
   * @param {string} id - Client identifier
   * @param {string} role - Client role (admin, user)
   * @returns {string} The generated API key
   */
  async createApiKey(id, role = "user") {
    const apiKey = this.generateApiKey();

    this.apiKeys.set(apiKey, {
      id,
      role,
      created: new Date().toISOString(),
    });

    await this.saveApiKeys();

    this.logger.info(`Created new API key for ${id} with role ${role}`);
    return apiKey;
  }

  /**
   * Revoke an API key
   * @param {string} apiKey - The API key to revoke
   * @returns {boolean} True if the key was revoked
   */
  async revokeApiKey(apiKey) {
    if (!this.apiKeys.has(apiKey)) {
      return false;
    }

    this.apiKeys.delete(apiKey);
    await this.saveApiKeys();

    this.logger.info(`Revoked API key`);
    return true;
  }

  /**
   * Validate an API key
   * @param {string} apiKey - The API key to validate
   * @returns {object|null} The API key details if valid, null otherwise
   */
  validateApiKey(apiKey) {
    return this.apiKeys.get(apiKey) || null;
  }

  /**
   * Generate a JWT token for a client
   * @param {string} clientId - Client identifier
   * @param {string} role - Client role
   * @returns {string} The JWT token
   */
  generateToken(clientId, role) {
    return jwt.sign({ clientId, role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRATION,
    });
  }

  /**
   * Verify a JWT token
   * @param {string} token - The JWT token to verify
   * @returns {object|null} The token payload if valid, null otherwise
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      this.logger.error(`Failed to verify token: ${error.message}`);
      return null;
    }
  }

  /**
   * Express middleware for API key authentication
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   * @param {function} next - Express next function
   */
  authenticateApiKey(req, res, next) {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API key is required",
      });
    }

    const keyDetails = this.validateApiKey(apiKey);

    if (!keyDetails) {
      return res.status(401).json({
        success: false,
        error: "Invalid API key",
      });
    }

    // Attach client info to request
    req.client = {
      id: keyDetails.id,
      role: keyDetails.role,
    };

    next();
  }

  /**
   * Express middleware for JWT authentication
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   * @param {function} next - Express next function
   */
  authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication token is required",
      });
    }

    const payload = this.verifyToken(token);

    if (!payload) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
    }

    // Attach client info to request
    req.client = {
      id: payload.clientId,
      role: payload.role,
    };

    next();
  }

  /**
   * Express middleware for role-based authorization
   * @param {Array} roles - Array of allowed roles
   * @returns {function} Express middleware
   */
  authorizeRoles(roles) {
    return (req, res, next) => {
      if (!req.client || !req.client.role) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: Authentication required",
        });
      }

      if (!roles.includes(req.client.role)) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: Insufficient permissions",
        });
      }

      next();
    };
  }
}

export default MCPAuth;
