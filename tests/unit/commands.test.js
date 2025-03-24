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
  log: jest.fn()
}));

// Import after mocking
import { setupCLI } from '../../scripts/modules/commands.js';
import { program } from 'commander';
import fs from 'fs';
import path from 'path';

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
}); 