import { isLocalHost } from '$lib/api/localHost';

// Whether a provider's address is plain http to somewhere other than this
// machine, where its key would cross the network unencrypted.
export function sendsKeyInTheClear(baseUrl: string): boolean {
	try {
		const { protocol, hostname } = new URL(baseUrl.trim());
		return protocol === 'http:' && !isLocalHost(hostname);
	} catch {
		return false;
	}
}

export const CLEAR_WARNING = 'This address is plain http to another machine, so the key is sent unencrypted. Use https unless it is on this machine.';
