/**
 * Tests for kebab-case validation functionality
 */

import { jest } from '@jest/globals';

// Create a mock implementation of the helper function to avoid loading the entire module
jest.mock('../../bin/task-master.js', () => ({
  detectCamelCaseFlags: jest.requireActual('../../bin/task-master.js').detectCamelCaseFlags
}));

// Import the module after mocking - use dynamic import for ES modules
import { detectCamelCaseFlags } from '../../scripts/modules/utils.js';

describe('Kebab Case Validation', () => {
  test('should properly detect camelCase flags', () => {
    const args = ['node', 'task-master', 'add-task', '--promptText=test', '--userID=123'];
    const flags = detectCamelCaseFlags(args);
    
    expect(flags).toHaveLength(2);
    expect(flags).toContainEqual({
      original: 'promptText',
      kebabCase: 'prompt-text'
    });
    expect(flags).toContainEqual({
      original: 'userID',
      kebabCase: 'user-id'
    });
  });
  
  test('should not flag kebab-case or lowercase flags', () => {
    const args = ['node', 'task-master', 'add-task', '--prompt=test', '--user-id=123'];
    const flags = detectCamelCaseFlags(args);
    
    expect(flags).toHaveLength(0);
  });
  
  test('should not flag single-word lowercase flags', () => {
    const args = ['node', 'task-master', 'add-task', '--prompt="test"', '--file=file.json'];
    const flags = detectCamelCaseFlags(args);
    
    expect(flags).toHaveLength(0);
  });
}); 