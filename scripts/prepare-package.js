#!/usr/bin/env node

/**
 * This script prepares the package for publication to NPM.
 * It ensures all necessary files are included and properly configured.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define colors for console output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Log function with color support
function log(level, ...args) {
  const prefix = {
    info: `${COLORS.blue}[INFO]${COLORS.reset}`,
    warn: `${COLORS.yellow}[WARN]${COLORS.reset}`,
    error: `${COLORS.red}[ERROR]${COLORS.reset}`,
    success: `${COLORS.green}[SUCCESS]${COLORS.reset}`
  }[level.toLowerCase()];
  
  console.log(prefix, ...args);
}

// Function to check if a file exists
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Function to ensure a file is executable
function ensureExecutable(filePath) {
  try {
    fs.chmodSync(filePath, '755');
    log('info', `Made ${filePath} executable`);
  } catch (error) {
    log('error', `Failed to make ${filePath} executable:`, error.message);
    return false;
  }
  return true;
}

// Function to sync template files
function syncTemplateFiles() {
  // We no longer need to sync files since we're using them directly
  log('info', 'Template syncing has been deprecated - using source files directly');
  return true;
}

// Main function to prepare the package
function preparePackage() {
  const rootDir = path.join(__dirname, '..');
  log('info', `Preparing package in ${rootDir}`);
  
  // Check for required files
  const requiredFiles = [
    'package.json',
    'README.md',
    'index.js',
    'scripts/init.js',
    'scripts/dev.js',
    'assets/env.example',
    'assets/gitignore',
    'assets/example_prd.txt',
    '.cursor/rules/dev_workflow.mdc'
  ];
  
  let allFilesExist = true;
  for (const file of requiredFiles) {
    const filePath = path.join(rootDir, file);
    if (!fileExists(filePath)) {
      log('error', `Required file ${file} does not exist`);
      allFilesExist = false;
    }
  }
  
  if (!allFilesExist) {
    log('error', 'Some required files are missing. Package preparation failed.');
    process.exit(1);
  }
  
  // Ensure scripts are executable
  const executableScripts = [
    'scripts/init.js',
    'scripts/dev.js'
  ];
  
  let allScriptsExecutable = true;
  for (const script of executableScripts) {
    const scriptPath = path.join(rootDir, script);
    if (!ensureExecutable(scriptPath)) {
      allScriptsExecutable = false;
    }
  }
  
  if (!allScriptsExecutable) {
    log('warn', 'Some scripts could not be made executable. This may cause issues.');
  }
  
  // Run npm pack to test package creation
  try {
    log('info', 'Running npm pack to test package creation...');
    const output = execSync('npm pack --dry-run', { cwd: rootDir }).toString();
    log('info', output);
  } catch (error) {
    log('error', 'Failed to run npm pack:', error.message);
    process.exit(1);
  }
  
  // Make scripts executable
  log('info', 'Making scripts executable...');
  try {
    execSync('chmod +x scripts/init.js', { stdio: 'ignore' });
    log('info', 'Made scripts/init.js executable');
    execSync('chmod +x scripts/dev.js', { stdio: 'ignore' });
    log('info', 'Made scripts/dev.js executable');
  } catch (error) {
    log('error', 'Failed to make scripts executable:', error.message);
  }
  
  log('success', 'Package preparation completed successfully!');
  log('info', 'You can now publish the package with:');
  log('info', '  npm publish');
}

// Run the preparation
preparePackage(); 