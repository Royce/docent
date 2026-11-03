import { json } from '@sveltejs/kit';
import { DEFAULT_REVIEWER, REVIEWER_RE } from '../features/panel/agentReviews.server.js';
import { isLocalHost } from './localHost.js';
import { rememberMcpUrl } from './mcpUrl.server.js';

// What Docent's API routes share: checking a PR's owner, repo and number,
// reading a JSON body, and answering with an error.

const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;
const NUMBER_RE = /^[0-9]+$/;

export function validParams(owner: string, repo: string, number: string): boolean {
	return OWNER_REPO_RE.test(owner) && OWNER_REPO_RE.test(repo) && NUMBER_RE.test(number);
}

export const badRequest = (error: string) => json({ error }, { status: 400 });
export const notFound = (error: string) => json({ error }, { status: 404 });
export const noContent = () => new Response(null, { status: 204 });
export const forbidden = (error: string) => json({ error }, { status: 403 });

// Whether a request is from Docent's own page on this machine, for the
// routes that save or run a command: another site can POST here without a
// preflight, and a domain rebound to this machine brings its own Host and
// Origin. The page's host is matched but not its scheme, since a local https
// proxy such as portless hands the server plain http.
export function fromThisApp(request: Request, url: URL): boolean {
	if (!isLocalHost(url.hostname)) return false;
	try {
		return new URL(request.headers.get('origin') ?? '').host === url.host;
	} catch {
		return false;
	}
}

// A failure from GitHub or a model, reported to the page.
export const failed = (err: unknown) => json({ error: (err as Error).message }, { status: 502 });

// The request's JSON body, or an empty one.
export async function bodyOf(request: Request): Promise<Record<string, any>> {
	try {
		const body = await request.json();
		return body && typeof body === 'object' ? body : {};
	} catch {
		return {};
	}
}

// The review's own model, when the request names one; otherwise the model
// picked on the start page is used.
export function reviewModel(body: Record<string, any>): string | undefined {
	const model = body?.model;
	return typeof model === 'string' && model.trim() && model.length <= 200 ? model.trim() : undefined;
}

// Which of the PR's reviewer entries a request is about: `?reviewer=agent-2`,
// or the first one.
export function reviewerParam(url: URL): string | null {
	const reviewer = url.searchParams.get('reviewer') ?? DEFAULT_REVIEWER;
	return REVIEWER_RE.test(reviewer) ? reviewer : null;
}

// Docent's MCP endpoint, as a session started from this request reaches it.
export const mcpUrl = (url: URL) => rememberMcpUrl(`${url.origin}/mcp`);
