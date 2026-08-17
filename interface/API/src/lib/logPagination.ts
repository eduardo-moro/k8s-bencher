export interface LogPage {
  lines: string[];
  hasMore: boolean;
  // Absolute 0-based index of the first returned line. The caller passes
  // this back as `before` to fetch the preceding page - see the note below
  // on why this has to be an absolute index, not a count from the end.
  startIndex: number;
}

// Windows a log file by absolute line index, tail-first. `before` (omitted
// on first load) is the absolute index to page backwards from; omitting it
// means "the current end of the file", i.e. the live tail.
//
// This file keeps growing while a combo is still running (the sampler
// appends every ~10s). A "before = N lines from the end" scheme breaks
// under that: the client's already-loaded page was sliced against the
// file's *old*, smaller length, so by the time it asks for "the 500 lines
// before what I have" against the *new*, larger length, that request
// resolves to a different, overlapping slice - the same lines get
// re-fetched and re-prepended, which reads as the log "repeating".
// Anchoring to an absolute index and capping it with min() against the
// current total sidesteps that: old line indices never shift as new lines
// are appended, so a page fetched with the same `before` always resolves
// to the same slice regardless of how much the file has grown since.
export function paginateLog(text: string, before: number | undefined, limit: number): LogPage {
  if (!text) return { lines: [], hasMore: false, startIndex: 0 };

  const allLines = text.split(/\r?\n/);
  // A trailing newline produces one bogus empty "line" at the end - not a
  // real log line, drop it so pagination counts match what a reader sees.
  if (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();

  const end = before !== undefined ? Math.min(before, allLines.length) : allLines.length;
  const start = Math.max(0, end - limit);
  return { lines: allLines.slice(start, end), hasMore: start > 0, startIndex: start };
}
