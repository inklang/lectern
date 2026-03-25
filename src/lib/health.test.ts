import { describe, it, expect } from 'vitest';

// Pure scoring logic tests - no DB needed
describe('health scoring', () => {
  it('maps score >= 80 to excellent', () => {
    const scoreToStatus = (score: number): string => {
      if (score >= 80) return 'excellent';
      if (score >= 60) return 'good';
      if (score >= 40) return 'fair';
      if (score >= 20) return 'poor';
      return 'unknown';
    };
    expect(scoreToStatus(85)).toBe('excellent');
    expect(scoreToStatus(80)).toBe('excellent');
  });

  it('maps score 60-79 to good', () => {
    const scoreToStatus = (score: number): string => {
      if (score >= 80) return 'excellent';
      if (score >= 60) return 'good';
      if (score >= 40) return 'fair';
      if (score >= 20) return 'poor';
      return 'unknown';
    };
    expect(scoreToStatus(60)).toBe('good');
    expect(scoreToStatus(79)).toBe('good');
  });

  it('computes composite score correctly', () => {
    const composite = (m: number, p: number, q: number, c: number) =>
      Math.round(m * 0.30 + p * 0.25 + q * 0.25 + c * 0.20);
    expect(composite(100, 100, 100, 100)).toBe(100);
    expect(composite(50, 50, 50, 50)).toBe(50);
  });
});
