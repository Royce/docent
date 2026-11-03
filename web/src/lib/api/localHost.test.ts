import { describe, expect, it } from 'vitest';
import { isLocalHost } from './localHost';

describe('isLocalHost', () => {
	it('accepts loopback names and addresses', () => {
		for (const host of ['localhost', '127.0.0.1', '[::1]', 'docent.localhost', 'a.b.localhost']) expect(isLocalHost(host)).toBe(true);
	});

	it('rejects anything else', () => {
		for (const host of ['', 'example.com', 'localhost.example.com', 'notlocalhost', '192.168.1.2']) expect(isLocalHost(host)).toBe(false);
	});
});
