// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) { this.line = line; }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) { this.code = code; this.path = path; }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function tierKey(line: string, tier: number): string {
  if (tier === 0) return line;
  if (tier === 1) return line.replace(/[ \t]+$/, '');
  return line.trim();
}

function findMatch(fileLines: string[], oldLines: string[], tier: number): number[] {
  if (oldLines.length === 0) return [];
  const keys = oldLines.map(l => tierKey(l, tier));
  const matches: number[] = [];
  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (tierKey(fileLines[i + j], tier) !== keys[j]) { ok = false; break; }
    }
    if (ok) matches.push(i);
  }
  return matches;
}

function applyMatch(fileLines: string[], oldLines: string[], newLines: string[], matchIdx: number, tier: number): string[] {
  const oldKey = tierKey(oldLines[0], tier);
  let F = '';
  let P = '';
  if (tier === 2) {
    const fLine = fileLines[matchIdx];
    const pLine = oldLines[0];
    F = fLine.match(/^[ \t]*/)?.[0] ?? '';
    P = pLine.match(/^[ \t]*/)?.[0] ?? '';
  }
  const out: string[] = [];
  for (let i = 0; i < fileLines.length; i++) {
    if (i === matchIdx) {
      for (const nl of newLines) {
        if (tier === 2 && nl !== '' && !/^[ \t]*$/.test(nl) && nl.startsWith(P)) {
          out.push(F + nl.slice(P.length));
        } else {
          out.push(nl);
        }
      }
      i += oldLines.length - 1;
    } else {
      out.push(fileLines[i]);
    }
  }
  return out;
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try { if (statSync(p).isFile()) v = readFileSync(p, 'utf8'); } catch { v = null; }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null { return this.now.has(p) ? this.now.get(p)! : this.original(p); }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try { v = JSON.parse(text); } catch { throw new Exit2(`error: parse ${first + 1}`); }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try { e = jsonEdit(JSON.parse(l)); } catch { e = null; }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

// ============================================================================
// SECTION 5: Matching lines at three tiers
// ============================================================================

// Handled by findMatch and applyMatch above

// ============================================================================
// SECTION 6: Unified diffs
// ============================================================================

interface UnifiedSection {
  oldPath: string | null;
  newPath: string | null;
  isCreate: boolean;
  isDelete: boolean;
  hunks: UnifiedHunk[];
  lineNum: number;
}

interface UnifiedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string[];
  lineNum: number;
}

function parseUnified(text: string, lines: string[]): UnifiedSection[] {
  const sections: UnifiedSection[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('diff --git ')) { i++; continue; }
    const headerLine = line;
    i++;
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let isCreate = false;
    let isDelete = false;
    let inHeader = true;
    while (i < lines.length && inHeader) {
      const l = lines[i];
      if (l.startsWith('--- ')) {
        oldPath = l.slice(4).split('\t')[0].trim();
        if (oldPath.startsWith('a/')) oldPath = oldPath.slice(2);
        if (oldPath === '/dev/null') { isCreate = true; oldPath = null; }
      } else if (l.startsWith('+++ ')) {
        newPath = l.slice(4).split('\t')[0].trim();
        if (newPath.startsWith('b/')) newPath = newPath.slice(2);
        if (newPath === '/dev/null') { isDelete = true; newPath = null; }
      } else if (l.startsWith('rename from ')) {
        oldPath = l.slice(12).trim();
      } else if (l.startsWith('rename to ')) {
        newPath = l.slice(10).trim();
      } else if (l.startsWith('new file mode')) {
        isCreate = true;
      } else if (l.startsWith('deleted file mode')) {
        isDelete = true;
      } else if (l.startsWith('diff --git ') || l.startsWith('--- ') && (lines[i+1] ?? '').startsWith('+++ ')) {
        // Next section
        inHeader = false;
        continue;
      } else if (l.startsWith('@@ ')) {
        inHeader = false;
        continue;
      }
      i++;
    }
    if (oldPath === null && newPath === null) {
      // Use diff --git paths
      const m = headerLine.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (m) { oldPath = m[1]; newPath = m[2]; }
    }
    // Parse hunks
    const hunks: UnifiedHunk[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.startsWith('@@ ')) break;
      const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      const oldStart = parseInt(m[1], 10);
      const oldLines = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newLines = m[4] ? parseInt(m[4], 10) : 1;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const bl = lines[i];
        if (bl.startsWith('@@ ') || bl.startsWith('diff --git ') || (bl.startsWith('--- ') && (lines[i+1] ?? '').startsWith('+++ '))) break;
        if (/^[ \-\+\\]/.test(bl) || bl === '') {
          body.push(bl);
        } else {
          break;
        }
        i++;
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, body, lineNum: i });
    }
    sections.push({ oldPath, newPath, isCreate, isDelete, hunks, lineNum: i });
  }
  return sections;
}

