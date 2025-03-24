import { logger } from "../../scripts/modules/utils.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Fuse from "fuse.js";

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTEXT_DIR =
  process.env.MCP_CONTEXT_DIR || path.join(__dirname, "../contexts");
const MAX_CONTEXT_HISTORY = parseInt(
  process.env.MCP_MAX_CONTEXT_HISTORY || "10",
  10
);

/**
 * Context Manager for MCP server
 * Handles storage, retrieval, and manipulation of context data
 * Implements efficient indexing, versioning, and advanced context operations
 */
class ContextManager {
  constructor() {
    this.contexts = new Map();
    this.contextHistory = new Map(); // For version history
    this.contextIndex = null; // For fuzzy search
    this.logger = logger;
    this.ensureContextDir();
    this.rebuildSearchIndex();
  }

  /**
   * Ensure the contexts directory exists
   */
  async ensureContextDir() {
    try {
      await fs.mkdir(CONTEXT_DIR, { recursive: true });
      this.logger.info(`Context directory ensured at ${CONTEXT_DIR}`);

      // Also create a versions subdirectory for history
      await fs.mkdir(path.join(CONTEXT_DIR, "versions"), { recursive: true });
    } catch (error) {
      this.logger.error(`Failed to create context directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Rebuild the search index for efficient context lookup
   */
  async rebuildSearchIndex() {
    await this.loadAllContextsFromDisk();

    const contextsForIndex = Array.from(this.contexts.values()).map((ctx) => ({
      id: ctx.id,
      content:
        typeof ctx.data === "string" ? ctx.data : JSON.stringify(ctx.data),
      tags: ctx.tags.join(" "),
      metadata: Object.entries(ctx.metadata)
        .map(([k, v]) => `${k}:${v}`)
        .join(" "),
    }));

    this.contextIndex = new Fuse(contextsForIndex, {
      keys: ["id", "content", "tags", "metadata"],
      includeScore: true,
      threshold: 0.6,
    });

    this.logger.info(
      `Rebuilt search index with ${contextsForIndex.length} contexts`
    );
  }

  /**
   * Create a new context
   * @param {string} contextId - Unique identifier for the context
   * @param {object|string} contextData - Initial context data
   * @param {object} metadata - Optional metadata for the context
   * @returns {object} The created context
   */
  async createContext(contextId, contextData, metadata = {}) {
    if (this.contexts.has(contextId)) {
      throw new Error(`Context with ID ${contextId} already exists`);
    }

    const timestamp = new Date().toISOString();
    const versionId = this.generateVersionId();

    const context = {
      id: contextId,
      data: contextData,
      metadata: {
        created: timestamp,
        updated: timestamp,
        version: versionId,
        ...metadata,
      },
      tags: metadata.tags || [],
      size: this.estimateSize(contextData),
    };

    this.contexts.set(contextId, context);

    // Initialize version history
    this.contextHistory.set(contextId, [
      {
        versionId,
        timestamp,
        data: JSON.parse(JSON.stringify(contextData)), // Deep clone
        metadata: { ...context.metadata },
      },
    ]);

    await this.persistContext(contextId);
    await this.persistContextVersion(contextId, versionId);

    // Update the search index
    this.rebuildSearchIndex();

    this.logger.info(`Created context: ${contextId} (version: ${versionId})`);
    return context;
  }

  /**
   * Retrieve a context by ID
   * @param {string} contextId - The context ID to retrieve
   * @param {string} versionId - Optional specific version to retrieve
   * @returns {object} The context object
   */
  async getContext(contextId, versionId = null) {
    // If specific version requested, try to get it from history
    if (versionId) {
      return this.getContextVersion(contextId, versionId);
    }

    // Try to get from memory first
    if (this.contexts.has(contextId)) {
      return this.contexts.get(contextId);
    }

    // Try to load from disk
    try {
      const context = await this.loadContextFromDisk(contextId);
      if (context) {
        this.contexts.set(contextId, context);
        return context;
      }
    } catch (error) {
      this.logger.error(
        `Failed to load context ${contextId}: ${error.message}`
      );
    }

    throw new Error(`Context with ID ${contextId} not found`);
  }

  /**
   * Get a specific version of a context
   * @param {string} contextId - The context ID
   * @param {string} versionId - The version ID
   * @returns {object} The versioned context
   */
  async getContextVersion(contextId, versionId) {
    // Check if version history is in memory
    if (this.contextHistory.has(contextId)) {
      const history = this.contextHistory.get(contextId);
      const version = history.find((v) => v.versionId === versionId);
      if (version) {
        return {
          id: contextId,
          data: version.data,
          metadata: version.metadata,
          tags: version.metadata.tags || [],
          size: this.estimateSize(version.data),
          versionId: version.versionId,
        };
      }
    }

    // Try to load from disk
    try {
      const versionPath = path.join(
        CONTEXT_DIR,
        "versions",
        `${contextId}_${versionId}.json`
      );
      const data = await fs.readFile(versionPath, "utf8");
      const version = JSON.parse(data);

      // Add to memory cache
      if (!this.contextHistory.has(contextId)) {
        this.contextHistory.set(contextId, []);
      }
      const history = this.contextHistory.get(contextId);
      history.push(version);

      return {
        id: contextId,
        data: version.data,
        metadata: version.metadata,
        tags: version.metadata.tags || [],
        size: this.estimateSize(version.data),
        versionId: version.versionId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to load context version ${contextId}@${versionId}: ${error.message}`
      );
      throw new Error(
        `Context version ${versionId} for ${contextId} not found`
      );
    }
  }

