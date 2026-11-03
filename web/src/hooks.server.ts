import { json, type Handle } from '@sveltejs/kit';
// Keeps the stats from the start, so no review saved before they're first
// opened goes unrecorded.
import '$lib/features/stats/stats.server.js';
import { persistent } from '$lib/storage/persistent.server.js';
// Marks work left under way by the last run as interrupted.
import '$lib/storage/interrupted.server.js';
// Marks rounds posted before posting marked them done.
import '$lib/storage/postedDone.server.js';
import { modelOptions } from '$lib/models/modelProvider.server.js';
import { setupCheck } from '$lib/features/settings/setupChecks.server.js';
import { isLocalHost } from '$lib/api/localHost.js';

// What's installed and which models there are, looked at once the server
// starts, so the first page to ask has an answer waiting.
persistent('checks-warmed', () => {
	modelOptions.fresh().catch(() => {});
	setupCheck.fresh().catch(() => {});
	return true;
});

// Background work nothing waits on - saving a finished job, say - that fails
// anyway is logged, rather than stopping the server.
persistent('unhandled-rejections', () => process.on('unhandledRejection', (err) => console.error('[unhandled]', err)));

// MCP answers only requests addressed to this machine by name, so a site the
// browser has open can't reach it by pointing its own domain here.
export const handle: Handle = ({ event, resolve }) => {
	if (event.url.pathname === '/mcp' && !isLocalHost(hostnameOf(event.request.headers.get('host')))) {
		return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid Host' }, id: null }, { status: 403 });
	}
	return resolve(event);
};

function hostnameOf(host: string | null): string {
	try {
		return host ? new URL(`http://${host}`).hostname : '';
	} catch {
		return '';
	}
}
