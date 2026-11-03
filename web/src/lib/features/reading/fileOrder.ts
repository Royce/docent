// The order files are read in: by path, except that tests sort just after
// the file they test - "src/a.test.ts" and "src/__tests__/a.ts" both sit
// beneath "src/a.ts". A sort key, to compare with localeCompare.
export function fileOrder(path: string): string {
	const isTest = /\.(test|spec)\.[^/]+$/.test(path) || /(^|\/)(__tests__|tests?)\//.test(path);
	const subject = path.replace(/(^|\/)(__tests__|tests?)\//, '$1').replace(/\.(test|spec)(\.[^/.]+)$/, '$2');
	return `${subject}\u0000${isTest ? 1 : 0}`;
}

export const byFileOrder = (a: string, b: string) => fileOrder(a).localeCompare(fileOrder(b));