  /**
   * Update an existing context
   * @param {string} contextId - The context ID to update
   * @param {object|string} contextData - New context data
   * @param {object} metadata - Optional metadata updates
   * @param {boolean} createNewVersion - Whether to create a new version
   * @returns {object} The updated context
   */
  async updateContext(
    contextId,
    contextData,
    metadata = {},
    createNewVersion = true
  ) {
    const context = await this.getContext(contextId);
    const timestamp = new Date().toISOString();

    // Generate a new version ID if requested
    const versionId = createNewVersion
      ? this.generateVersionId()
      : context.metadata.version;

    // Create a backup of the current state for versioning
    if (createNewVersion) {
      // Store the current version in history
      if (!this.contextHistory.has(contextId)) {
        this.contextHistory.set(contextId, []);
      }

      const history = this.contextHistory.get(contextId);

      // Add current state to history
      history.push({
        versionId: context.metadata.version,
        timestamp: context.metadata.updated,
        data: JSON.parse(JSON.stringify(context.data)), // Deep clone
        metadata: { ...context.metadata },
      });

      // Trim history if it exceeds the maximum size
      if (history.length > MAX_CONTEXT_HISTORY) {
        const excessVersions = history.splice(
          0,
          history.length - MAX_CONTEXT_HISTORY
        );
        // Clean up excess versions from disk
        for (const version of excessVersions) {
          this.removeContextVersionFile(contextId, version.versionId).catch(
            (err) =>
              this.logger.error(
                `Failed to remove old version file: ${err.message}`
              )
          );
        }
      }

      // Persist version
      await this.persistContextVersion(contextId, context.metadata.version);
    }

    // Update the context
    context.data = contextData;
    context.metadata = {
      ...context.metadata,
      ...metadata,
      updated: timestamp,
    };

    if (createNewVersion) {
      context.metadata.version = versionId;
      context.metadata.previousVersion = context.metadata.version;
    }

    if (metadata.tags) {
      context.tags = metadata.tags;
    }

    // Update size estimate
    context.size = this.estimateSize(contextData);

    this.contexts.set(contextId, context);
    await this.persistContext(contextId);

    // Update the search index
    this.rebuildSearchIndex();

    this.logger.info(`Updated context: ${contextId} (version: ${versionId})`);
    return context;
  }

