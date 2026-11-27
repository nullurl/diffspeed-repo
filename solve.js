// Fast line diff whose run(input) returns exactly makefun-diff 1.0.0's patch for
// { old, new }: the same edit script and the same patch text, computed with
// integer line ids and flat typed arrays instead of per-path objects.
// The rule, from the competition: cut lines after every "\n"; keep the common
// prefix, then the common suffix of what is left; between them Myers's greedy
// search, keeping on each diagonal the path furthest into the old text, the
// deletion winning when deletion and insertion reach the same point, never
// moving past either text's end, and following every run of equal lines as far
// as it goes; the first path to reach both ends is the script.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const lines = new Array(last + 1);
  let n = 0;
  for (let i = 0; i < last; i++) lines[n++] = parts[i] + '\n';
  if (parts[last] !== '') lines[n++] = parts[last];
  lines.length = n;
  return lines;
}

/** Intern both line lists to integer ids so line equality is an integer compare. */
function intern(a, b) {
  const map = new Map();
  const A = new Int32Array(a.length);
  const B = new Int32Array(b.length);
  let next = 0;
  for (let i = 0; i < a.length; i++) {
    let id = map.get(a[i]);
    if (id === undefined) { id = next++; map.set(a[i], id); }
    A[i] = id;
  }
  for (let i = 0; i < b.length; i++) {
    let id = map.get(b[i]);
    if (id === undefined) { id = next++; map.set(b[i], id); }
    B[i] = id;
  }
  return [A, B];
}

/**
 * The edit script of A into B as [{ kind, count }] in order, by the rule above.
 * Forward pass keeps, for each depth d, the furthest old-lines-consumed x on
 * every diagonal k = x - y; the walk back from the first reaching path rebuilds
 * the runs. x is stored as the lines consumed (0-based count), so a diagonal's
 * candidate from k-1 deletes (x+1) and from k+1 inserts (x unchanged).
 */
function editRuns(A, B) {
  const n = A.length;
  const m = B.length;
  if (n === 0 && m === 0) return [];
  const use16 = n < 65536 && m < 65536;
  const Arr = use16 ? Uint16Array : Int32Array;
  const SENT = use16 ? 0xffff : -1;
  const rows = [];
  let x0 = 0;
  while (x0 < n && x0 < m && A[x0] === B[x0]) x0++;
  const v0 = new Arr(1);
  v0[0] = x0;
  rows.push(v0);
  if (x0 === n && x0 === m) return [{ kind: KEEP, count: n }];
  let dFinal = -1;
  let kFinal = 0;
  const maxD = n + m;
  for (let d = 1; d <= maxD; d++) {
    const vd = new Arr(2 * d + 1);
    vd.fill(SENT);
    const prev = rows[d - 1];
    const pm = d - 1;
    const plen = prev.length;
    for (let k = -d; k <= d; k += 2) {
      let xDel = -1;
      let xIns = -1;
      const ki1 = k - 1 + pm;
      if (ki1 >= 0 && ki1 < plen) {
        const px = prev[ki1];
        if (px !== SENT && px < n) xDel = px + 1;
      }
      const ki2 = k + 1 + pm;
      if (ki2 >= 0 && ki2 < plen) {
        const px = prev[ki2];
        if (px !== SENT && px - 1 - k < m) xIns = px;
      }
      let xNew;
      if (xDel >= 0 && (xIns < 0 || xDel >= xIns)) xNew = xDel;
      else if (xIns >= 0) xNew = xIns;
      else continue;
      let yNew = xNew - k;
      while (xNew < n && yNew < m && A[xNew] === B[yNew]) { xNew++; yNew++; }
      vd[k + d] = xNew;
      if (xNew >= n && yNew >= m) { dFinal = d; kFinal = k; break; }
    }
    rows.push(vd);
    if (dFinal >= 0) break;
  }
  if (dFinal < 0) throw new Error('makefun-diff: the search ended without reaching both ends');
  const runs = [];
  let d = dFinal;
  let k = kFinal;
  let x = n;
  while (d > 0) {
    const prev = rows[d - 1];
    const pm = d - 1;
    const plen = prev.length;
    let xDel = -1;
    let xIns = -1;
    const ki1 = k - 1 + pm;
    if (ki1 >= 0 && ki1 < plen) {
      const px = prev[ki1];
      if (px !== SENT && px < n) xDel = px + 1;
    }
    const ki2 = k + 1 + pm;
    if (ki2 >= 0 && ki2 < plen) {
      const px = prev[ki2];
      if (px !== SENT && px - 1 - k < m) xIns = px;
    }
    let isDel;
    if (xDel >= 0 && (xIns < 0 || xDel >= xIns)) isDel = true;
    else if (xIns >= 0) isDel = false;
    else throw new Error('makefun-diff: the walk back found no step');
    const xPre = isDel ? xDel : xIns;
    const keep = x - xPre;
    if (keep > 0) runs.push({ kind: KEEP, count: keep });
    runs.push({ kind: isDel ? DELETE : INSERT, count: 1 });
    if (isDel) { k = k - 1; x = xPre - 1; } else { k = k + 1; x = xPre; }
    d--;
  }
  if (x > 0) runs.push({ kind: KEEP, count: x });
  runs.reverse();
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** makefun-diff 1.0.0's patch of input.old into input.new. */
export function run(input) {
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;
  const [A, B] = intern(a, b);
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(A.subarray(prefix, n - suffix), B.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }

  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
