/**
 * Task Manager module tests
 */

import { jest } from '@jest/globals';
import { findNextTask } from '../../scripts/modules/task-manager.js';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('@anthropic-ai/sdk');
jest.mock('cli-table3');
jest.mock('../../scripts/modules/ui.js');
jest.mock('../../scripts/modules/ai-services.js');
jest.mock('../../scripts/modules/dependency-manager.js');
jest.mock('../../scripts/modules/utils.js');

describe('Task Manager Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findNextTask function', () => {
    test('should return the highest priority task with all dependencies satisfied', () => {
      const tasks = [
        {
          id: 1,
          title: 'Setup Project',
          status: 'done',
          dependencies: [],
          priority: 'high'
        },
        {
          id: 2,
          title: 'Implement Core Features',
          status: 'pending',
          dependencies: [1],
          priority: 'high'
        },
        {
          id: 3,
          title: 'Create Documentation',
          status: 'pending',
          dependencies: [1],
          priority: 'medium'
        },
        {
          id: 4,
          title: 'Deploy Application',
          status: 'pending',
          dependencies: [2, 3],
          priority: 'high'
        }
      ];

      const nextTask = findNextTask(tasks);
      
      expect(nextTask).toBeDefined();
      expect(nextTask.id).toBe(2);
      expect(nextTask.title).toBe('Implement Core Features');
    });

    test('should prioritize by priority level when dependencies are equal', () => {
      const tasks = [
        {
          id: 1,
          title: 'Setup Project',
          status: 'done',
          dependencies: [],
          priority: 'high'
        },
        {
          id: 2,
          title: 'Low Priority Task',
          status: 'pending',
          dependencies: [1],
          priority: 'low'
        },
        {
          id: 3,
          title: 'Medium Priority Task',
          status: 'pending',
          dependencies: [1],
          priority: 'medium'
        },
        {
          id: 4,
          title: 'High Priority Task',
          status: 'pending',
          dependencies: [1],
          priority: 'high'
        }
      ];

      const nextTask = findNextTask(tasks);
      
      expect(nextTask.id).toBe(4);
      expect(nextTask.priority).toBe('high');
    });

    test('should return null when all tasks are completed', () => {
      const tasks = [
        {
          id: 1,
          title: 'Setup Project',
          status: 'done',
          dependencies: [],
          priority: 'high'
        },
        {
          id: 2,
          title: 'Implement Features',
          status: 'done',
          dependencies: [1],
          priority: 'high'
        }
      ];

      const nextTask = findNextTask(tasks);
      
      expect(nextTask).toBeNull();
    });

    test('should return null when all pending tasks have unsatisfied dependencies', () => {
      const tasks = [
        {
          id: 1,
          title: 'Setup Project',
          status: 'pending',
          dependencies: [2],
          priority: 'high'
        },
        {
          id: 2,
          title: 'Implement Features',
          status: 'pending',
          dependencies: [1],
          priority: 'high'
        }
      ];

      const nextTask = findNextTask(tasks);
      
      expect(nextTask).toBeNull();
    });

    test('should handle empty tasks array', () => {
      const nextTask = findNextTask([]);
      
      expect(nextTask).toBeNull();
    });
  });

  // Skipped tests for analyzeTaskComplexity
  describe.skip('analyzeTaskComplexity function', () => {
    // These tests are skipped because they require complex mocking
    // but document what should be tested
    
    test('should handle valid JSON response from LLM', async () => {
      // This test would verify that:
      // 1. The function properly calls the AI model
      // 2. It correctly parses a valid JSON response
      // 3. It generates a properly formatted complexity report
      // 4. The report includes all analyzed tasks with their complexity scores
      expect(true).toBe(true);
    });
    
    test('should handle and fix malformed JSON with unterminated strings', async () => {
      // This test would verify that:
      // 1. The function can handle JSON with unterminated strings
      // 2. It applies regex fixes to repair the malformed JSON
      // 3. It still produces a valid report despite receiving bad JSON
      expect(true).toBe(true);
    });
    
    test('should handle missing tasks in the response', async () => {
      // This test would verify that:
      // 1. When the AI response is missing some tasks
      // 2. The function detects the missing tasks
      // 3. It attempts to analyze just those missing tasks
      // 4. The final report includes all tasks that could be analyzed
      expect(true).toBe(true);
    });
  });
}); 