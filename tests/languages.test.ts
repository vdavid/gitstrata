import { describe, it, expect } from 'vitest';
import {
	getLanguageByExtension,
	resolveHeaderLanguage,
	matchPattern,
	isTestFile,
	isInTestDir,
	countRustInlineTestLines
} from '../src/lib/languages';

describe('getLanguageByExtension', () => {
	it('maps .ts to TypeScript', () => {
		expect(getLanguageByExtension('.ts')?.id).toBe('typescript');
	});

	it('maps .py to Python', () => {
		expect(getLanguageByExtension('.py')?.id).toBe('python');
	});

	it('maps .rs to Rust', () => {
		expect(getLanguageByExtension('.rs')?.id).toBe('rust');
	});

	it('maps .go to Go', () => {
		expect(getLanguageByExtension('.go')?.id).toBe('go');
	});

	it('maps .svelte to Svelte', () => {
		expect(getLanguageByExtension('.svelte')?.id).toBe('svelte');
	});

	it('maps .md to Docs (meta)', () => {
		const lang = getLanguageByExtension('.md');
		expect(lang?.id).toBe('docs');
		expect(lang?.isMeta).toBe(true);
	});

	it('maps .json to Config (meta)', () => {
		const lang = getLanguageByExtension('.json');
		expect(lang?.id).toBe('config');
		expect(lang?.isMeta).toBe(true);
	});

	it('returns undefined for unknown extensions', () => {
		expect(getLanguageByExtension('.xyz')).toBeUndefined();
	});

	it('is case-insensitive', () => {
		expect(getLanguageByExtension('.TS')?.id).toBe('typescript');
	});

	it('maps .h to C by default', () => {
		expect(getLanguageByExtension('.h')?.id).toBe('c');
	});
});

describe('resolveHeaderLanguage', () => {
	it('assigns .h to C when no C++ files exist', () => {
		const map = resolveHeaderLanguage(new Set(['.c', '.h']));
		expect(map.get('.h')?.id).toBe('c');
	});

	it('reassigns .h to C++ when .cpp files exist', () => {
		const map = resolveHeaderLanguage(new Set(['.cpp', '.h']));
		expect(map.get('.h')?.id).toBe('cpp');
	});

	it('reassigns .h to C++ when .cc files exist', () => {
		const map = resolveHeaderLanguage(new Set(['.cc', '.h']));
		expect(map.get('.h')?.id).toBe('cpp');
	});

	it('reassigns .h to C++ when .cxx files exist', () => {
		const map = resolveHeaderLanguage(new Set(['.cxx', '.h']));
		expect(map.get('.h')?.id).toBe('cpp');
	});
});

describe('matchPattern', () => {
	it('matches exact filename', () => {
		expect(matchPattern('conftest.py', 'conftest.py')).toBe(true);
	});

	it('matches prefix wildcard', () => {
		expect(matchPattern('test_utils.py', 'test_*.py')).toBe(true);
	});

	it('matches suffix wildcard', () => {
		expect(matchPattern('utils_test.py', '*_test.py')).toBe(true);
	});

	it('matches middle wildcard', () => {
		expect(matchPattern('foo.test.ts', '*.test.ts')).toBe(true);
	});

	it('rejects non-matching pattern', () => {
		expect(matchPattern('utils.py', 'test_*.py')).toBe(false);
	});

	it('rejects partial match', () => {
		expect(matchPattern('my_test.js', '*.test.ts')).toBe(false);
	});
});

describe('isTestFile', () => {
	it('detects Python test files', () => {
		expect(isTestFile('test_utils.py', ['test_*.py', '*_test.py'])).toBe(true);
		expect(isTestFile('utils_test.py', ['test_*.py', '*_test.py'])).toBe(true);
		expect(isTestFile('conftest.py', ['test_*.py', '*_test.py', 'conftest.py'])).toBe(true);
	});

	it('detects TypeScript test files', () => {
		expect(isTestFile('app.test.ts', ['*.test.ts', '*.spec.ts'])).toBe(true);
		expect(isTestFile('app.spec.ts', ['*.test.ts', '*.spec.ts'])).toBe(true);
	});

	it('detects Go test files', () => {
		expect(isTestFile('main_test.go', ['*_test.go'])).toBe(true);
	});

	it('rejects non-test files', () => {
		expect(isTestFile('main.go', ['*_test.go'])).toBe(false);
		expect(isTestFile('app.ts', ['*.test.ts', '*.spec.ts'])).toBe(false);
	});
});

describe('isInTestDir', () => {
	it('detects files in test directories', () => {
		expect(isInTestDir('tests/unit/foo.ts')).toBe(true);
		expect(isInTestDir('src/__tests__/foo.ts')).toBe(true);
		expect(isInTestDir('e2e/smoke.ts')).toBe(true);
	});

	it('rejects files not in test directories', () => {
		expect(isInTestDir('src/lib/foo.ts')).toBe(false);
		expect(isInTestDir('main.ts')).toBe(false);
	});

	it('uses custom dir patterns when provided', () => {
		expect(isInTestDir('spec/foo.rb', ['spec'])).toBe(true);
		expect(isInTestDir('tests/foo.rb', ['spec'])).toBe(false);
	});
});

describe('countRustInlineTestLines', () => {
	it('counts lines in a #[cfg(test)] block', () => {
		const content = [
			'fn main() {',
			'    println!("hello");',
			'}',
			'',
			'#[cfg(test)]',
			'mod tests {',
			'    #[test]',
			'    fn it_works() {',
			'        assert_eq!(2 + 2, 4);',
			'    }',
			'}'
		].join('\n');
		expect(countRustInlineTestLines(content)).toBe(7);
	});

	it('returns 0 when no test blocks exist', () => {
		const content = 'fn main() {\n    println!("hello");\n}\n';
		expect(countRustInlineTestLines(content)).toBe(0);
	});

	it('handles multiple test blocks', () => {
		const content = [
			'fn a() {}',
			'#[cfg(test)]',
			'mod tests1 {',
			'    fn t() {}',
			'}',
			'fn b() {}',
			'#[cfg(test)]',
			'mod tests2 {',
			'    fn t() {}',
			'}'
		].join('\n');
		expect(countRustInlineTestLines(content)).toBe(8);
	});
});
