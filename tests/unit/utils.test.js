/**
 * Utils module tests
 */

import { truncate } from '../../scripts/modules/utils.js';

describe('Utils Module', () => {
  describe('truncate function', () => {
    test('should return the original string if shorter than maxLength', () => {
      const result = truncate('Hello', 10);
      expect(result).toBe('Hello');
    });

    test('should truncate the string and add ellipsis if longer than maxLength', () => {
      const result = truncate('This is a long string that needs truncation', 20);
      expect(result).toBe('This is a long st...');
    });

    test('should handle empty string', () => {
      const result = truncate('', 10);
      expect(result).toBe('');
    });

    test('should return null when input is null', () => {
      const result = truncate(null, 10);
      expect(result).toBe(null);
    });

    test('should return undefined when input is undefined', () => {
      const result = truncate(undefined, 10);
      expect(result).toBe(undefined);
    });

    test('should handle maxLength of 0 or negative', () => {
      // When maxLength is 0, slice(0, -3) returns 'He'
      const result1 = truncate('Hello', 0);
      expect(result1).toBe('He...');
      
      // When maxLength is negative, slice(0, -8) returns nothing
      const result2 = truncate('Hello', -5);
      expect(result2).toBe('...');
    });
  });
}); 