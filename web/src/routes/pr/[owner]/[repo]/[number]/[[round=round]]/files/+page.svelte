<script lang="ts">
	import FileDiffs from '$lib/features/reading/FileDiffs.svelte';
	import FoldAll from '$lib/features/reading/FoldAll.svelte';
	import SliceRail from '$lib/features/reading/SliceRail.svelte';
	import ViewOptions from '$lib/features/reading/ViewOptions.svelte';
	import { useSession } from '$lib/session/session.svelte';

	// Every file in the PR, whole, outside the slices.
	const session = useSession();
	let allOpen = $state(false);
	// The last expand all / collapse all, which every file follows.
	let fold = $state<{ open: boolean; at: number } | null>(null);
	const reviewedFiles = $derived(
		session.files.filter((f) => {
			const keys = session.hunkKeys.filter((k) => k.slice(0, k.lastIndexOf('#')) === f.filename);
			return keys.length && keys.every((k) => session.reviewed[k]);
		}).length
	);
	// Every file's notes, whichever slice they were written for. A routine
	// line is only about its slice's part of a file, so one with nothing
	// else is left out, not to stand in for another slice's note.
	const notes = $derived(
		Object.values(session.record.fileNotes ?? {})
			.flat()
			.filter((n) => n.note || n.scenarioLines || n.quietRanges)
	);
</script>

<div class="page">
	<SliceRail allFiles />
	<main>
		<div class="top">
			<span class="label">All files</span>
			<span class="grow"></span>
			<ViewOptions />
		</div>
		<h1>All {session.files.length} files</h1>
		<div class="above-files">
			<p class="faint">{reviewedFiles} of {session.files.length} reviewed</p>
			<FoldAll {allOpen} onfold={(open) => (fold = { open, at: Date.now() })} />
		</div>
		<FileDiffs bind:allOpen keys={session.hunkKeys} {notes} {fold} />
	</main>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		min-height: calc(100vh - 64px);
	}
	.label {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	main {
		padding: 36px 56px 80px;
		max-width: 1180px;
		box-sizing: border-box;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.grow {
		flex-grow: 1;
	}
	h1 {
		margin: 10px 0 6px;
		font-family: var(--serif);
		font-size: 32px;
		font-weight: 500;
	}
	.above-files {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	p {
		margin: 0;
		font-size: 14px;
	}
</style>
