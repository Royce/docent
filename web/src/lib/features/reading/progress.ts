import type { Slice } from '../../types';

export function isSliceReviewed(slice: Slice, reviewed: Record<string, boolean>): boolean {
	return slice.hunks.length > 0 && slice.hunks.every((key) => reviewed[key]);
}

// What there is to read of some files, as `path#index`: each hunk, or of a
// range of commits those it touched. A file without a diff to show - a
// binary one, or one too big for GitHub to give - is read whole, as one, so
// it's still in a slice, and still has to be marked reviewed.
export function reviewKeys(
	files: { filename: string; patch?: string; inRange?: number[] }[],
	hunksOf: (file: { filename: string; patch?: string }) => { index: number }[]
): string[] {
	return files.flatMap((f) =>
		f.patch
			? hunksOf(f)
					.filter((h) => !f.inRange || f.inRange.includes(h.index))
					.map((h) => `${f.filename}#${h.index}`)
			: [`${f.filename}#0`]
	);
}

// A file moved with no changes to it.
export function isPureMove(file: { status: string; additions: number; deletions: number; patch?: string; previous_filename?: string }): boolean {
	return file.status === 'renamed' && !!file.previous_filename && !file.patch && !file.additions && !file.deletions;
}

// Why a file read whole has no diff to show.
export function noDiffReason(file: { status: string; additions: number; deletions: number; previous_filename?: string }): string {
	if (file.additions + file.deletions) return `Couldn't load this diff: +${file.additions} −${file.deletions}, too big to show here`;
	if (file.status === 'renamed' && file.previous_filename) return `Moved from ${file.previous_filename}, with no changes`;
	return 'No text diff: a binary or empty file';
}

// Hunks no slice claims, as one last slice so nothing goes unread.
export function everythingElse(hunkKeys: string[], slices: Slice[]): Slice | null {
	const claimed = new Set(slices.flatMap((s) => s.hunks));
	const hunks = hunkKeys.filter((k) => !claimed.has(k));
	return hunks.length ? { id: 'everything-else', title: 'Everything else', summary: 'Changes no slice above covers.', hunks } : null;
}