function unifiedEdits(text: string, lines: string[]): Edit[] {
  const sections = parseUnified(text, lines);
  const edits: Edit[] = [];
  for (const sec of sections) {
    const oldP = sec.oldPath;
    const newP = sec.newPath;
    if (sec.isCreate && sec.isDelete) throw new Exit2(`error: parse ${sec.lineNum}`);
    const targetPath = newP ?? oldP;
    if (targetPath === null || !safe(targetPath)) throw new Exit2(`error: parse ${sec.lineNum}`);
    if (sec.isCreate) {
      if (sec.hunks.length === 0) throw new Exit2(`error: parse ${sec.lineNum}`);
      const newLines: string[] = [];
      for (const h of sec.hunks) {
        for (const bl of h.body) {
          if (bl.startsWith('+')) newLines.push(bl.slice(1));
          else if (bl.startsWith(' ')) newLines.push(bl.slice(1));
          else if (bl.startsWith('-')) throw new Exit2(`error: parse ${h.lineNum}`);
        }
      }
      edits.push((tree) => {
        if (!safe(targetPath!)) throw new Fail('unsafe', targetPath!);
        if (tree.get(targetPath!) !== null) throw new Fail('exists', targetPath!);
        tree.now.set(targetPath!, newLines.join('\n') + '\n');
      });
    } else if (sec.isDelete) {
      edits.push((tree) => {
        if (!safe(targetPath!)) throw new Fail('unsafe', targetPath!);
        if (tree.get(targetPath!) === null) throw new Fail('missing', targetPath!);
        tree.now.set(targetPath!, null);
      });
    } else if (oldP !== newP) {
      // Move
      edits.push((tree) => {
        if (!safe(oldP!) || !safe(newP!)) throw new Fail('unsafe', oldP!);
        if (tree.get(oldP!) === null) throw new Fail('missing', oldP!);
        if (tree.get(newP!) !== null) throw new Fail('exists', newP!);
        const content = tree.get(oldP!);
        let fileLines = content!.split('\n');
        if (content!.endsWith('\n')) fileLines.pop();
        for (const h of sec.hunks) {
          const oldLines: string[] = [];
          const newLines: string[] = [];
          for (const bl of h.body) {
            if (bl.startsWith(' ') || bl.startsWith('-')) oldLines.push(bl.slice(1));
            if (bl.startsWith(' ') || bl.startsWith('+')) newLines.push(bl.slice(1));
          }
          let d = 0;
          for (const h2 of sec.hunks) {
            const o2 = h2.body.filter(b => b.startsWith(' ') || b.startsWith('-')).length;
            const n2 = h2.body.filter(b => b.startsWith(' ') || b.startsWith('+')).length;
            if (h2 === h) break;
            d += n2 - o2;
          }
          const A = h.oldStart;
          let tier = 0;
          let matches: number[] = [];
          while (tier <= 2 && matches.length === 0) {
            matches = findMatch(fileLines, oldLines, tier);
            tier++;
          }
          tier--;
          if (matches.length === 0) throw new Fail('no-match', oldP!);
          let idx = matches[0];
          if (matches.length > 1) {
            const target = A - 1 + d;
            idx = matches.reduce((best, m) => Math.abs(m - target) < Math.abs(best - target) ? m : best);
          }
          fileLines = applyMatch(fileLines, oldLines, newLines, idx, tier);
        }
        tree.now.set(oldP!, null);
        tree.now.set(newP!, fileLines.join('\n') + (content!.endsWith('\n') ? '\n' : ''));
      });
    } else {
      // Change
      edits.push((tree) => {
        if (!safe(targetPath!)) throw new Fail('unsafe', targetPath!);
        const before = tree.get(targetPath!);
        if (before === null) throw new Fail('missing', targetPath!);
        let fileLines = before.split('\n');
        if (before.endsWith('\n')) fileLines.pop();
        let d = 0;
        for (const h of sec.hunks) {
          const oldLines: string[] = [];
          const newLines: string[] = [];
          for (const bl of h.body) {
            if (bl.startsWith(' ') || bl.startsWith('-')) oldLines.push(bl.slice(1));
            if (bl.startsWith(' ') || bl.startsWith('+')) newLines.push(bl.slice(1));
          }
          let tier = 0;
          let matches: number[] = [];
          while (tier <= 2 && matches.length === 0) {
            matches = findMatch(fileLines, oldLines, tier);
            tier++;
          }
          tier--;
          if (matches.length === 0) throw new Fail('no-match', targetPath!);
          let idx = matches[0];
          if (matches.length > 1) {
            const target = h.oldStart - 1 + d;
            idx = matches.reduce((best, m) => Math.abs(m - target) < Math.abs(best - target) ? m : best);
          }
          fileLines = applyMatch(fileLines, oldLines, newLines, idx, tier);
          d += newLines.length - oldLines.length;
        }
        const finalBreak = before.endsWith('\n');
        tree.now.set(targetPath!, fileLines.join('\n') + (finalBreak ? '\n' : ''));
      });
    }
  }
  return edits;
}

