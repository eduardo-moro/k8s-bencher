import { describe, it, expect } from 'vitest';
import { parseRestartsLog } from './restartEvents.js';

describe('parseRestartsLog', () => {
  it('parses timestamped restart events with their reason', () => {
    const log =
      '2026-08-12T20:51:14.850Z\t1\tOOMKilled\n' + '2026-08-12T20:55:03.120Z\t2\tError\n';
    expect(parseRestartsLog(log)).toEqual([
      { timestampMs: Date.parse('2026-08-12T20:51:14.850Z'), restartCount: 1, reason: 'OOMKilled' },
      { timestampMs: Date.parse('2026-08-12T20:55:03.120Z'), restartCount: 2, reason: 'Error' },
    ]);
  });

  it('skips unparseable lines', () => {
    const log = 'garbage line\n2026-08-12T20:51:14.850Z\t1\tOOMKilled\n';
    expect(parseRestartsLog(log)).toEqual([
      { timestampMs: Date.parse('2026-08-12T20:51:14.850Z'), restartCount: 1, reason: 'OOMKilled' },
    ]);
  });

  it('returns an empty array for an empty log', () => {
    expect(parseRestartsLog('')).toEqual([]);
  });
});
