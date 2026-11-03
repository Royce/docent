<script lang="ts">
	import { plural } from '$lib/ui/format';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { LooseMark, Mark } from '$lib/features/reading/marks';
	import Dialog from '$lib/ui/Dialog.svelte';
	import FileDiffs from '$lib/features/reading/FileDiffs.svelte';
	import FindingCard from '$lib/features/panel/FindingCard.svelte';
	import FoldAll from '$lib/features/reading/FoldAll.svelte';
	import NoteText from '$lib/ui/NoteText.svelte';
	import SliceRail from '$lib/features/reading/SliceRail.svelte';
	import ViewOptions from '$lib/features/reading/ViewOptions.svelte';
	import AskBubble from '$lib/features/reading/AskBubble.svelte';
	import { isSliceReviewed, useSession } from '$lib/session/session.svelte';

	const session = useSession();
	let allOpen = $state(false);
	// The last expand all / collapse all on this slice, which its files follow.
	let fold = $state<{ open: boolean; at: number; slice: string } | null>(null);
	const sliceId = $derived(page.params.slice);
	const slices = $derived(session.slices);
	const index = $derived(slices.findIndex((s) => s.id === sliceId));
	const slice = $derived(slices[index]);
	const base = $derived(session.base);
	const done = $derived(slice ? isSliceReviewed(slice, session.reviewed) : false);

	// The next slice still to review, after this one, else before it.
	const next = $derived.by(() => {
		const after = slices.slice(index + 1).find((s) => !isSliceReviewed(s, session.reviewed));
		return after ?? slices.slice(0, index).find((s) => !isSliceReviewed(s, session.reviewed));
	});

	function goNext() {
		goto(next ? `${base}/slices/${next.id}` : `${base}/wrap-up`);
	}

	const markById = (id: string): Mark | LooseMark | undefined => session.allFindings.find((f) => f.mark.id === id)?.mark;

	function go(target: string | null) {
		goto(target ? `${base}/slices/${target}` : `${base}/wrap-up`);
		window.scrollTo(0, 0);
	}

	// A second opinion: a slice becoming reviewed shows the panel's findings
	// on it that are still waiting on a keep or skip. After Mark slice
	// reviewed its Done moves on; after ticking the last file it stays.
	let opinion = $state<{ ids: string[]; next: string | null; stay?: boolean } | null>(null);
	// Set while Mark slice reviewed handles the moment itself.
	let marking = false;

	function showOpinion(ids: string[], next: string | null, stay = false) {
		// Seen here, so they aren't news when the slice is next opened.
		// Seen here in full, so they're read.
		for (const id of ids) {
			const mark = markById(id);
			if (mark?.reviewer) session.conversations.markFindingRead(mark.reviewer, id);
		}
		opinion = { ids, next, stay };
	}

	async function markReviewed() {
		if (!slice) return;
		const target = next?.id ?? null;
		const pending = session.undecidedIn(slice.id).map((m) => m.id);
		marking = true;
		await session.setReviewed(slice.hunks, true);
		marking = false;
		if (pending.length) showOpinion(pending, target);
		else go(target);
	}

	// The slice becoming reviewed any other way: its last file ticked.
	let wasDone: { slice: string; done: boolean } | null = null;
	$effect(() => {
		const now = { slice: sliceId ?? '', done };
		const before = wasDone;
		wasDone = now;
		if (marking || !before || before.slice !== now.slice || before.done || !now.done) return;
		const pending = session.undecidedIn(now.slice).map((m) => m.id);
		if (pending.length) showOpinion(pending, null, true);
	});

	// The panel's editor at work on this slice.
	const reviewing = $derived(sliceId ? session.panel.reviewing(sliceId) : false);

	// The second opinion's Done completes the move it interrupted.
	function finishOpinion() {
		const current = opinion;
		opinion = null;
		if (current && !current.stay) go(current.next);
	}

	// Opens a finding where it sits in the diff, through any fold hiding it.
	function reveal(mark: Mark | LooseMark) {
		session.revealing = mark.id;
	}

	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, select, [contenteditable]')) return;
		if (opinion) return;
		if (e.key === 'r' && !done) {
			e.preventDefault();
			markReviewed();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
	<SliceRail current={sliceId} />

	{#if slice}
		<main>
			<div class="top">
				<span class="label">Slice {index + 1} of {slices.length}</span>
				<span class="grow"></span>
				<ViewOptions />
				{#if index > 0}<a class="btn" href="{base}/slices/{slices[index - 1].id}">← Prev</a>{/if}
				{#if index < slices.length - 1}<a class="btn" href="{base}/slices/{slices[index + 1].id}">Next →</a>{/if}
			</div>
			<h1>{slice.title}</h1>
			<div class="summary"><NoteText text={slice.summary} /></div>
			{#if reviewing}
				<div class="editor faint">The panel is still reviewing this slice</div>
			{/if}
			{#key slice.id}
				<div class="above-files">
					<FoldAll {allOpen} onfold={(open) => (fold = { open, at: Date.now(), slice: slice.id })} />
					<p class="hint faint">Drag down the line numbers to select lines.</p>
				</div>
				<FileDiffs
					bind:allOpen
					keys={slice.hunks}
					notes={session.record.fileNotes?.[slice.id] ?? []}
					gatherRoutine
					fold={fold?.slice === slice.id ? fold : null}
				/>
			{/key}

			<div class="finish">
				{#if done}
					<button class="btn" onclick={() => session.setReviewed(slice.hunks, false)}>Mark not reviewed</button>
					<button class="btn primary big" onclick={goNext}>{next ? 'Next slice →' : 'Wrap up →'}</button>
				{:else}
					<button class="btn primary big" onclick={markReviewed}>Mark slice reviewed <kbd>R</kbd></button>
				{/if}
			</div>
		</main>
		<AskBubble {slice} />
	{:else}
		<main><p>No slice “{sliceId}” in this PR.</p></main>
	{/if}
</div>

{#if opinion}
	{@const marks = opinion.ids.map(markById).filter((m) => m !== undefined)}
	<Dialog label="Slice reviewed" onclose={finishOpinion}>
		<span class="done-label">Slice reviewed</span>
		<h2>The panel noticed {plural(marks.length, 'thing')} here</h2>
		{#each marks as mark (mark.id)}
			<FindingCard
				{mark}
				onshow={() => {
					opinion = null;
					reveal(mark);
				}}
			/>
		{/each}
		<div class="dialog-foot">
			<button class="btn primary big" onclick={finishOpinion}>Done</button>
		</div>
	</Dialog>
{/if}

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
		padding: 36px 56px 40px;
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
	.top .btn {
		text-decoration: none;
	}
	h1 {
		margin: 10px 0 10px;
		font-family: var(--serif);
		font-size: 32px;
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}

	.editor {
		display: flex;
		gap: 16px;
		margin: 12px 0;
		font-size: 13.5px;
	}
	.done-label {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--done);
	}
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
		line-height: 1.2;
	}

	.dialog-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding-top: 4px;
		font-size: 13px;
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0 0 8px;
		max-width: 860px;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.6;
	}
	/* Fold all sits over the files' own chevrons. */
	.above-files {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 44px 0 6px -6px;
	}
	.hint {
		margin: 0;
		font-size: 13px;
	}
	.finish {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 12px;
		padding: 16px 0 24px;
		background: linear-gradient(transparent, var(--bg) 30%);
		font-size: 13.5px;
		/* Clicks reach the code under the fade; only the bar's own controls take them. */
		pointer-events: none;
	}
	.finish > * {
		pointer-events: auto;
	}
	.big {
		height: 42px;
		padding: 0 18px;
		border-radius: 12px;
		font-size: 14.5px;
	}
	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		padding: 0 5px;
		border-radius: 5px;
		background: #d8d3c7;
		color: var(--on-chosen);
		font-family: var(--mono);
		font-size: 11.5px;
	}
</style>
