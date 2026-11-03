import type { PrFile } from './github.server.js';
import { parseFilePatch, type Hunk } from '../features/reading/diff/parse.js';
import type { Slice } from '../types.js';

// Diffs as reviewers read them: each line numbered by where it sits in the
// new file, so a finding can say exactly which lines it's about. Deleted
// lines have no new-file number.

export function numberedHunk(hunk: Hunk): string {
	const rows = hunk.rows.map((r) => (r.kind === 'del' ? `      -${r.text}` : `${String(r.new).padStart(5)} ${r.kind === 'add' ? '+' : ' '}${r.text}`));
	return [hunk.header, ...rows].join('\n');
}

// A diff bigger than this isn't sent whole: Docent's reviewer sums it up by
// its files, and a reviewer that needs the whole of it says so.
export const WHOLE_DIFF_LIMIT = 120_000;

// For a range of commits, only the hunks it touched, unless asked for others.
export function numberedFileDiff(file: PrFile, hunkIndices = file.inRange): string {
	// A moved file says where from, so its change can be read as a move.
	const status = file.previous_filename ? `${file.status} from ${file.previous_filename}` : file.status;
	if (!file.patch) return `${file.filename} (${status}, no text diff)`;
	const hunks = parseFilePatch(file.patch);
	const shown = hunkIndices ? hunkIndices.map((i) => hunks[i]).filter(Boolean) : hunks;
	return `${file.filename} (${status})\n${shown.map(numberedHunk).join('\n')}`;
}

// New-file lines that appear in a file's diff (added or unchanged context):
// the only lines a GitHub review comment can sit on.
export function linesInDiff(file: PrFile): Set<number> {
	const rows = parseFilePatch(file.patch ?? '').flatMap((h) => h.rows);
	return new Set(rows.flatMap((r) => (r.kind === 'del' ? [] : [r.new!])));
}

// Both sides' lines that appear in a file's diff: a GitHub review comment
// can sit on a deleted line (the old side) or any other (the new side).
export function commentableLines(file: PrFile): { old: Set<number>; new: Set<number> } {
	const rows = parseFilePatch(file.patch ?? '').flatMap((h) => h.rows);
	return {
		old: new Set(rows.flatMap((r) => (r.kind === 'add' ? [] : [r.old!]))),
		new: new Set(rows.flatMap((r) => (r.kind === 'del' ? [] : [r.new!])))
	};
}

// Ranges of lines, for telling a reviewer which lines are commentable.
export function describeRanges(lines: Set<number>): string {
	const sorted = [...lines].sort((a, b) => a - b);
	const ranges: string[] = [];
	let start = sorted[0];
	let prev = sorted[0];
	for (const n of sorted.slice(1).concat(Number.NaN)) {
		if (n === prev + 1) {
			prev = n;
			continue;
		}
		if (start !== undefined) ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
		start = n;
		prev = n;
	}
	return ranges.join(', ');
}

// A slice's hunks, by the file they're in.
export function hunkIndicesByFile(slice: Slice): Map<string, number[]> {
	const byFile = new Map<string, number[]>();
	for (const ref of slice.hunks) {
		const at = ref.lastIndexOf('#');
		const path = ref.slice(0, at);
		byFile.set(path, [...(byFile.get(path) ?? []), Number(ref.slice(at + 1))]);
	}
	return byFile;
}
