<script lang="ts">
	import { prUrl } from '$lib/api/client';
	import Icon from '$lib/ui/Icon.svelte';
	import { onDismiss } from '$lib/ui/dismiss';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { looseGitHubThreads, type Mark } from './marks';
	import type { FileNote, LineRef, PrFile, PrRef } from '$lib/types';
	import { lineSpan } from '$lib/types';
	import { highlightHunks, segments, type Token } from '$lib/features/reading/diff/highlight';
	import {
		EXPAND_STEP,
		expandHunk,
		withRemoved,
		expansionFor,
		nearestHunk,
		fileLines,
		gapAbove,
		gapBelow,
		hideWhitespace,
		layout,
		wordEdits,
		type Expansion,
		type Hunk,
		type Row
	} from '$lib/features/reading/diff/parse';
	import InlineText from '../../ui/InlineText.svelte';
	import Composer, { type SendKind } from './Composer.svelte';
	import FileHeader from './FileHeader.svelte';
	import FoldRow from './FoldRow.svelte';
	import HiddenMarks from './HiddenMarks.svelte';
	import Pin from './Pin.svelte';
	import { quietPieces, roundPieces } from './quietFolds';
	import { isConcluded, useSession } from '$lib/session/session.svelte';
	import { isUnread } from '$lib/types';
	import type { ReferenceElement } from '@floating-ui/dom';
	import Floating from '../../ui/Floating.svelte';
	import MarkPopover from '../panel/MarkPopover.svelte';
	import { testTitleLines } from '$lib/features/reading/testTitles';
	import ThreadPanel from './ThreadPanel.svelte';
	import GitHubThreadPanel from './GitHubThreadPanel.svelte';
	import NoteText from '../../ui/NoteText.svelte';
	import { noDiffReason } from './progress';

	let {
		file,
		allHunks,
		hunkIndices = null,
		marks = [],
		note,
		routine,
		prRef,
		whitespace = false,
		reviewed = false,
		onToggleReviewed,
		fold = null,
		onopenchange,
		foldTests = true,
		showRemoved = false
	}: {
		file: PrFile;
		// Every hunk in the file, shown or not: expansion stops at its neighbours.
		allHunks: Hunk[];
		hunkIndices?: number[] | null;
		marks?: Mark[];
		note?: FileNote;
		// A routine change, in one line: the file starts closed, saying it.
		routine?: string;
		prRef: PrRef;
		// Show whitespace-only changes as changes.
		whitespace?: boolean;
		reviewed?: boolean;
		onToggleReviewed?: () => void;
		// The page's last "expand all" or "collapse all", if any.
		fold?: { open: boolean; at: number } | null;
		// Told whenever the file opens or closes, and that it's closed when it goes.
		onopenchange?: (open: boolean) => void;
		// Fold test code between the scenario lines the note marks.
		foldTests?: boolean;
		// Put back what a round removed of the PR's own lines.
		showRemoved?: boolean;
	} = $props();

	const shownIndices = $derived(new Set(hunkIndices ?? allHunks.map((h) => h.index)));
	// Reviewing a range of commits, the PR's other changes are shown plainly,
	// as the context the range's changes sit in.
	const rangeNew = $derived(file.rangeLines && new Set(file.rangeLines.new));
	const rangeOld = $derived(file.rangeLines && new Set(file.rangeLines.old));
	const earlier = (r: Row) =>
		!r.removed && !!rangeNew && !!rangeOld && ((r.kind === 'add' && !rangeNew.has(r.new!)) || (r.kind === 'del' && !rangeOld.has(r.old!)));
	// A finding belongs with the hunk holding its line, or the nearest one
	// for a line outside the diff; only those in hunks shown here count here.
	const homeOf = (m: Mark) => (m.note?.hunk !== undefined ? allHunks[m.note.hunk] : nearestHunk(allHunks, m.start));
	const findingMarks = $derived(marks.filter((m) => m.kind === 'finding' && shownIndices.has(homeOf(m)?.index ?? -1)));
	const threadMarks = $derived(marks.filter((m) => m.kind === 'note' && shownIndices.has(homeOf(m)?.index ?? -1)));

	// Unchanged lines shown around each hunk. They come from the file as it
	// was, fetched the first time any are asked for.
	let requested = $state<Record<number, Expansion>>({});
	let oldLines = $state<string[] | null>(null);
	let loadingOld: Promise<void> | null = null;
	const canExpand = $derived(file.status !== 'added');

	// Lines threads were begun on, or findings point at, outside their hunk's
	// diff, which have to be shown too.
	const needed = $derived.by(() => {
		const out: Record<number, Expansion> = {};
		for (const m of marks) {
			const h = homeOf(m);
			if (!h || (!m.note && !shownIndices.has(h.index))) continue;
			const e = expansionFor(h, m.start, m.end);
			const prev = out[h.index] ?? { up: 0, down: 0 };
			out[h.index] = { up: Math.max(prev.up, e.up), down: Math.max(prev.down, e.down) };
		}
		return out;
	});
	$effect(() => {
		if (canExpand && Object.values(needed).some((e) => e.up || e.down)) loadOld();
	});

	const expansion = $derived.by(() => {
		const out: Expansion[] = [];
		for (const h of allHunks) {
			const i = h.index;
			const asked = requested[i] ?? { up: 0, down: 0 };
			const need = needed[i] ?? { up: 0, down: 0 };
			const want = { up: Math.max(asked.up, need.up), down: Math.max(asked.down, need.down) };
			if (!oldLines) {
				out[i] = { up: 0, down: 0 };
				continue;
			}
			const up = Math.min(want.up, gapAbove(allHunks, i) - (out[i - 1]?.down ?? 0));
			const down = Math.min(want.down, gapBelow(allHunks, i, oldLines.length));
			out[i] = { up: Math.max(0, up), down: Math.max(0, down) };
		}
		return out;
	});

	// Lines still hidden above and below a hunk; below the last one is unknown
	// until the old file is fetched.
	function hiddenAbove(i: number): number {
		return canExpand ? gapAbove(allHunks, i) - expansion[i].up - (expansion[i - 1]?.down ?? 0) : 0;
	}
	function hiddenBelow(i: number): number {
		if (!canExpand) return 0;
		if (!oldLines) return i < allHunks.length - 1 ? gapBelow(allHunks, i, 0) : 1;
		return gapBelow(allHunks, i, oldLines.length) - expansion[i].down - (expansion[i + 1]?.up ?? 0);
	}

	function loadOld(): Promise<void> {
		loadingOld ??= fetch(`${prUrl(prRef)}/old-content?path=${encodeURIComponent(file.previous_filename ?? file.filename)}`)
			.then((res) => (res.ok ? res.json() : { content: null }))
			.then((data: { content: string | null }) => {
				oldLines = fileLines(data.content ?? '');
			})
			.catch(() => {
				loadingOld = null;
			});
		return loadingOld ?? Promise.resolve();
	}

	async function expand(i: number, direction: 'up' | 'down') {
		if (!oldLines) await loadOld();
		const now = expansion[i] ?? { up: 0, down: 0 };
		requested = { ...requested, [i]: { ...now, [direction]: now[direction] + EXPAND_STEP } };
	}

	const hunks = $derived(
		allHunks
			.filter((h) => shownIndices.has(h.index))
			.map((h) => (oldLines ? expandHunk(h, expansion[h.index], oldLines) : h))
			.map((h) => (whitespace ? h : hideWhitespace(h)))
			.map((h) => (showRemoved && file.rangeRemoved ? withRemoved(h, file.rangeRemoved) : h))
			// The PR's earlier deletions are neither in the file now nor this
			// round's doing, so a round leaves them out.
			.map((h) => (rangeOld ? { ...h, rows: h.rows.filter((r) => !(r.kind === 'del' && earlier(r))) } : h))
	);
	const expanded = new SvelteSet<string>();
	const items = $derived(layout(hunks, expanded));
	const edits = $derived(wordEdits(hunks));

	let tokens = $state(new Map<string, Token[]>());
	$effect(() => {
		const current = hunks;
		let live = true;
		highlightHunks(current, file.filename).then((t) => live && (tokens = t));
		return () => (live = false);
	});

	// Quiet code folds; see quietFolds.ts.
	const openFolds = new SvelteSet<string>();
	// Read from the code where a framework's tests can be recognised; the
	// file note's lines otherwise, since a model's line counts can drift.
	const scenarioLines = $derived.by(() => {
		if (!foldTests || note?.kind !== 'tests') return new Set<number>();
		const found = testTitleLines(allHunks.flatMap((h) => h.rows));
		return found.size ? found : new Set(note.scenarioLines ?? []);
	});
	const quietRanges = $derived(foldTests ? (note?.quietRanges ?? []) : []);

	// Where the round removed lines - shown or not - so the same lines show
	// around them in either view.
	const removedAt = $derived(new Set((file.rangeRemoved ?? []).map((run) => run.at)));
	const isRoundRow = (r: Row) =>
		!!r.removed ||
		((r.kind === 'add' || r.kind === 'del') && !earlier(r)) ||
		(r.kind !== 'del' && r.new !== undefined && (removedAt.has(r.new) || removedAt.has(r.new + 1)));
	// A round's hunks fold to its own changes; any other diff folds its quiet code.
	const piecesOf = $derived(new Map(hunks.map((h) => [h.index, rangeNew ? roundPieces(h, isRoundRow) : quietPieces(h, quietRanges, scenarioLines)])));
	const visible = (h: Hunk) => (piecesOf.get(h.index) ?? []).flatMap((p) => (p.type === 'row' ? [p.row] : openFolds.has(p.id) ? p.rows : []));

	// The rows on screen, in order: a mark's range and a selection are both
	// spans of these.
	const shown = $derived(items.flatMap((item) => (item.type === 'hunk' ? [item.hunk] : item.expanded ? item.hunks : []).flatMap(visible)));

	// Marks on lines a fold is hiding, shown on the fold instead.
	const matchesRow = (r: Row, ref: LineRef) => (ref.side === 'new' ? r.new === ref.line && r.kind !== 'del' : r.old === ref.line && r.kind !== 'add');
	const hiddenMarks = (rows: Row[]) => marks.filter((m) => rows.some((r) => matchesRow(r, m.start)));
	const position = $derived(new Map(shown.map((r, i) => [r.key, i])));

	function rowAt(ref: LineRef): Row | undefined {
		return shown.find((r) => (ref.side === 'new' ? r.new === ref.line && r.kind !== 'del' : r.old === ref.line && r.kind !== 'add'));
	}

	const placed = $derived(
		marks.flatMap((mark) => {
			const start = rowAt(mark.start);
			if (!start) return [];
			const end = rowAt(mark.end) ?? start;
			const a = position.get(start.key)!;
			const b = position.get(end.key)!;
			return [{ mark, from: Math.min(a, b), to: Math.max(a, b), at: start.key }];
		})
	);
	const pinsAt = $derived(placed.reduce((by, p) => by.set(p.at, [...(by.get(p.at) ?? []), p]), new Map<string, typeof placed>()));

	let hovered = $state<string | null>(null);

	// How a row is tinted by the marks covering it: the one being looked at
	// shows strongest.
	function tint(pos: number): string {
		const covering = placed.filter((p) => pos >= p.from && pos <= p.to);
		if (!covering.length) return '';
		const active = covering.find((p) => p.mark.id === session.openMark || p.mark.id === hovered);
		const kind = (active ?? covering[0]).mark.kind;
		return `tint-${kind}${active ? ' tint-active' : ''}`;
	}

	// Dragging down the line numbers selects lines to ask about.
	const SELECT_HINT = 'Drag down the line numbers to ask about or comment on those lines';
	let selection = $state<{ anchor: number; head: number } | null>(null);
	let dragging = $state(false);
	const selFrom = $derived(selection ? Math.min(selection.anchor, selection.head) : -1);
	const selTo = $derived(selection ? Math.max(selection.anchor, selection.head) : -1);

	const session = useSession();
	// Findings about this file as a whole, with no lines to sit on: they sit
	// on its header, open or closed.
	const wholeFile = $derived([
		...session.looseFindings.filter((f) => f.mark.path === file.filename).map((f) => f.mark),
		...session.filteredLoose.filter((m) => m.path === file.filename)
	]);
	// Your threads on the file as a whole, which sit on its header too.
	const fileThreads = $derived(session.record.notes.filter((n) => n.path === file.filename && !n.start));

	// The file on GitHub's view of the PR, for one there's no diff of here:
	// GitHub anchors each file by its path's SHA-256.
	let anchor = $state('');
	const githubFile = $derived(`https://github.com/${prRef.owner}/${prRef.repo}/pull/${prRef.number}/files${anchor}`);
	$effect(() => {
		if (file.patch) return;
		crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.filename)).then((hash) => {
			anchor = `#diff-${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
		});
	});
	// In a slice, the lines this slice's hunks change, not the whole file's.
	// In a round of some commits, only the round's own changes count - what
	// it removed of the PR's own lines too, shown or not - as GitHub counts
	// that range.
	const sliceCounts = $derived.by(() => {
		if (!file.patch || (!hunkIndices && !rangeNew)) return null;
		let added = 0;
		let removed = 0;
		for (const h of allHunks) {
			if (!shownIndices.has(h.index)) continue;
			for (const r of h.rows) {
				if (rangeNew && rangeOld && earlier(r)) continue;
				if (r.kind === 'add') added++;
				else if (r.kind === 'del') removed++;
			}
			if (file.rangeRemoved) removed += withRemoved(h, file.rangeRemoved).rows.filter((r) => r.removed).length;
		}
		return { added, removed };
	});
	// A closed file's one marker, while any finding awaits confirming or
	// anything is new to read: a finding, an answer about one, or a reply in a
	// thread. With findings to confirm it's solid when one would go in - an
	// unconfirmed Keep, or a suggested skip beside anything kept - outlined
	// when all that's left is suggested skips, and opens the first of them.
	// Otherwise it's the first thing new to read, and opens that.
	const summary = $derived.by(() => {
		const all = [...findingMarks, ...wholeFile].filter((m) => !m.filtered);
		const unconfirmed = all.filter((m) => !m.decided);
		const unread = [
			...all.filter((m) => m.unread),
			...threadMarks.filter((m) => m.note && isUnread(m.note)),
			...fileThreads.filter(isUnread).map((n) => ({ id: n.id, kind: 'note' as const, included: true }))
		];
		const kept = (m: { included?: boolean }) => m.included !== false;
		if (unconfirmed.length) {
			const solid = unconfirmed.some(kept) || all.some(kept);
			return { kind: 'finding' as const, first: unconfirmed[0], solid, unread: unread.length > 0, count: unconfirmed.length };
		}
		if (!unread.length) return null;
		const first = unread[0];
		return { kind: first.kind === 'finding' ? ('finding' as const) : ('note' as const), first, solid: kept(first), unread: true, count: 0 };
	});
	let draft = $state('');

	// A thread on the selected lines, kept with the hunk the selection starts
	// in and the lines as they read now. It starts with a question for
	// Docent, or with a comment to post as written.
	function startThread(text: string, kind: SendKind) {
		if (!selection) return;
		const comment = kind === 'comment';
		// Lines a round removed aren't in either file, so there's nothing to anchor to.
		const rows = shown.slice(selFrom, selTo + 1).filter((r) => !r.removed);
		const ref = (r: Row): LineRef => (r.kind === 'del' ? { side: 'old', line: r.old! } : { side: 'new', line: r.new! });
		const id = session.conversations.createNote(
			{
				path: file.filename,
				hunk: parseInt(rows[0].key, 10),
				start: ref(rows[0]),
				end: ref(rows[rows.length - 1]),
				code: rows.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`).join('\n')
			},
			text,
			{ comment }
		);
		selection = null;
		session.openMark = id;
	}

	// What the open bubble and the composer point at: the pin, and the code
	// of the selection's last line. Looked up once they're on the page.
	let sectionEl = $state<HTMLElement | null>(null);
	let openAnchor = $state<HTMLElement | null>(null);
	let composerAnchor = $state<ReferenceElement | null>(null);
	$effect(() => {
		const id = session.openMark;
		if (!id || !sectionEl) {
			openAnchor = null;
			return;
		}
		requestAnimationFrame(() => (openAnchor = sectionEl?.querySelector<HTMLElement>(`[data-pin="${id}"]`) ?? null));
	});
	$effect(() => {
		if (!selection || dragging || !sectionEl) {
			composerAnchor = null;
			return;
		}
		const [from, to] = [selFrom, selTo];
		requestAnimationFrame(() => {
			const first = sectionEl?.querySelector<HTMLElement>(`[data-pos="${from}"] .code`);
			const last = sectionEl?.querySelector<HTMLElement>(`[data-pos="${to}"] .code`);
			// The whole selection, so the composer sits clear of it above or below.
			composerAnchor =
				first && last
					? {
							contextElement: first,
							getBoundingClientRect: () => {
								const a = first.getBoundingClientRect();
								const b = last.getBoundingClientRect();
								return new DOMRect(a.left, a.top, a.width, b.bottom - a.top);
							}
						}
					: null;
		});
	});

	// Brings a thread or finding into view when asked to: opens the file and
	// any fold hiding it, then opens its bubble.
	$effect(() => {
		const id = session.revealing;
		if (!id) return;
		untrack(() => {
			if (
				wholeFile.some((m) => m.id === id) ||
				fileThreads.some((n) => n.id === id) ||
				looseGitHubThreads(session.githubInReading, file.filename).some((t) => t.id === id)
			) {
				session.revealing = null;
				collapsed = false;
				session.openMark = id;
				requestAnimationFrame(() => sectionEl?.querySelector(`[data-pin="${id}"]`)?.scrollIntoView({ block: 'center' }));
				return;
			}
			const mark = marks.find((m) => m.id === id);
			if (!mark) return;
			session.revealing = null;
			collapsed = false;
			for (const list of piecesOf.values()) for (const p of list) if (p.type === 'fold' && p.rows.some((r) => matchesRow(r, mark.start))) openFolds.add(p.id);
			for (const item of items) if (item.type === 'fold' && item.hunks.some((h) => h.rows.some((r) => matchesRow(r, mark.start)))) expanded.add(item.id);
			session.openMark = id;
			requestAnimationFrame(() => requestAnimationFrame(() => sectionEl?.querySelector(`[data-pin="${id}"]`)?.scrollIntoView({ block: 'center' })));
		});
	});

	// A click anywhere but the open thread, finding or composer closes it.
	$effect(() => {
		if (!session.openMark && !(selection && !dragging)) return;
		return onDismiss(
			() => {
				session.openMark = null;
				selection = null;
			},
			'.popover, .composer, .pin, .n, [role="dialog"], .scrim',
			{ escape: false }
		);
	});

	function startSelect(e: PointerEvent, pos: number) {
		if (e.button !== 0) return;
		e.preventDefault();
		session.openMark = null;
		dragging = true;
		selection = { anchor: pos, head: pos };
		window.addEventListener('pointerup', () => (dragging = false), { once: true });
	}

	// Named by the new file's lines, or the old file's when only removed
	// lines are selected.
	function describe(from: number, to: number): string {
		const rows = shown.slice(from, to + 1);
		const side = rows.some((r) => r.new !== undefined) ? 'new' : 'old';
		const nums = rows.map((r) => r[side]).filter((n) => n !== undefined);
		const first = nums[0];
		const last = nums[nums.length - 1];
		const label = lineSpan(first, last);
		return side === 'old' ? `${label} (removed)` : label;
	}

	function foldLines(item: { hunks: { rows: Row[] }[] }): string {
		const at = item.hunks.map((h) => h.rows.find((r) => r.kind !== 'context')).map((r) => r?.new ?? r?.old);
		return at.length > 4 ? `${at.slice(0, 4).join(', ')}, …` : at.join(', ');
	}

	// Reviewed files start closed, and close when marked reviewed; so do
	// routine ones, whose one line says all they need to - unless something
	// sits on them, a finding or a thread, which is then worth seeing.
	const markedHere = () =>
		marks.some((m) => !m.filtered && shownIndices.has(homeOf(m)?.index ?? -1)) ||
		wholeFile.some((m) => !m.filtered) ||
		fileThreads.length > 0 ||
		looseGitHubThreads(session.githubInReading, file.filename).length > 0;
	let collapsed = $state(untrack(() => reviewed || (!!routine && !markedHere())));

	$effect(() => {
		if (fold) collapsed = !fold.open;
	});

	$effect(() => {
		onopenchange?.(!collapsed);
		return () => onopenchange?.(false);
	});

	// Reviewed folds a file away; un-marking it opens it again to look.
	function toggleReviewed() {
		collapsed = !reviewed;
		onToggleReviewed?.();
	}
