import type { PrFile } from '../../github/github.server.js';
import { chatWithTool } from '../../models/modelProvider.server.js';
import { inLane } from '../../models/lanes.server.js';
import { linesInDiff, numberedFileDiff } from '../../github/prDiff.server.js';
import type { FileNote, Slice } from '../../types.js';
import { byFileOrder } from '../reading/fileOrder.js';
import { isPureMove } from '../reading/progress.js';

// Notes on individual files within a slice, where a file needs more than the
// slice's summary: what a test file actually tests, or what a large change
// amounts to; or, for a change with nothing in it to check, the one line
// that says what it is, shown in place of its diff. A pass of its own after
// slicing, one call per slice, so it can't change the slices themselves.

const REPORT_FILE_NOTES_TOOL = {
	name: 'report_file_notes',
	description: 'Report notes on the files in this slice that need one, the routine ones, and the quiet parts of each file.',
	parameters: {
		type: 'object',
		properties: {
			notes: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						path: { type: 'string' },
						kind: { type: 'string', enum: ['tests', 'context'] },
						note: {
							type: 'string',
							description: 'Usually empty. When warranted: one plain sentence, 25 words at most.'
						},
						routine: {
							type: 'string',
							description: 'Usually empty. For a file whose change here has nothing in it to check: what the change is, in 12 words at most.'
						},
						scenario_lines: {
							type: 'array',
							items: { type: 'integer' },
							description: 'For tests only: new-file line numbers of the lines that name a test or a group of tests.'
						},
						quiet_ranges: {
							type: 'array',
							description: 'Imports and test setup: code the reviewer would only skim.',
							items: {
								type: 'object',
								properties: {
									kind: { type: 'string', enum: ['imports', 'setup'] },
									start_line: { type: 'integer' },
									end_line: { type: 'integer' }
								},
								required: ['kind', 'start_line', 'end_line']
							}
						}
					},
					required: ['path', 'kind', 'note']
				}
			}
		},
		required: ['notes']
	}
};

const SYSTEM_PROMPT = `You are helping someone review one slice of a pull request - a coherent part of \
it, already summarised. For each file, you may add a short note, and you mark the parts of it the \
reviewer will only skim.
Notes are the exception, not the rule. Most files get no note: leave it empty. Write one only when:
- a non-test file's change is large or intricate enough that reading it line by line costs real \
time, and one sentence can say what it amounts to or what specifically to check; or
- a test file has a problem: a case the change needs that isn't tested, or a test that's weak or \
doesn't test what its name says. Well-covered tests get no note - the reviewer reads the test \
names themselves.
Never note a small change, edits to prose, docs or strings, or anything the slice summary \
already says. A note is one plain sentence, 25 words at most: no headings, lists or praise.
Some files' changes have nothing in them to check, and the reviewer only needs to know what \
they are: an import or path repointed to where code now lives; a rename carried through; a call \
updated to a changed signature the same way as elsewhere; a file deleted whose code moved \
elsewhere in this PR, or that the slice summary says nothing uses any more; a snapshot or \
fixture regenerated. For a file whose whole change in this slice is only that, give routine: what the change is, in \
12 words at most, like "ThemeMode import repointed to modes.ts" or "deleted - its types moved \
to modes.ts". When it's the same change as the file listed just before it, and that one is \
routine too, say only that, like "same repoint" or "same rename". A routine file is shown \
closed, with that line in place of its diff, so call a change routine only when there's truly \
nothing in it to check: a new condition, a changed value or behaviour, or anything else a \
reviewer would want to judge isn't routine, however small. A routine file gets no note. Leave \
routine empty for every other file.
For a test file, also give scenario_lines: the new-file line numbers, as numbered in the diff, of \
every line that names a test or a group of tests - whatever this file's framework uses, e.g. \
describe/it/test calls, def test_ functions, func TestX or t.Run, [Fact] or [Test] methods, \
RSpec's describe/context/it. The reviewer then reads those lines with the code between them \
folded, so include every one, and nothing else.
For any file in this slice, also give quiet_ranges for code the reviewer would only skim, shown \
folded with a count of what changed inside:
- imports: a file's block of imports, using directives, includes or requires, in whatever \
language it's in.
- setup: in a test file, the setup before its first test - mocks, fixtures, helpers - but not \
the tests themselves.
Each range is start_line and end_line, new-file line numbers from the diff covering the whole \
block. A file that only has quiet ranges, scenario lines or a routine line gets an entry with \
an empty note.
Only note files that are in this slice, using their paths exactly as shown. Report no notes if \
none are needed.`;

function hunkIndicesByFile(slice: Slice): Map<string, number[]> {
	const byFile = new Map<string, number[]>();
	for (const ref of slice.hunks) {
		const at = ref.lastIndexOf('#');
		const path = ref.slice(0, at);
		byFile.set(path, [...(byFile.get(path) ?? []), Number(ref.slice(at + 1))]);
	}
	return byFile;
}

