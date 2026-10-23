import { describe, it, expect } from 'vitest';
import { plainError } from './plainError';

describe('plainError', () => {
  it('drops the class name JavaScript puts in front of a message', () => {
    expect(plainError(new Error('Zoom is not connected.'))).toBe('Zoom is not connected.');
    expect(plainError('ZoomError: Zoom is not connected.')).toBe('Zoom is not connected.');
    expect(plainError(new Error('LeadSquaredError: Access Key is not set'))).toBe('Access Key is not set');
    expect(plainError(String(new TypeError('x is not a function')))).toBe('x is not a function');
  });

  it('leaves a message that merely mentions an error alone', () => {
    expect(plainError('Zoom returned an Error: 401')).toBe('Zoom returned an Error: 401');
  });

  it('falls back to a plain sentence when there is nothing to say', () => {
    expect(plainError(undefined)).toBe('Something went wrong.');
    expect(plainError(new Error(''))).toBe('Something went wrong.');
    expect(plainError(null, 'Could not sync.')).toBe('Could not sync.');
  });
});
