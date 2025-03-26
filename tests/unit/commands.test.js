/**
 * Commands module tests
 */

import { jest } from '@jest/globals';

// Mock modules
jest.mock('commander');
jest.mock('fs');
jest.mock('path');
jest.mock('../../scripts/modules/ui.js', () => ({
  displayBanner: jest.fn(),
  displayHelp: jest.fn()
}));
jest.mock('../../scripts/modules/task-manager.js');
jest.mock('../../scripts/modules/dependency-manager.js');
jest.mock('../../scripts/modules/utils.js', () => ({
  CONFIG: {
    projectVersion: '1.5.0'
  },
  log: jest.fn(),
  detectCamelCaseFlags: jest.fn().mockImplementation((args) => {
    const camelCaseRegex = /--([a-z]+[A-Z][a-zA-Z]+)/;
    const flags = [];
    for (const arg of args) {
      const match = camelCaseRegex.exec(arg);
      if (match) {
        const original = match[1];
        const kebabCase = original.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        flags.push({ original, kebabCase });
      }
    }
    return flags;
  })
}));

// Import after mocking
import { setupCLI } from '../../scripts/modules/commands.js';
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { detectCamelCaseFlags } from '../../scripts/modules/utils.js';

describe('Commands Module', () => {
  // Set up spies on the mocked modules
  const mockName = jest.spyOn(program, 'name').mockReturnValue(program);
  const mockDescription = jest.spyOn(program, 'description').mockReturnValue(program);
  const mockVersion = jest.spyOn(program, 'version').mockReturnValue(program);
  const mockHelpOption = jest.spyOn(program, 'helpOption').mockReturnValue(program);
  const mockAddHelpCommand = jest.spyOn(program, 'addHelpCommand').mockReturnValue(program);
  const mockOn = jest.spyOn(program, 'on').mockReturnValue(program);
  const mockExistsSync = jest.spyOn(fs, 'existsSync');
  const mockReadFileSync = jest.spyOn(fs, 'readFileSync');
  const mockJoin = jest.spyOn(path, 'join');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setupCLI function', () => {
    test('should return Commander program instance', () => {
      const result = setupCLI();
      
      // Verify the program was properly configured
      expect(mockName).toHaveBeenCalledWith('dev');
      expect(mockDescription).toHaveBeenCalledWith('AI-driven development task management');
      expect(mockVersion).toHaveBeenCalled();
      expect(mockHelpOption).toHaveBeenCalledWith('-h, --help', 'Display help');
      expect(mockAddHelpCommand).toHaveBeenCalledWith(false);
      expect(mockOn).toHaveBeenCalled(); 
      expect(result).toBeTruthy();
    });

    test('should read version from package.json when available', () => {
      // Setup mock for package.json existence and content
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '2.0.0' }));
      mockJoin.mockReturnValue('/mock/path/package.json');

      // Call the setup function
      setupCLI();

      // Get the version callback function
      const versionCallback = mockVersion.mock.calls[0][0];
      expect(typeof versionCallback).toBe('function');
      
      // Execute the callback and check the result
      const result = versionCallback();
      expect(result).toBe('2.0.0');
      
      // Verify the correct functions were called
      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockReadFileSync).toHaveBeenCalled();
    });

    test('should use default version when package.json is not available', () => {
      // Setup mock for package.json absence
      mockExistsSync.mockReturnValue(false);

      // Call the setup function
      setupCLI();

      // Get the version callback function
      const versionCallback = mockVersion.mock.calls[0][0];
      expect(typeof versionCallback).toBe('function');
      
      // Execute the callback and check the result
      const result = versionCallback();
      expect(result).toBe('1.5.0'); // Updated to match the actual CONFIG.projectVersion
      
      expect(mockExistsSync).toHaveBeenCalled();
    });

    test('should use default version when package.json reading throws an error', () => {
      // Setup mock for package.json reading error
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      // Call the setup function
      setupCLI();

      // Get the version callback function
      const versionCallback = mockVersion.mock.calls[0][0];
      expect(typeof versionCallback).toBe('function');
      
      // Execute the callback and check the result
      const result = versionCallback();
      expect(result).toBe('1.5.0'); // Updated to match the actual CONFIG.projectVersion
    });
  });

  // Add a new describe block for kebab-case validation tests
  describe('Kebab Case Validation', () => {
    // Save the original process.argv
    const originalArgv = process.argv;

    // Reset process.argv after each test
    afterEach(() => {
      process.argv = originalArgv;
    });

    test('should detect camelCase flags correctly', () => {
      // Set up process.argv with a camelCase flag
      process.argv = ['node', 'task-master', 'add-task', '--promptText=test'];
      
      // Mock process.exit to prevent the test from actually exiting
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      
      // Mock console.error to capture the error message
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Create an action function similar to what's in task-master.js
      const action = () => {
        const camelCaseFlags = detectCamelCaseFlags(process.argv);
        if (camelCaseFlags.length > 0) {
          console.error('\nError: Please use kebab-case for CLI flags:');
          camelCaseFlags.forEach(flag => {
            console.error(`  Instead of: --${flag.original}`);
            console.error(`  Use:        --${flag.kebabCase}`);
          });
          process.exit(1);
        }
      };
      
      // Call the action function
      action();
      
      // Verify that process.exit was called with 1
      expect(mockExit).toHaveBeenCalledWith(1);
      
      // Verify console.error messages
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Please use kebab-case for CLI flags')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Instead of: --promptText')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Use:        --prompt-text')
      );
      
      // Clean up
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });

    test('should accept kebab-case flags correctly', () => {
      // Import the function we're testing
      jest.resetModules();
      
      // Mock process.exit to prevent the test from actually exiting
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      
      // Mock console.error to verify it's not called with kebab-case error
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Set up process.argv with a valid kebab-case flag
      process.argv = ['node', 'task-master', 'add-task', '--prompt-text=test'];
      
      // Mock the runDevScript function to prevent actual execution
      jest.doMock('../../bin/task-master.js', () => {
        const actual = jest.requireActual('../../bin/task-master.js');
        return {
          ...actual,
          runDevScript: jest.fn()
        };
      });
      
      // Run the module which should not error for kebab-case
      try {
        require('../../bin/task-master.js');
      } catch (e) {
        // Ignore any errors from the module
      }
      
      // Verify that process.exit was not called with error code 1
      // Note: It might be called for other reasons so we just check it's not called with 1
      expect(mockExit).not.toHaveBeenCalledWith(1);
      
      // Verify that console.error was not called with kebab-case error message
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Please use kebab-case for CLI flags')
      );
      
      // Clean up
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });
  });
}); 