async function notesForSlice(files: PrFile[], slice: Slice, signal?: AbortSignal, model?: string): Promise<FileNote[]> {
	const byFile = hunkIndicesByFile(slice);
	// In the order the slice shows them, so "the file just before" is the
	// one above it on the page.
	const diff = [...byFile]
		.sort(([a], [b]) => byFileOrder(a, b))
		.map(([path, indices]) => {
			const file = files.find((f) => f.filename === path);
			return file ? numberedFileDiff(file, indices) : '';
		})
		.filter(Boolean)
		.join('\n\n');
	if (!diff) return [];

	const call = await inLane(() => {
		signal?.throwIfAborted();
		return chatWithTool(
			[
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: `Slice: ${slice.title}\n${slice.summary}\n\n${diff}` }
			],
			REPORT_FILE_NOTES_TOOL,
			signal,
			model
		);
	}, model);

	return fileNotesFrom((call.arguments as { notes?: unknown }).notes, files, new Set(byFile.keys()));
}

// The notes a model reported for the files at `paths`, checked: only those
// files, one note each, lines that are in the diff, and a "same ..." line
// only under a routine file.
export function fileNotesFrom(raw: unknown, files: PrFile[], paths: Set<string>): FileNote[] {
	const notes = (Array.isArray(raw) ? raw : [])
		.flatMap((entry): FileNote[] => {
			const { path, kind, note, routine, scenario_lines, quiet_ranges } = (entry ?? {}) as Record<string, unknown>;
			// Only files in this slice, and one note per file.
			if (typeof path !== 'string' || !paths.has(path) || typeof note !== 'string') return [];
			if (kind !== 'tests' && kind !== 'context') return [];
			const file = files.find((f) => f.filename === path);
			const inDiff = file ? linesInDiff(file) : new Set<number>();
			const scenarios = kind === 'tests' ? checkLines(scenario_lines, inDiff) : [];
			const quiet = checkRanges(quiet_ranges, inDiff);
			// A file with something to say about it isn't routine: it's
			// folded away only when there's nothing else to read of it.
			const line = note.trim() ? '' : routineLine(routine);
			if (!note.trim() && !line && !quiet.length && !scenarios.length) return [];
			return [
				{
					path,
					kind,
					note: note.trim(),
					...(line ? { routine: line } : {}),
					...(scenarios.length ? { scenarioLines: scenarios } : {}),
					...(quiet.length ? { quietRanges: quiet } : {})
				}
			];
		})
		.filter((n, i, all) => all.findIndex((m) => m.path === n.path) === i);
	// A "same ..." line says only that the file above it changed the same
	// way: under a file that isn't routine - one moved with no changes is -
	// it says nothing, so the file is shown instead.
	let aboveRoutine = false;
	for (const path of [...paths].sort(byFileOrder)) {
		const note = notes.find((n) => n.path === path);
		if (note?.routine && /^same\b/i.test(note.routine) && !aboveRoutine) delete note.routine;
		const file = files.find((f) => f.filename === path);
		aboveRoutine = !!note?.routine || (!!file && isPureMove(file) && !note?.note);
	}
	return notes.filter((n) => n.note || n.routine || n.scenarioLines || n.quietRanges);
}

// A routine change's one line, as plain as it's shown: its first line,
// without a list marker or closing full stop.
function routineLine(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	return (raw.trim().split('\n')[0] ?? '')
		.trim()
		.replace(/^[-*•]\s+/, '')
		.replace(/(?<!\.)\.$/, '');
}

// Ranges whose ends are in the diff, in order and not overlapping.
function checkRanges(raw: unknown, inDiff: Set<number>): NonNullable<FileNote['quietRanges']> {
	const ranges: NonNullable<FileNote['quietRanges']> = [];
	for (const entry of Array.isArray(raw) ? raw : []) {
		const { kind, start_line, end_line } = (entry ?? {}) as Record<string, unknown>;
		if ((kind !== 'imports' && kind !== 'setup') || typeof start_line !== 'number' || typeof end_line !== 'number') continue;
		const [startLine, endLine] = start_line <= end_line ? [start_line, end_line] : [end_line, start_line];
		if (inDiff.has(startLine) && inDiff.has(endLine)) ranges.push({ kind, startLine, endLine });
	}
	ranges.sort((a, b) => a.startLine - b.startLine);
	return ranges.filter((r, i) => i === 0 || r.startLine > ranges[i - 1].endLine);
}

// Line numbers that are in the diff, in order, once each.
function checkLines(raw: unknown, inDiff: Set<number>): number[] {
	const lines = (Array.isArray(raw) ? raw : []).filter((n): n is number => typeof n === 'number' && inDiff.has(n));
	return [...new Set(lines)].sort((a, b) => a - b);
}

// Notes for every slice, by slice id. Slices are done side by side, as many
// at once as the model allows.
export async function generateFileNotes(files: PrFile[], slices: Slice[], signal?: AbortSignal, model?: string): Promise<Record<string, FileNote[]>> {
	const entries = await Promise.all(slices.map(async (slice) => [slice.id, await notesForSlice(files, slice, signal, model)] as const));
	return Object.fromEntries(entries.filter(([, notes]) => notes.length > 0));
}
