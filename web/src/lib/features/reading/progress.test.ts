import { describe, expect, it } from 'vitest';
import { everythingElse, isPureMove, isSliceReviewed, noDiffReason, reviewKeys } from './progress';

const hunks = (n: number) => () => Array.from({ length: n }, (_, index) => ({ index }));

describe('reviewKeys', () => {
	it('gives each hunk, or of a range those it touched', () => {
		expect(reviewKeys([{ filename: 'a', patch: 'x' }], hunks(3))).toEqual(['a#0', 'a#1', 'a#2']);
		expect(reviewKeys([{ filename: 'a', patch: 'x', inRange: [1] }], hunks(3))).toEqual(['a#1']);
	});

	it('reads a file without a diff whole, as one', () => {
		expect(reviewKeys([{ filename: 'logo.png' }], hunks(0))).toEqual(['logo.png#0']);
	});
});

describe('everythingElse', () => {
	it('gathers what no slice claims into one last slice', () => {
		const rest = everythingElse(['a#0', 'a#1', 'b#0'], [{ id: 's', title: '', summary: '', hunks: ['a#0'] }]);
		expect(rest?.hunks).toEqual(['a#1', 'b#0']);
	});

	it('has nothing when every hunk is claimed', () => {
		expect(everythingElse(['a#0'], [{ id: 's', title: '', summary: '', hunks: ['a#0'] }])).toBeNull();
	});
});

describe('isSliceReviewed', () => {
	it('needs every hunk of a slice reviewed, and at least one', () => {
		const slice = { id: 's', title: '', summary: '', hunks: ['a#0', 'a#1'] };
		expect(isSliceReviewed(slice, { 'a#0': true })).toBe(false);
		expect(isSliceReviewed(slice, { 'a#0': true, 'a#1': true })).toBe(true);
		expect(isSliceReviewed({ ...slice, hunks: [] }, {})).toBe(false);
	});
});

describe('noDiffReason', () => {
	it('says why a file has no diff to show', () => {
		expect(noDiffReason({ status: 'modified', additions: 3, deletions: 1 })).toMatch(/too big/);
		expect(noDiffReason({ status: 'renamed', additions: 0, deletions: 0, previous_filename: 'old.ts' })).toBe('Moved from old.ts, with no changes');
		expect(noDiffReason({ status: 'added', additions: 0, deletions: 0 })).toMatch(/binary or empty/);
	});
});

describe('isPureMove', () => {
	const moved = { status: 'renamed', previous_filename: 'old/a.ts', additions: 0, deletions: 0 };
	it('is a rename with no changes', () => {
		expect(isPureMove(moved)).toBe(true);
		expect(isPureMove({ ...moved, additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' })).toBe(false);
		expect(isPureMove({ ...moved, status: 'modified' })).toBe(false);
	});
});
