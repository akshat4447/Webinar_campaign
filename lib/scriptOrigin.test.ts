import { describe, it, expect } from 'vitest';
import { scriptOriginProblem } from './scriptOrigin';

describe('scriptOriginProblem', () => {
  it('accepts a public https address, and says nothing when there is no address yet', () => {
    expect(scriptOriginProblem('https://studio.example.com')).toBeNull();
    expect(scriptOriginProblem('https://hair-formerly-ear-sail.trycloudflare.com')).toBeNull();
    expect(scriptOriginProblem(undefined)).toBeNull();
    expect(scriptOriginProblem('')).toBeNull();
  });

  it('flags an address visitors cannot reach', () => {
    for (const bad of ['http://localhost:3000', 'https://localhost', 'http://127.0.0.1:3000', 'http://192.168.1.20:3000', 'http://10.0.0.5', 'http://172.20.1.1', 'https://studio.local', 'http://[::1]:3000']) {
      expect(scriptOriginProblem(bad), bad).toMatch(/cannot reach/);
    }
  });

  it('flags a public address that is not https, because a published https page cannot post to it', () => {
    expect(scriptOriginProblem('http://studio.example.com')).toMatch(/not https/);
  });

  it('flags something that is not a web address', () => {
    expect(scriptOriginProblem('not a url')).toMatch(/not a valid web address/);
  });
});
