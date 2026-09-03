// Lightweight "is this the same task?" check for de-duplicating AI-extracted
// tasks against what's already on the calendar.

const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'at', 'on', 'in', 'her', 'his', 'their', 'my', 'get', 'go', 'do', 'take', 'please']);

function tokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

// Jaccard overlap of the significant words in two titles (0–1).
function titleSimilarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function minutesOf(timeStr) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Find an existing task that looks like a duplicate of `candidate`.
 * @param {{title,date,time}} candidate
 * @param {{id,title,date,time,assignee}[]} existing
 * @returns the matching existing task, or null
 */
export function findDuplicateTask(candidate, existing = []) {
  const cMin = minutesOf(candidate.time);
  for (const t of existing) {
    if (!t || t.date !== candidate.date) continue; // must be the same day
    const sim = titleSimilarity(candidate.title, t.title);
    if (sim < 0.6) continue; // titles not similar enough

    const tMin = minutesOf(t.time);
    // both timeless, or both timed and within 2 hours of each other
    const timeClose =
      (cMin === null && tMin === null) ||
      (cMin !== null && tMin !== null && Math.abs(cMin - tMin) <= 120);
    if (timeClose) return t;
  }
  return null;
}