  /**
   * Delete a context and all its versions
   * @param {string} contextId - The context ID to delete
   * @returns {boolean} True if deletion was successful
   */
  async deleteContext(contextId) {
    if (!this.contexts.has(contextId)) {
      const contextPath = path.join(CONTEXT_DIR, `${contextId}.json`);
      try {
        await fs.access(contextPath);
      } catch (error) {
        throw new Error(`Context with ID ${contextId} not found`);
      }
    }

    this.contexts.delete(contextId);

    // Remove from history
    const history = this.contextHistory.get(contextId) || [];
    this.contextHistory.delete(contextId);

    try {
      // Delete main context file
      const contextPath = path.join(CONTEXT_DIR, `${contextId}.json`);
      await fs.unlink(contextPath);

      // Delete all version files
      for (const version of history) {
        await this.removeContextVersionFile(contextId, version.versionId);
      }

      // Update the search index
      this.rebuildSearchIndex();

      this.logger.info(`Deleted context: ${contextId}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to delete context files for ${contextId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * List all available contexts with pagination and advanced filtering
   * @param {object} options - Options for listing contexts
   * @param {object} options.filters - Filters to apply
   * @param {number} options.limit - Maximum number of contexts to return
   * @param {number} options.offset - Number of contexts to skip
   * @param {string} options.sortBy - Field to sort by
   * @param {string} options.sortDirection - Sort direction ('asc' or 'desc')
   * @param {string} options.query - Free text search query
   * @returns {Array} Array of context objects
   */
  async listContexts(options = {}) {
    // Load all contexts from disk first
    await this.loadAllContextsFromDisk();

    const {
      filters = {},
      limit = 100,
      offset = 0,
      sortBy = "updated",
      sortDirection = "desc",
      query = "",
    } = options;

    let contexts;

    // If there's a search query, use the search index
    if (query && this.contextIndex) {
      const searchResults = this.contextIndex.search(query);
      contexts = searchResults.map((result) =>
        this.contexts.get(result.item.id)
      );
    } else {
      contexts = Array.from(this.contexts.values());
    }

    // Apply filters
    if (filters.tag) {
      contexts = contexts.filter(
        (ctx) => ctx.tags && ctx.tags.includes(filters.tag)
      );
    }

    if (filters.metadataKey && filters.metadataValue) {
      contexts = contexts.filter(
        (ctx) =>
          ctx.metadata &&
          ctx.metadata[filters.metadataKey] === filters.metadataValue
      );
    }

    if (filters.createdAfter) {
      const timestamp = new Date(filters.createdAfter);
      contexts = contexts.filter(
        (ctx) => new Date(ctx.metadata.created) >= timestamp
      );
    }

    if (filters.updatedAfter) {
      const timestamp = new Date(filters.updatedAfter);
      contexts = contexts.filter(
        (ctx) => new Date(ctx.metadata.updated) >= timestamp
      );
    }

    // Apply sorting
    contexts.sort((a, b) => {
      let valueA, valueB;

      if (sortBy === "created" || sortBy === "updated") {
        valueA = new Date(a.metadata[sortBy]).getTime();
        valueB = new Date(b.metadata[sortBy]).getTime();
      } else if (sortBy === "size") {
        valueA = a.size || 0;
        valueB = b.size || 0;
      } else if (sortBy === "id") {
        valueA = a.id;
        valueB = b.id;
      } else {
        valueA = a.metadata[sortBy];
        valueB = b.metadata[sortBy];
      }

      if (valueA === valueB) return 0;

      const sortFactor = sortDirection === "asc" ? 1 : -1;
      return valueA < valueB ? -1 * sortFactor : 1 * sortFactor;
    });

    // Apply pagination
    const paginatedContexts = contexts.slice(offset, offset + limit);

    return {
      contexts: paginatedContexts,
      total: contexts.length,
      offset,
      limit,
      hasMore: offset + limit < contexts.length,
    };
  }

  /**
   * Get the version history of a context
   * @param {string} contextId - The context ID
   * @returns {Array} Array of version objects
   */
  async getContextHistory(contextId) {
    // Ensure context exists
    await this.getContext(contextId);

    // Load history if not in memory
    if (!this.contextHistory.has(contextId)) {
      await this.loadContextHistoryFromDisk(contextId);
    }

    const history = this.contextHistory.get(contextId) || [];

    // Return versions in reverse chronological order (newest first)
    return history.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });
  }

  /**
   * Add tags to a context
   * @param {string} contextId - The context ID
   * @param {Array} tags - Array of tags to add
   * @returns {object} The updated context
   */
  async addTags(contextId, tags) {
    const context = await this.getContext(contextId);

    const currentTags = context.tags || [];
    const uniqueTags = [...new Set([...currentTags, ...tags])];

    // Update context with new tags
    return this.updateContext(
      contextId,
      context.data,
      {
        tags: uniqueTags,
      },
      false
    ); // Don't create a new version for tag updates
  }

  /**
   * Remove tags from a context
   * @param {string} contextId - The context ID
   * @param {Array} tags - Array of tags to remove
   * @returns {object} The updated context
   */
  async removeTags(contextId, tags) {
    const context = await this.getContext(contextId);

    const currentTags = context.tags || [];
    const newTags = currentTags.filter((tag) => !tags.includes(tag));

    // Update context with new tags
    return this.updateContext(
      contextId,
      context.data,
      {
        tags: newTags,
      },
      false
    ); // Don't create a new version for tag updates
  }

  /**
   * Handle context windowing and truncation
   * @param {string} contextId - The context ID
   * @param {number} maxSize - Maximum size in tokens/chars
   * @param {string} strategy - Truncation strategy ('start', 'end', 'middle')
   * @returns {object} The truncated context
   */
  async truncateContext(contextId, maxSize, strategy = "end") {
    const context = await this.getContext(contextId);
    const contextText =
      typeof context.data === "string"
        ? context.data
        : JSON.stringify(context.data);

    if (contextText.length <= maxSize) {
      return context; // No truncation needed
    }

    let truncatedData;

    switch (strategy) {
      case "start":
        truncatedData = contextText.slice(contextText.length - maxSize);
        break;
      case "middle":
        const halfSize = Math.floor(maxSize / 2);
        truncatedData =
          contextText.slice(0, halfSize) +
          "...[truncated]..." +
          contextText.slice(contextText.length - halfSize);
        break;
      case "end":
      default:
        truncatedData = contextText.slice(0, maxSize);
        break;
    }

    // If original data was an object, try to parse the truncated data
    // Otherwise use it as a string
    let updatedData;
    if (typeof context.data === "object") {
      try {
        // This may fail if truncation broke JSON structure
        updatedData = {
          ...context.data,
          truncated: true,
          truncation_strategy: strategy,
          original_size: contextText.length,
          truncated_size: truncatedData.length,
        };
      } catch (error) {
        updatedData = truncatedData;
      }
    } else {
      updatedData = truncatedData;
    }

    // Update with truncated data
    return this.updateContext(
      contextId,
      updatedData,
      {
        truncated: true,
        truncation_strategy: strategy,
        original_size: contextText.length,
        truncated_size: truncatedData.length,
      },
      true
    ); // Create a new version for the truncated data
  }

  /**
   * Merge multiple contexts into a new context
   * @param {Array} contextIds - Array of context IDs to merge
   * @param {string} newContextId - ID for the new merged context
   * @param {object} metadata - Optional metadata for the new context
   * @returns {object} The new merged context
   */
  async mergeContexts(contextIds, newContextId, metadata = {}) {
    if (contextIds.length === 0) {
      throw new Error("At least one context ID must be provided for merging");
    }

    if (this.contexts.has(newContextId)) {
      throw new Error(`Context with ID ${newContextId} already exists`);
    }

    // Load all contexts to be merged
    const contextsToMerge = [];
    for (const id of contextIds) {
      try {
        const context = await this.getContext(id);
        contextsToMerge.push(context);
      } catch (error) {
        this.logger.error(
          `Could not load context ${id} for merging: ${error.message}`
        );
        throw new Error(`Failed to merge contexts: ${error.message}`);
      }
    }

    // Check data types and decide how to merge
    const allStrings = contextsToMerge.every((c) => typeof c.data === "string");
    const allObjects = contextsToMerge.every(
      (c) => typeof c.data === "object" && c.data !== null
    );

    let mergedData;

    if (allStrings) {
      // Merge strings with newlines between them
      mergedData = contextsToMerge.map((c) => c.data).join("\n\n");
    } else if (allObjects) {
      // Merge objects by combining their properties
      mergedData = {};
      for (const context of contextsToMerge) {
        mergedData = { ...mergedData, ...context.data };
      }
    } else {
      // Convert everything to strings and concatenate
      mergedData = contextsToMerge
        .map((c) =>
          typeof c.data === "string" ? c.data : JSON.stringify(c.data)
        )
        .join("\n\n");
    }

    // Collect all tags from merged contexts
    const allTags = new Set();
    for (const context of contextsToMerge) {
      for (const tag of context.tags || []) {
        allTags.add(tag);
      }
    }

    // Create merged metadata
    const mergedMetadata = {
      ...metadata,
      tags: [...allTags],
      merged_from: contextIds,
      merged_at: new Date().toISOString(),
    };

    // Create the new merged context
    return this.createContext(newContextId, mergedData, mergedMetadata);
  }

  /**
   * Persist a context to disk
   * @param {string} contextId - The context ID to persist
   * @returns {Promise<void>}
   */
  async persistContext(contextId) {
    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error(`Context with ID ${contextId} not found`);
    }

    const contextPath = path.join(CONTEXT_DIR, `${contextId}.json`);
    try {
      await fs.writeFile(contextPath, JSON.stringify(context, null, 2), "utf8");
      this.logger.debug(`Persisted context ${contextId} to disk`);
    } catch (error) {
      this.logger.error(
        `Failed to persist context ${contextId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Persist a context version to disk
   * @param {string} contextId - The context ID
   * @param {string} versionId - The version ID
   * @returns {Promise<void>}
   */
  async persistContextVersion(contextId, versionId) {
    if (!this.contextHistory.has(contextId)) {
      throw new Error(`Context history for ${contextId} not found`);
    }

    const history = this.contextHistory.get(contextId);
    const version = history.find((v) => v.versionId === versionId);

    if (!version) {
      throw new Error(`Version ${versionId} of context ${contextId} not found`);
    }

    const versionPath = path.join(
      CONTEXT_DIR,
      "versions",
      `${contextId}_${versionId}.json`
    );
    try {
      await fs.writeFile(versionPath, JSON.stringify(version, null, 2), "utf8");
      this.logger.debug(
        `Persisted context version ${contextId}@${versionId} to disk`
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist context version ${contextId}@${versionId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Remove a context version file from disk
   * @param {string} contextId - The context ID
   * @param {string} versionId - The version ID
   * @returns {Promise<void>}
   */
  async removeContextVersionFile(contextId, versionId) {
    const versionPath = path.join(
      CONTEXT_DIR,
      "versions",
      `${contextId}_${versionId}.json`
    );
    try {
      await fs.unlink(versionPath);
      this.logger.debug(
        `Removed context version file ${contextId}@${versionId}`
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.error(
          `Failed to remove context version file ${contextId}@${versionId}: ${error.message}`
        );
        throw error;
      }
    }
  }

  /**
   * Load a context from disk
   * @param {string} contextId - The context ID to load
   * @returns {Promise<object>} The loaded context
   */
  async loadContextFromDisk(contextId) {
    const contextPath = path.join(CONTEXT_DIR, `${contextId}.json`);
    try {
      const data = await fs.readFile(contextPath, "utf8");
      const context = JSON.parse(data);
      this.logger.debug(`Loaded context ${contextId} from disk`);
      return context;
    } catch (error) {
      this.logger.error(
        `Failed to load context ${contextId} from disk: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Load context history from disk
   * @param {string} contextId - The context ID
   * @returns {Promise<Array>} The loaded history
   */
  async loadContextHistoryFromDisk(contextId) {
    try {
      const files = await fs.readdir(path.join(CONTEXT_DIR, "versions"));
      const versionFiles = files.filter(
        (file) => file.startsWith(`${contextId}_`) && file.endsWith(".json")
      );

      const history = [];

      for (const file of versionFiles) {
        try {
          const data = await fs.readFile(
            path.join(CONTEXT_DIR, "versions", file),
            "utf8"
          );
          const version = JSON.parse(data);
          history.push(version);
        } catch (error) {
          this.logger.error(
            `Failed to load context version file ${file}: ${error.message}`
          );
        }
      }

      this.contextHistory.set(contextId, history);
      this.logger.debug(
        `Loaded ${history.length} versions for context ${contextId}`
      );

      return history;
    } catch (error) {
      this.logger.error(
        `Failed to load context history for ${contextId}: ${error.message}`
      );
      this.contextHistory.set(contextId, []);
      return [];
    }
  }

  /**
   * Load all contexts from disk
   * @returns {Promise<void>}
   */
  async loadAllContextsFromDisk() {
    try {
      const files = await fs.readdir(CONTEXT_DIR);
      const contextFiles = files.filter((file) => file.endsWith(".json"));

      for (const file of contextFiles) {
        const contextId = path.basename(file, ".json");
        if (!this.contexts.has(contextId)) {
          try {
            const context = await this.loadContextFromDisk(contextId);
            this.contexts.set(contextId, context);
          } catch (error) {
            // Already logged in loadContextFromDisk
          }
        }
      }

      this.logger.info(`Loaded ${this.contexts.size} contexts from disk`);
    } catch (error) {
      this.logger.error(`Failed to load contexts from disk: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a unique version ID
   * @returns {string} A unique version ID
   */
  generateVersionId() {
    return crypto.randomBytes(8).toString("hex");
  }

  /**
   * Estimate the size of context data
   * @param {object|string} data - The context data
   * @returns {number} Estimated size in bytes
   */
  estimateSize(data) {
    if (typeof data === "string") {
      return Buffer.byteLength(data, "utf8");
    }

    if (typeof data === "object" && data !== null) {
      return Buffer.byteLength(JSON.stringify(data), "utf8");
    }

    return 0;
  }
}

export default ContextManager;
