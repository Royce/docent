<script lang="ts">
	import { plural } from '$lib/ui/format';
	import Icon from '$lib/ui/Icon.svelte';
	import { onDismiss } from '$lib/ui/dismiss';
	import FilePath from '$lib/ui/FilePath.svelte';
	import Floating from '$lib/ui/Floating.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import StateMark from '$lib/ui/StateMark.svelte';
	import MarkPopover from '../panel/MarkPopover.svelte';
	import { isConcluded, useSession } from '$lib/session/session.svelte';
	import { isUnread, type FileNote, type Note, type PrFile } from '$lib/types';
	import Composer, { type SendKind } from './Composer.svelte';
	import { looseGitHubThreads, type LooseMark, type Mark } from './marks';
	import GitHubThreadPanel from './GitHubThreadPanel.svelte';
	import Pin from './Pin.svelte';
	import ThreadPanel from './ThreadPanel.svelte';

	// A file's header in the diff: opening and closing it, its path, what its
	// note says while it's closed, its changes, the slices holding the rest of
	// it, its marker, and marking it reviewed.
	let {
		file,
		note,
		routine,
		collapsed = $bindable(),
		counts,
		summary,
		wholeFile,
		fileThreads,
		openAnchor,
		reviewed,
		onreview
	}: {
		file: PrFile;
		note?: FileNote;
		// A routine change's one line, said open or closed.
		routine?: string;
		collapsed: boolean;
		counts: { added: number; removed: number };
		// A closed file's one marker; see DiffFile.
		summary: { kind: 'finding' | 'note'; first: Mark | { id: string }; solid: boolean; unread: boolean; count: number } | null;
		// Findings about the file as a whole, with no lines to sit on.
		wholeFile: LooseMark[];
		// Your threads on the file as a whole.
		fileThreads: Note[];
		openAnchor: HTMLElement | null;
		reviewed: boolean;
		onreview?: () => void;
	} = $props();

	const session = useSession();
	// The routine line as plain text, for its tooltip and the file's name.
	const routinePlain = $derived(routine?.replace(/`|\*\*/g, ''));
	// GitHub threads on the file with no lines here: outdated, or on the whole file.
	const githubThreads = $derived(looseGitHubThreads(session.githubInReading, file.filename));

	// Starting a thread on the whole file, from the header's comment button.
	let composing = $state(false);
	let draft = $state('');
	let commentButton = $state<HTMLElement | null>(null);
	function startThread(text: string, kind: SendKind) {
		const id = session.conversations.createNote({ path: file.filename }, text, { comment: kind === 'comment' });
		composing = false;
		collapsed = false;
		session.openMark = id;
	}
	$effect(() => {
		if (!composing) return;
		return onDismiss(() => (composing = false), '.file-composer, .comment-file', { escape: false });
	});
</script>

<header>
	<button
		class="toggle name"
		aria-expanded={!collapsed}
		aria-label={routinePlain ? `${file.filename} - ${routinePlain}` : undefined}
		title={file.filename}
		onclick={() => (collapsed = !collapsed)}
	>
		<Icon name="chevron" class="chevron" turned={!collapsed} />
		<span class="path"><FilePath path={file.filename} /></span>
	</button>
	{#if collapsed && summary}
		<!-- A closed file says only that something in it wants you - findings
		     to confirm, or something new to read - as the slices do; it opens
		     on the first. -->
		{@const label = summary.count ? `${plural(summary.count, 'finding')} to confirm` : 'New to read'}
		{@const first = summary.first}
		<button class="notice" aria-label="{label} - open it" title={label} onclick={() => (session.revealing = first.id)}></button>
	{/if}
	<!-- The rest of the header opens and closes the file too. -->
	<button class="toggle rest" tabindex="-1" aria-hidden="true" onclick={() => (collapsed = !collapsed)}>
		<span class="gist faint" class:routine title={routinePlain}
			>{#if routine}<InlineText text={routine} />{:else if note?.note && collapsed}<InlineText
					text={`${note.kind === 'tests' ? 'Tests · ' : ''}${note.note.replace(/^- /, '').split('\n')[0]}`}
				/>{/if}</span
		>
		<span class="stat"><span class="plus">+{counts.added}</span> <span class="minus">−{counts.removed}</span></span>
	</button>
	<!-- In the gutter: on an open file, the findings and threads about the
	     whole file, which have no lines to sit on; then asking about it. -->
	<span class="pins">
		{#if !collapsed && (wholeFile.length || fileThreads.length || githubThreads.length)}
			{#each wholeFile as m (m.id)}
				<Pin
					kind="finding"
					id={m.id}
					skipped={m.included === false}
					filtered={!!m.filtered}
					active={session.openMark === m.id}
					unread={m.unread}
					unreadLabel="New answer"
					label="Finding about the whole file, from {m.who}"
					title="A finding about the whole file, from {m.who}"
					onclick={() => (session.openMark = session.openMark === m.id ? null : m.id)}
				/>
			{/each}
			{#each fileThreads as n (n.id)}
				<Pin
					kind="note"
					id={n.id}
					active={session.openMark === n.id}
					settled={isConcluded(n)}
					unread={isUnread(n)}
					unreadLabel="New reply"
					label="Your thread on the whole file"
					title="Your thread on the whole file"
					onclick={() => (session.openMark = session.openMark === n.id ? null : n.id)}
				/>
			{/each}
			{#each githubThreads as t (t.id)}
				{@const what = t.outdated ? 'outdated GitHub thread' : 'GitHub thread on the whole file'}
				{@const yours = session.record.notes.find((n) => n.github === t.id)}
				<Pin
					kind="github"
					id={t.id}
					active={session.openMark === t.id}
					settled={!!t.resolved}
					unread={!!yours && isUnread(yours)}
					unreadLabel="New reply"
					label="{t.entries[0]?.author ?? 'Someone'}'s {what}"
					title="{t.entries[0]?.author ?? 'Someone'}'s {what}"
					onclick={() => (session.openMark = session.openMark === t.id ? null : t.id)}
				/>
			{/each}
		{/if}
		<button
			class="comment-file"
			class:shown={composing}
			bind:this={commentButton}
			aria-label="Ask about or comment on the whole file"
			title="Ask about or comment on the whole file"
			onclick={() => (composing = !composing)}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
				><path d="M4 5h16v11H9l-5 4z" /><path d="M12 8.5v4M10 10.5h4" /></svg
			>
		</button>
	</span>
	{#if composing}
		<Floating anchor={commentButton} placement="bottom-end" pointer={false} label="Ask about or comment on the whole file">
			<div class="file-composer">
				<span class="faint">{file.filename.split('/').pop()} · the whole file</span>
				<Composer
					bind:value={draft}
					rows={2}
					autofocus
					actionsAlways
					placeholder="Ask about this file, or write a comment on it…"
					onsend={startThread}
					onescape={() => (composing = false)}
				/>
			</div>
		</Floating>
	{/if}
	<!-- Outside the pins, whose transform would trap the bubble under the diff. -->
	{#each wholeFile as m (m.id)}
		{#if session.openMark === m.id}
			<Floating anchor={openAnchor} label="Finding" tone="agent">
				<MarkPopover mark={m} onclose={() => (session.openMark = null)} />
			</Floating>
		{/if}
	{/each}
	{#each fileThreads as n (n.id)}
		{#if session.openMark === n.id}
			<Floating anchor={openAnchor} label="Thread">
				<ThreadPanel note={n} onclose={() => (session.openMark = null)} />
			</Floating>
		{/if}
	{/each}
	{#each githubThreads as t (t.id)}
		{#if session.openMark === t.id}
			<Floating anchor={openAnchor} label="GitHub thread">
				<GitHubThreadPanel thread={t} onclose={() => (session.openMark = null)} />
			</Floating>
		{/if}
	{/each}
	{#if onreview}
		<button class="review" class:done={reviewed} aria-pressed={reviewed} onclick={onreview}>
			<StateMark state={reviewed ? 'done' : 'todo'} size={15} />
			{reviewed ? 'Reviewed' : 'Mark reviewed'}
		</button>
	{/if}
</header>

<style>
	header {
		position: relative;
		display: flex;
		align-items: center;
		height: 52px;
	}
	.toggle {
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 4px 0 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 13.5px;
		text-align: left;
		cursor: pointer;
	}
	.toggle :global(.chevron) {
		flex-shrink: 0;
		color: var(--faint);
	}
	.name {
		flex: 0 1 auto;
	}
	.rest {
		flex: 1 0 0;
		margin-left: 6px;
		padding: 0 12px 0 10px;
		font-size: 12.5px;
		white-space: nowrap;
	}
	.toggle:hover :global(.chevron),
	.toggle:hover .path {
		color: #fff;
	}
	.path {
		display: flex;
		min-width: 0;
		flex-shrink: 1;
		font-family: var(--mono);
		color: var(--text);
		white-space: nowrap;
	}
	.gist {
		flex-grow: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* In place of the diff, so it reads a little stronger. */
	.gist.routine {
		color: var(--muted);
	}
	.stat {
		font-family: var(--mono);
		font-size: 12px;
		white-space: nowrap;
	}
	.plus {
		color: var(--plus-dull);
	}
	.minus {
		color: var(--minus-dull);
	}
	/* Hangs off the header's right edge, in line with the pins beside the code. */
	.pins {
		position: absolute;
		left: calc(100% + 8px);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		gap: 4px;
	}
	.notice {
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		margin-left: 10px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: var(--you);
		cursor: pointer;
	}
	/* Asking about the whole file, first in the gutter beside the file's
	   name, where the pins on its lines sit too. */
	.comment-file {
		display: grid;
		place-items: center;
		width: 20px;
		height: 18px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--faint);
		opacity: 0;
		cursor: pointer;
	}
	/* It appears as the header, or its place in the gutter, is hovered:
	   appearing is what says it's there to use. The gutter is within the
	   header, so hovering either shows it. */
	header:hover .comment-file,
	.comment-file:focus-visible,
	.comment-file.shown {
		opacity: 1;
	}
	.comment-file:hover,
	.comment-file.shown {
		color: var(--you-text);
	}
	.file-composer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 380px;
		padding: 12px 14px;
		font-family: var(--sans);
		font-size: 13px;
		white-space: normal;
	}
	.review {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex-shrink: 0;
		height: 30px;
		margin-left: 14px;
		padding: 0 11px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.review.done {
		color: var(--faint);
	}
	.review:hover {
		background: rgba(255, 255, 255, 0.04);
	}
</style>