</script>

{#snippet row(r: Row)}
	{@const pos = position.get(r.key)!}
	{@const pins = pinsAt.get(r.key)}
	<div
		class="row {r.kind} {tint(pos)}"
		data-pos={pos}
		class:selected={pos >= selFrom && pos <= selTo}
		class:earlier={earlier(r)}
		role="presentation"
		onpointerenter={() => dragging && selection && (selection = { ...selection, head: pos })}
	>
		{#if r.removed}
			<span class="n removed-n" title="Removed in this round, from the PR's own changes" aria-label="Removed in this round"></span>
			<span class="n removed-n"></span>
		{:else}
			<span class="n" role="presentation" title={SELECT_HINT} onpointerdown={(e) => startSelect(e, pos)}>{r.old ?? ''}</span>
			<span class="n" role="presentation" title={SELECT_HINT} onpointerdown={(e) => startSelect(e, pos)}>{r.new ?? ''}</span>
		{/if}
		<span class="code"
			>{#each segments(r.text, tokens.get(r.key), edits.get(r.key)) as s, i (i)}<span class:edit={s.edit} style:color={s.color}>{s.text}</span>{/each}</span
		>
		<span class="gutter">
			{#each pins ?? [] as p (p.mark.id)}
				<Pin
					kind={p.mark.kind}
					id={p.mark.id}
					skipped={p.mark.kind === 'finding' && p.mark.included === false}
					filtered={!!p.mark.filtered}
					active={session.openMark === p.mark.id}
					unread={p.mark.kind === 'finding' ? !!p.mark.unread : !!p.mark.note && isUnread(p.mark.note)}
					settled={(!!p.mark.note && isConcluded(p.mark.note)) || !!p.mark.github?.resolved}
					unreadLabel={p.mark.kind === 'finding' ? 'New answer' : 'New reply'}
					label="{p.mark.kind === 'finding' ? 'Finding' : p.mark.kind === 'github' ? 'GitHub thread' : 'Thread'} from {p.mark.who}"
					onclick={() => (session.openMark = session.openMark === p.mark.id ? null : p.mark.id)}
					onpointerenter={() => (hovered = p.mark.id)}
					onpointerleave={() => (hovered = null)}
				/>
			{/each}
		</span>
		{#each pins ?? [] as p (p.mark.id)}
			{#if session.openMark === p.mark.id}
				<Floating
					anchor={openAnchor}
					label={p.mark.github ? 'GitHub thread' : p.mark.note ? 'Thread' : 'Finding'}
					tone={p.mark.kind === 'finding' ? 'agent' : 'plain'}
				>
					{#if p.mark.github}
						<GitHubThreadPanel thread={p.mark.github} onclose={() => (session.openMark = null)} />
					{:else if p.mark.note}
						<ThreadPanel note={p.mark.note} onclose={() => (session.openMark = null)} />
					{:else}
						<MarkPopover mark={p.mark} onclose={() => (session.openMark = null)} />
					{/if}
				</Floating>
			{/if}
		{/each}
		{#if selection && !dragging && pos === selTo}
			<Floating anchor={composerAnchor} placement="bottom-start" fallback={['top-start']} pointer={false} label="Ask or comment on {describe(selFrom, selTo)}">
				<div class="composer">
					<div class="composer-head">
						<span class="faint">{describe(selFrom, selTo)}</span>
						<button class="icon" aria-label="Cancel" title="Cancel" onclick={() => (selection = null)}>
							<Icon name="close" size={15} />
						</button>
					</div>
					<Composer
						bind:value={draft}
						rows={2}
						autofocus
						actionsAlways
						placeholder="Ask Docent, or write a comment to post as written…"
						onsend={startThread}
						onescape={() => (selection = null)}
					/>
				</div>
			</Floating>
		{/if}
	</div>
{/snippet}

{#snippet hunkBlock(hunk: Hunk)}
	<div class="hunk-header">
		<span class="hunk-text">{hunk.header}</span>
		{#if hiddenAbove(hunk.index) > 0}
			<button class="expand" onclick={() => expand(hunk.index, 'up')}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
					><path d="M12 19V5M6 11l6-6 6 6" /></svg
				>
				{Math.min(EXPAND_STEP, hiddenAbove(hunk.index))} more lines
			</button>
		{/if}
	</div>
	{#each piecesOf.get(hunk.index) ?? [] as piece (piece.type === 'row' ? piece.row.key : piece.id)}
		{#if piece.type === 'row'}
			{@render row(piece.row)}
		{:else}
			{@const id = piece.id}
			<FoldRow
				rows={piece.rows}
				label={piece.label}
				round={piece.round}
				open={openFolds.has(id)}
				hidden={hiddenMarks(piece.rows)}
				ontoggle={() => (openFolds.has(id) ? openFolds.delete(id) : openFolds.add(id))}
			/>
			{#if openFolds.has(piece.id)}{#each piece.rows as r (r.key)}{@render row(r)}{/each}{/if}
		{/if}
	{/each}
	{#if !shownIndices.has(hunk.index + 1) && hiddenBelow(hunk.index) > 0}
		<div class="hunk-footer">
			<button class="expand" onclick={() => expand(hunk.index, 'down')}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
					><path d="M12 5v14M6 13l6 6 6-6" /></svg
				>
				{oldLines ? `${Math.min(EXPAND_STEP, hiddenBelow(hunk.index))} more lines` : 'More lines'}
			</button>
		</div>
	{/if}
{/snippet}

<section class="file" data-path={file.filename} bind:this={sectionEl}>
	<FileHeader
		{file}
		{note}
		{routine}
		bind:collapsed
		counts={sliceCounts ?? { added: file.additions, removed: file.deletions }}
		{summary}
		{wholeFile}
		{fileThreads}
		{openAnchor}
		{reviewed}
		onreview={onToggleReviewed ? toggleReviewed : undefined}
	/>
	{#if !collapsed && note?.note}
		<div class="file-note">
			<NoteText text={note.note} />
			{#if note.quality}<p><InlineText text={note.quality} /></p>{/if}
		</div>
	{/if}
	{#if !collapsed && !file.patch}
		<div class="diff unshown">
			<span class="faint">{noDiffReason(file)}</span>
			<a href={githubFile} target="_blank" rel="noreferrer">View on GitHub</a>
		</div>
	{:else if !collapsed}
		<div class="diff">
			{#each items as item (item.type === 'hunk' ? `h${item.hunk.index}` : item.id)}
				{#if item.type === 'hunk'}
					{@render hunkBlock(item.hunk)}
				{:else}
					<button class="fold" aria-expanded={item.expanded} onclick={() => (item.expanded ? expanded.delete(item.id) : expanded.add(item.id))}>
						<Icon name="chevron" size={14} turned={item.expanded} />
						{item.expanded ? 'Showing' : 'The same change in'}
						{item.hunks.length} more places
						<span class="faint">· lines {foldLines(item)}</span>
						<HiddenMarks marks={item.expanded ? [] : hiddenMarks(item.hunks.flatMap((h) => h.rows))} />
					</button>
					{#if item.expanded}
						{#each item.hunks as hunk (hunk.index)}{@render hunkBlock(hunk)}{/each}
					{/if}
				{/if}
			{/each}
		</div>
	{/if}
</section>

<style>
	.file {
		border-bottom: 1px solid var(--line);
	}
	.file-note {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 860px;
		padding: 2px 0 16px 30px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted);
	}
	.file-note p {
		margin: 0;
	}
	.diff {
		margin-bottom: 18px;
		padding-bottom: 6px;
		border-radius: 12px;
		background: var(--code-bg);
	}
	.unshown {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 16px;
		font-size: 13.5px;
	}
	.hunk-header,
	.hunk-footer {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 30px;
		padding: 0 8px 0 16px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--hunk-text);
	}
	.hunk-header {
		background: var(--hunk-bg);
	}
	.hunk-text {
		flex-grow: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hunk-footer {
		justify-content: flex-end;
	}
	.diff > .hunk-footer:last-child {
		border-radius: 0 0 12px 12px;
	}
	.expand {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--faint);
		font-family: var(--sans);
		font-size: 12.5px;
		cursor: pointer;
	}
	.expand:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text);
	}
	.diff > .hunk-header:first-child {
		border-radius: 12px 12px 0 0;
	}
	.row {
		position: relative;
		display: grid;
		grid-template-columns: 48px 48px minmax(0, 1fr);
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 22px;
		tab-size: 4;
	}
	.row.add {
		background: var(--add-bg);
	}
	.row.del {
		background: var(--del-bg);
	}
	/* The PR's earlier changes, there as context for the round's: read as
	   plainly as unchanged lines, so only the round's own read as changes. */
	.row.add.earlier,
	.row.del.earlier {
		background: none;
	}
	.row.earlier .edit {
		background: none;
	}
	.removed-n {
		cursor: default;
	}
	.row.tint-finding .code {
		background-image: linear-gradient(var(--agent-tint), var(--agent-tint));
	}
	.row.tint-note .code {
		background-image: linear-gradient(var(--you-tint), var(--you-tint));
	}
	.row.tint-github .code {
		background-image: linear-gradient(rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.035));
	}
	.row.tint-github.tint-active .code {
		box-shadow: inset 2px 0 0 var(--muted);
	}
	.row.tint-active .code {
		box-shadow: inset 2px 0 0 var(--agent);
	}
	.row.tint-note.tint-active .code {
		box-shadow: inset 2px 0 0 var(--you);
	}
	.row.selected .n,
	.row.selected .code {
		background-color: var(--selection);
	}
	.n {
		color: var(--line-num);
		text-align: right;
		padding-right: 14px;
		user-select: none;
		cursor: row-resize;
	}
	.n:hover {
		color: var(--muted);
	}
	.code {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding-left: 8px;
		color: var(--code-text);
	}
	.del .edit {
		background: var(--del-edit);
		border-radius: 2px;
	}
	.add .edit {
		background: var(--add-edit);
		border-radius: 2px;
	}
	/* Threads and findings hang off the block's right edge, as folds hang
	   off its left, so the code and its highlights keep the full width. */
	.gutter {
		position: absolute;
		left: calc(100% + 8px);
		top: 2px;
		display: flex;
		gap: 4px;
	}
	.fold {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 36px;
		padding: 0 16px 0 104px;
		border: 0;
		border-top: 1px dashed var(--line-2);
		border-bottom: 1px dashed var(--line-2);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
		background: var(--surface);
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		font-family: var(--sans);
		font-size: 13px;
		white-space: normal;
	}
	.composer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
</style>