// ============================================================================
// SECTION 7: SEARCH/REPLACE blocks
// ============================================================================

function searchReplaceEdits(text: string, lines: string[]): Edit[] {
  const edits: Edit[] = [];
  let lastReplaceEnd = 0;
  let prevPath = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trimEnd() === '<<<<<<< SEARCH') {
      // Find path: nearest non-blank line before SEARCH that isn't a code fence
      let pathLine = -1;
      for (let k = i - 1; k >= lastReplaceEnd; k--) {
        const kl = lines[k];
        if (!blank(kl) && !kl.trimStart().startsWith('```')) { pathLine = k; break; }
      }
      if (pathLine < 0) {
        if (prevPath === '') throw new Exit2(`error: parse ${i + 1}`);
      } else {
        prevPath = lines[pathLine].trim();
      }
      const path = prevPath;
      // Find =======
      let eqIdx = -1;
      for (let k = i + 1; k < lines.length; k++) { if (lines[k].trimEnd() === '=======') { eqIdx = k; break; } }
      if (eqIdx < 0) throw new Exit2(`error: parse ${i + 1}`);
      // Find >>>>>>> REPLACE
      let repIdx = -1;
      for (let k = eqIdx + 1; k < lines.length; k++) { if (lines[k].trimEnd() === '>>>>>>> REPLACE') { repIdx = k; break; } }
      if (repIdx < 0) throw new Exit2(`error: parse ${i + 1}`);
      const oldLines = lines.slice(i + 1, eqIdx);
      const newLines = lines.slice(eqIdx + 1, repIdx);
      lastReplaceEnd = repIdx + 1;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (oldLines.length === 0) {
          if (tree.get(path) !== null) throw new Fail('exists', path);
          tree.now.set(path, newLines.join('\n') + '\n');
        } else {
          const before = tree.get(path);
          if (before === null) throw new Fail('missing', path);
          let fileLines = before.split('\n');
          if (before.endsWith('\n')) fileLines.pop();
          let tier = 0;
          let matches: number[] = [];
          while (tier <= 2 && matches.length === 0) {
            matches = findMatch(fileLines, oldLines, tier);
            tier++;
          }
          tier--;
          if (matches.length === 0) throw new Fail('no-match', path);
          if (matches.length > 1) throw new Fail('ambiguous', path);
          fileLines = applyMatch(fileLines, oldLines, newLines, matches[0], tier);
          const finalBreak = before.endsWith('\n');
          tree.now.set(path, fileLines.join('\n') + (finalBreak ? '\n' : ''));
        }
      });
    }
  }
  return edits;
}

