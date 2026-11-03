<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { githubMarksFrom, marksFrom } from './marks';
	import { useSession } from '$lib/session/session.svelte';
	import type { FileNote, PrFile } from '$lib/types';
	import DiffFile from './DiffFile.svelte';
	import { byFileOrder } from './fileOrder';
	import { isPureMove } from './progress';

	// Files as they're read: each with the hunks shown here, its note, its
	// pins, and a Reviewed control covering just those hunks.
	let {
		keys,
		notes = [],
		gatherRoutine = false,
		fold = null,
		allOpen = $bindable(false)
	}: {
		// The hunks to show, as `path#index`, in the PR's file order.
		keys: string[];
		notes?: FileNote[];
		// Gather the files whose notes call their change routine below the
		// rest, closed, each with its one line in place of its diff. Only
		// for a slice's own notes, which are about just its hunks.
		gatherRoutine?: boolean;
		fold?: { open: boolean; at: number } | null;
		// Whether every file here is open, for the page's fold-all button.
		allOpen?: boolean;
	} = $props();

	const open = new SvelteSet<string>();
	$effect(() => {
		allOpen = files.length > 0 && files.every(({ file }) => open.has(file.filename));
	});

	const session = useSession();
	const uid = $props.id();

	const marks = $derived([...marksFrom(session.record, true), ...githubMarksFrom(session.githubInReading, session.record)]);

	// The files gathered are those whose notes said routine when the files
	// were first shown: notes landing while they're read leave every file
	// where it is, open or closed, and are gathered on the next visit.
	const gathered = untrack(() => new Set(gatherRoutine ? notes.filter((n) => n.routine).map((n) => n.path) : []));
	// A file moved with no changes needs no note to say so.
	const routineOf = (file: PrFile, note?: FileNote) =>
		gathered.has(file.filename)
			? note?.routine
			: gatherRoutine && isPureMove(file) && !note?.note
				? `Moved from ${file.previous_filename}, unchanged`
				: undefined;

	const files = $derived.by(() => {
		const byFile = new Map<string, number[]>();
		for (const key of keys) {
			const at = key.lastIndexOf('#');
			const path = key.slice(0, at);
			byFile.set(path, [...(byFile.get(path) ?? []), Number(key.slice(at + 1))]);
		}
		return session.files
			.filter((f) => byFile.has(f.filename))
			.sort((a, b) => byFileOrder(a.filename, b.filename))
			.map((file) => {
				const indices = byFile.get(file.filename)!;
				const fileKeys = indices.map((i) => `${file.filename}#${i}`);
				const note = notes.find((n) => n.path === file.filename);
				return { file, indices, fileKeys, note, routine: routineOf(file, note) };
			});
	});
	const read = $derived(files.filter((f) => !f.routine));
	const routine = $derived(files.filter((f) => f.routine));
</script>

{#snippet diffFile({ file, indices, fileKeys, note, routine }: (typeof files)[number])}
	{@const reviewed = fileKeys.every((k) => session.reviewed[k])}
	<DiffFile
		{file}
		allHunks={session.hunks.get(file.filename) ?? []}
		hunkIndices={indices}
		marks={marks.filter((m) => m.path === file.filename)}
		{note}
		{routine}
		prRef={session.ref}
		whitespace={!session.hideWhitespace}
		{reviewed}
		onToggleReviewed={() => session.setReviewed(fileKeys, !reviewed)}
		{fold}
		foldTests={session.foldTests}
		showRemoved={session.commitView}
		onopenchange={(isOpen) => (isOpen ? open.add(file.filename) : open.delete(file.filename))}
	/>
{/snippet}

<div class="files">
	{#each read as f (f.file.filename)}{@render diffFile(f)}{/each}
</div>
{#if routine.length}
	<section
		class="routine"
		class:below={read.length}
		aria-labelledby={read.length ? `${uid}-routine` : undefined}
		aria-label={read.length ? undefined : 'Routine changes'}
	>
		{#if read.length}<h2 id="{uid}-routine" class="faint">Also in this slice</h2>{/if}
		<div class="files">
			{#each routine as f (f.file.filename)}{@render diffFile(f)}{/each}
		</div>
	</section>
{/if}

<style>
	.files {
		display: flex;
		flex-direction: column;
	}
	.routine.below {
		margin-top: 28px;
	}
	h2 {
		margin: 0 0 2px;
		font-size: 13px;
		font-weight: 500;
	}
</style>
