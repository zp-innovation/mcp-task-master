/**
 * AI Services module tests
 */

import { jest } from '@jest/globals';
import { parseSubtasksFromText } from '../../scripts/modules/ai-services.js';

// Create a mock log function we can check later
const mockLog = jest.fn();

// Mock dependencies
jest.mock('@anthropic-ai/sdk', () => {
  return {
    Anthropic: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ text: 'AI response' }],
        }),
      },
    })),
  };
});

// Use jest.fn() directly for OpenAI mock
const mockOpenAIInstance = {
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Perplexity response' } }],
      }),
    },
  },
};
const mockOpenAI = jest.fn().mockImplementation(() => mockOpenAIInstance);

jest.mock('openai', () => {
  return { default: mockOpenAI };
});

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../../scripts/modules/utils.js', () => ({
  CONFIG: {
    model: 'claude-3-sonnet-20240229',
    temperature: 0.7,
    maxTokens: 4000,
  },
  log: mockLog,
  sanitizePrompt: jest.fn(text => text),
}));

jest.mock('../../scripts/modules/ui.js', () => ({
  startLoadingIndicator: jest.fn().mockReturnValue('mockLoader'),
  stopLoadingIndicator: jest.fn(),
}));

// Mock anthropic global object
global.anthropic = {
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [{ text: '[{"id": 1, "title": "Test", "description": "Test", "dependencies": [], "details": "Test"}]' }],
    }),
  },
};

// Mock process.env
const originalEnv = process.env;

describe('AI Services Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.PERPLEXITY_API_KEY = 'test-perplexity-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseSubtasksFromText function', () => {
    test('should parse subtasks from JSON text', () => {
      const text = `Here's your list of subtasks:
      
[
  {
    "id": 1,
    "title": "Implement database schema",
    "description": "Design and implement the database schema for user data",
    "dependencies": [],
    "details": "Create tables for users, preferences, and settings"
  },
  {
    "id": 2,
    "title": "Create API endpoints",
    "description": "Develop RESTful API endpoints for user operations",
    "dependencies": [],
    "details": "Implement CRUD operations for user management"
  }
]

These subtasks will help you implement the parent task efficiently.`;

      const result = parseSubtasksFromText(text, 1, 2, 5);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        title: 'Implement database schema',
        description: 'Design and implement the database schema for user data',
        status: 'pending',
        dependencies: [],
        details: 'Create tables for users, preferences, and settings',
        parentTaskId: 5
      });
      expect(result[1]).toEqual({
        id: 2,
        title: 'Create API endpoints',
        description: 'Develop RESTful API endpoints for user operations',
        status: 'pending',
        dependencies: [],
        details: 'Implement CRUD operations for user management',
        parentTaskId: 5
      });
    });

    test('should handle subtasks with dependencies', () => {
      const text = `
[
  {
    "id": 1,
    "title": "Setup React environment",
    "description": "Initialize React app with necessary dependencies",
    "dependencies": [],
    "details": "Use Create React App or Vite to set up a new project"
  },
  {
    "id": 2,
    "title": "Create component structure",
    "description": "Design and implement component hierarchy",
    "dependencies": [1],
    "details": "Organize components by feature and reusability"
  }
]`;

      const result = parseSubtasksFromText(text, 1, 2, 5);
      
      expect(result).toHaveLength(2);
      expect(result[0].dependencies).toEqual([]);
      expect(result[1].dependencies).toEqual([1]);
    });

    test('should handle complex dependency lists', () => {
      const text = `
[
  {
    "id": 1,
    "title": "Setup database",
    "description": "Initialize database structure",
    "dependencies": [],
    "details": "Set up PostgreSQL database"
  },
  {
    "id": 2,
    "title": "Create models",
    "description": "Implement data models",
    "dependencies": [1],
    "details": "Define Prisma models"
  },
  {
    "id": 3,
    "title": "Implement controllers",
    "description": "Create API controllers",
    "dependencies": [1, 2],
    "details": "Build controllers for all endpoints"
  }
]`;

      const result = parseSubtasksFromText(text, 1, 3, 5);
      
      expect(result).toHaveLength(3);
      expect(result[2].dependencies).toEqual([1, 2]);
    });

    test('should create fallback subtasks for empty text', () => {
      const emptyText = '';
      
      const result = parseSubtasksFromText(emptyText, 1, 2, 5);
      
      // Verify fallback subtasks structure
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        title: 'Subtask 1',
        description: 'Auto-generated fallback subtask',
        status: 'pending',
        dependencies: [],
        parentTaskId: 5
      });
      expect(result[1]).toMatchObject({
        id: 2,
        title: 'Subtask 2',
        description: 'Auto-generated fallback subtask',
        status: 'pending',
        dependencies: [],
        parentTaskId: 5
      });
    });

    test('should normalize subtask IDs', () => {
      const text = `
[
  {
    "id": 10,
    "title": "First task with incorrect ID",
    "description": "First description",
    "dependencies": [],
    "details": "First details"
  },
  {
    "id": 20,
    "title": "Second task with incorrect ID",
    "description": "Second description",
    "dependencies": [],
    "details": "Second details"
  }
]`;

      const result = parseSubtasksFromText(text, 1, 2, 5);
      
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1); // Should normalize to starting ID
      expect(result[1].id).toBe(2); // Should normalize to starting ID + 1
    });

    test('should convert string dependencies to numbers', () => {
      const text = `
[
  {
    "id": 1,
    "title": "First task",
    "description": "First description",
    "dependencies": [],
    "details": "First details"
  },
  {
    "id": 2,
    "title": "Second task",
    "description": "Second description",
    "dependencies": ["1"],
    "details": "Second details"
  }
]`;

      const result = parseSubtasksFromText(text, 1, 2, 5);
      
      expect(result[1].dependencies).toEqual([1]);
      expect(typeof result[1].dependencies[0]).toBe('number');
    });

    test('should create fallback subtasks for invalid JSON', () => {
      const text = `This is not valid JSON and cannot be parsed`;

      const result = parseSubtasksFromText(text, 1, 2, 5);
      
      // Verify fallback subtasks structure
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        title: 'Subtask 1',
        description: 'Auto-generated fallback subtask',
        status: 'pending',
        dependencies: [],
        parentTaskId: 5
      });
      expect(result[1]).toMatchObject({
        id: 2,
        title: 'Subtask 2',
        description: 'Auto-generated fallback subtask',
        status: 'pending',
        dependencies: [],
        parentTaskId: 5
      });
    });
  });
}); 