// ============================================================================
// SECTION 8: V4A patches
// ============================================================================

interface V4AChunk { anchor: string; body: string[]; endOfFile: boolean }
interface V4ASection { type: 'add' | 'delete' | 'update'; path: string; moveTo?: string; lines?: string[]; chunks?: V4AChunk[] }

function parseV4A(lines: string[]): V4ASection[] {
  const firstNonBlank = lines.findIndex(l => !blank(l));
  if (firstNonBlank < 0 || lines[firstNonBlank].trim() !== '*** Begin Patch') throw new Exit2('error: parse 1');
  const lastNonBlank = [...lines].reverse().findIndex(l => !blank(l));
  const lastIdx = lines.length - 1 - lastNonBlank;
  if (lastIdx < 0 || lines[lastIdx].trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  
  const sections: V4ASection[] = [];
  let i = firstNonBlank + 1;
  while (i <= lastIdx) {
    const l = lines[i];
    if (blank(l)) { i++; continue; }
    if (l.startsWith('*** Add File: ')) {
      const path = l.slice(14).trim();
      if (!safe(path)) throw new Exit2(`error: parse ${i + 1}`);
      const fileLines: string[] = [];
      i++;
      while (i <= lastIdx) {
        const bl = lines[i];
        if (blank(bl)) { fileLines.push(''); i++; continue; }
        if (bl.startsWith('*** ')) break;
        if (bl.startsWith('+')) fileLines.push(bl.slice(1));
        else throw new Exit2(`error: parse ${i + 1}`);
        i++;
      }
      sections.push({ type: 'add', path, lines: fileLines });
    } else if (l.startsWith('*** Delete File: ')) {
      const path = l.slice(17).trim();
      if (!safe(path)) throw new Exit2(`error: parse ${i + 1}`);
      i++;
      while (i <= lastIdx && blank(lines[i])) i++;
      sections.push({ type: 'delete', path });
    } else if (l.startsWith('*** Update File: ')) {
      const path = l.slice(17).trim();
      if (!safe(path)) throw new Exit2(`error: parse ${i + 1}`);
      i++;
      let moveTo: string | undefined;
      if (i <= lastIdx && lines[i].startsWith('*** Move to: ')) {
        moveTo = lines[i].slice(13).trim();
        if (!safe(moveTo)) throw new Exit2(`error: parse ${i + 1}`);
        i++;
      }
      const chunks: V4AChunk[] = [];
      while (i <= lastIdx) {
        if (blank(lines[i])) { i++; continue; }
        if (lines[i] === '*** End Patch') break;
        if (lines[i].startsWith('*** ')) break;
        const chunk: V4AChunk = { anchor: '', body: [], endOfFile: false };
        if (lines[i].startsWith('@@')) {
          chunk.anchor = lines[i].slice(2).trim();
          i++;
        }
        while (i <= lastIdx) {
          const bl = lines[i];
          if (bl === '*** End of File') { chunk.endOfFile = true; i++; break; }
          if (bl === '*** End Patch') break;
          if (bl.startsWith('*** ')) break;
          if (/^[ \-\+]/.test(bl) || bl === '') chunk.body.push(bl);
          else throw new Exit2(`error: parse ${i + 1}`);
          i++;
        }
        chunks.push(chunk);
        if (i <= lastIdx && lines[i] === '*** End Patch') break;
      }
      sections.push({ type: 'update', path, moveTo, chunks });
      if (i <= lastIdx && lines[i] === '*** End Patch') { i++; break; }
    } else {
      throw new Exit2(`error: parse ${i + 1}`);
    }
  }
  return sections;
}

function v4aEdits(text: string, lines: string[]): Edit[] {
  const sections = parseV4A(lines);
  const edits: Edit[] = [];
  for (const sec of sections) {
    if (sec.type === 'add') {
      const { path, lines: fileLines } = sec;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) !== null) throw new Fail('exists', path);
        tree.now.set(path, fileLines!.join('\n') + '\n');
      });
    } else if (sec.type === 'delete') {
      const { path } = sec;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) === null) throw new Fail('missing', path);
        tree.now.set(path, null);
      });
    } else if (sec.type === 'update') {
      const { path, moveTo, chunks } = sec;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (moveTo && !safe(moveTo)) throw new Fail('unsafe', moveTo);
        const before = tree.get(path);
        if (before === null) throw new Fail('missing', path);
        let fileLines = before.split('\n');
        if (before.endsWith('\n')) fileLines.pop();
        let cursor = 0;
        for (const chunk of chunks!) {
          if (chunk.anchor) {
            let tier = 0;
            let matches: number[] = [];
            while (tier <= 2 && matches.length === 0) {
              matches = findMatch(fileLines.slice(cursor), [chunk.anchor], tier);
              tier++;
            }
            tier--;
            if (matches.length === 0) throw new Fail('no-match', path);
            cursor += matches[0] + 1;
          }
          const oldLines: string[] = [];
          const newLines: string[] = [];
          for (const bl of chunk.body) {
            if (bl.startsWith(' ') || bl.startsWith('-')) oldLines.push(bl.slice(1));
            if (bl.startsWith(' ') || bl.startsWith('+')) newLines.push(bl.slice(1));
          }
          let tier = 0;
          let matches: number[] = [];
          while (tier <= 2 && matches.length === 0) {
            matches = findMatch(fileLines.slice(cursor), oldLines, tier);
            tier++;
          }
          tier--;
          if (matches.length === 0) {
            if (chunk.endOfFile) {
              fileLines = [...fileLines, ...newLines];
              cursor = fileLines.length;
              continue;
            }
            throw new Fail('no-match', path);
          }
          let idx = matches[0];
          if (matches.length > 1) {
            idx = matches.find(m => m >= 0) ?? matches[0];
          }
          const beforeChunk = fileLines.slice(0, cursor + idx);
          const matched = applyMatch(fileLines.slice(cursor + idx), oldLines, newLines, 0, tier);
          const afterChunk = fileLines.slice(cursor + idx + oldLines.length);
          fileLines = [...beforeChunk, ...matched, ...afterChunk];
          cursor += idx + newLines.length;
        }
        const targetPath = moveTo ?? path;
        const finalBreak = before.endsWith('\n');
        if (moveTo) {
          tree.now.set(path, null);
          tree.now.set(moveTo, fileLines.join('\n') + (finalBreak ? '\n' : ''));
        } else {
          tree.now.set(targetPath, fileLines.join('\n') + (finalBreak ? '\n' : ''));
        }
      });
    }
  }
  return edits;
}

// ============================================================================
// MAIN RUN
// ============================================================================

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try { text = readFileSync(file ?? 0, 'utf8'); } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = unifiedEdits(text, lines);
    else if (kind === 'search-replace') edits = searchReplaceEdits(text, lines);
    else if (kind === 'v4a') edits = v4aEdits(text, lines);
    else throw new Exit2('error: parse 1');
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try { edit(tree); } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: string[] = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push(`${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`);
    if (check) continue;
    if (now === null) rmSync(p, { force: true });
    else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, now); }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}