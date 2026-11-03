import { describe, expect, it } from 'vitest';
import { byFileOrder } from './fileOrder';

describe('byFileOrder', () => {
	it('sorts by path, with tests just after the file they test', () => {
		const paths = ['src/b.ts', 'src/a.test.ts', 'src/__tests__/b.ts', 'src/a.ts', 'README.md'];
		expect(paths.sort(byFileOrder)).toEqual(['README.md', 'src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/__tests__/b.ts']);
	});
});
