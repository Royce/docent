import { describe, expect, it } from 'vitest';
import { fileNotesFrom } from './fileNotes.server';
import type { PrFile } from '../../github/github.server';

const file = (filename: string, more: Partial<PrFile> = {}): PrFile => ({
	filename,
	status: 'modified',
	additions: 1,
	deletions: 1,
	patch: '@@ -1 +1 @@\n-import { A } from "./old"\n+import { A } from "./new"',
	...more
});
const paths = (...names: string[]) => new Set(names);

describe('fileNotesFrom', () => {
	it('keeps a routine line, as one plain line', () => {
		const notes = fileNotesFrom([{ path: 'a.ts', kind: 'context', note: '', routine: '- A import repointed to new.ts.\nmore' }], [file('a.ts')], paths('a.ts'));
		expect(notes).toEqual([{ path: 'a.ts', kind: 'context', note: '', routine: 'A import repointed to new.ts' }]);
	});

	it("doesn't call a file with a note routine", () => {
		const notes = fileNotesFrom([{ path: 'a.ts', kind: 'context', note: 'Check the new guard.', routine: 'same repoint' }], [file('a.ts')], paths('a.ts'));
		expect(notes).toEqual([{ path: 'a.ts', kind: 'context', note: 'Check the new guard.' }]);
	});

	it('drops files outside the slice, and entries with nothing to say', () => {
		const raw = [
			{ path: 'b.ts', kind: 'context', note: '', routine: 'same repoint' },
			{ path: 'a.ts', kind: 'context', note: '', routine: '   ' }
		];
		expect(fileNotesFrom(raw, [file('a.ts'), file('b.ts')], paths('a.ts'))).toEqual([]);
	});

	it('keeps the first note for a file', () => {
		const raw = [
			{ path: 'a.ts', kind: 'context', note: '', routine: 'A import repointed' },
			{ path: 'a.ts', kind: 'context', note: 'Second.' }
		];
		expect(fileNotesFrom(raw, [file('a.ts')], paths('a.ts'))).toEqual([{ path: 'a.ts', kind: 'context', note: '', routine: 'A import repointed' }]);
	});

	it('keeps a "same ..." line only under a routine file', () => {
		const raw = [
			{ path: 'a.ts', kind: 'context', note: 'Check the new guard.' },
			{ path: 'b.ts', kind: 'context', note: '', routine: 'same repoint' },
			{ path: 'c.ts', kind: 'context', note: '', routine: 'B import repointed' },
			{ path: 'd.ts', kind: 'context', note: '', routine: 'Same repoint' }
		];
		const notes = fileNotesFrom(
			raw,
			['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((n) => file(n)),
			paths('a.ts', 'b.ts', 'c.ts', 'd.ts')
		);
		expect(notes.map((n) => [n.path, n.routine])).toEqual([
			['a.ts', undefined],
			['c.ts', 'B import repointed'],
			['d.ts', 'Same repoint']
		]);
	});

	it('takes a file moved with no changes as routine, for the line under it', () => {
		const moved = file('a.ts', { status: 'renamed', previous_filename: 'old/a.ts', additions: 0, deletions: 0, patch: undefined });
		const notes = fileNotesFrom([{ path: 'b.ts', kind: 'context', note: '', routine: 'same move' }], [moved, file('b.ts')], paths('a.ts', 'b.ts'));
		expect(notes).toEqual([{ path: 'b.ts', kind: 'context', note: '', routine: 'same move' }]);
	});
});
