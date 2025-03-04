/**
 * Claude Task Master
 * A task management system for AI-driven development with Claude
 */

// This file serves as the main entry point for the package
// The primary functionality is provided through the CLI commands

// Export the path to the dev.js script for programmatic usage
exports.devScriptPath = require.resolve('./scripts/dev.js');

// Export a function to initialize a new project programmatically
exports.initProject = async (options = {}) => {
  const init = require('./scripts/init');
  return init.initializeProject(options);
};

// Export version information
exports.version = require('./package.json').version; 