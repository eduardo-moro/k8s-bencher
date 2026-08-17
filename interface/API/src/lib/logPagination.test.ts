import { describe, it, expect } from 'vitest';
import { paginateLog } from './logPagination.js';

function linesText(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i}`).join('\n') + '\n';
}

describe('paginateLog', () => {
  it('returns the last N lines when before is omitted (first load / live tail)', () => {
    expect(paginateLog(linesText(10), undefined, 4)).toEqual({
      lines: ['line 6', 'line 7', 'line 8', 'line 9'],
      hasMore: true,
      startIndex: 6,
    });
  });

  it('walking pages via the returned startIndex reaches the start with no gaps or overlap', () => {
    const text = linesText(10);
    const page1 = paginateLog(text, undefined, 4);
    expect(page1).toEqual({ lines: ['line 6', 'line 7', 'line 8', 'line 9'], hasMore: true, startIndex: 6 });

    const page2 = paginateLog(text, page1.startIndex, 4);
    expect(page2).toEqual({ lines: ['line 2', 'line 3', 'line 4', 'line 5'], hasMore: true, startIndex: 2 });

    const page3 = paginateLog(text, page2.startIndex, 4);
    expect(page3).toEqual({ lines: ['line 0', 'line 1'], hasMore: false, startIndex: 0 });
  });

  it('a fixed before stays stable even as the file grows between requests (the actual bug)', () => {
    // Page 1 fetched while the file has 10 lines.
    const page1 = paginateLog(linesText(10), undefined, 5);
    expect(page1).toEqual({ lines: ['line 5', 'line 6', 'line 7', 'line 8', 'line 9'], hasMore: true, startIndex: 5 });

    // The file grows to 13 lines (3 more appended) before the next request.
    // Re-requesting with the SAME startIndex must resolve to the exact same
    // slice as it would have against the original 10-line file - not shift
    // just because the file is now longer.
    const grown = linesText(13);
    const page2 = paginateLog(grown, page1.startIndex, 5);
    expect(page2).toEqual({ lines: ['line 0', 'line 1', 'line 2', 'line 3', 'line 4'], hasMore: false, startIndex: 0 });
  });

  it('omitting before always tracks the live tail, growth included', () => {
    const before = paginateLog(linesText(10), undefined, 4);
    expect(before.lines).toEqual(['line 6', 'line 7', 'line 8', 'line 9']);

    const after = paginateLog(linesText(13), undefined, 4);
    expect(after.lines).toEqual(['line 9', 'line 10', 'line 11', 'line 12']);
  });

  it('hasMore is false once a page reaches the start of the file', () => {
    expect(paginateLog(linesText(10), 2, 4)).toEqual({ lines: ['line 0', 'line 1'], hasMore: false, startIndex: 0 });
  });

  it('a limit larger than the whole file returns everything with hasMore false', () => {
    expect(paginateLog(linesText(10), undefined, 1000)).toEqual({
      lines: Array.from({ length: 10 }, (_, i) => `line ${i}`),
      hasMore: false,
      startIndex: 0,
    });
  });

  it('returns empty for an empty file', () => {
    expect(paginateLog('', undefined, 10)).toEqual({ lines: [], hasMore: false, startIndex: 0 });
  });

  it('ignores the bogus trailing empty line a final newline produces', () => {
    expect(paginateLog('a\nb\n', undefined, 10)).toEqual({ lines: ['a', 'b'], hasMore: false, startIndex: 0 });
  });
});
