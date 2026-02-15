import { describe, it, expect } from 'vitest';
import {
	getLanguageByExtension,
	getLanguages,
	resolveHeaderLanguage,
	matchPattern,
	isTestFile,
	isInTestDir,
	countRustInlineTestLines,
	countZigInlineTestLines
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

	it('maps .hh to C++', () => {
		expect(getLanguageByExtension('.hh')?.id).toBe('cpp');
	});

	it('maps .hrl to Erlang', () => {
		expect(getLanguageByExtension('.hrl')?.id).toBe('erlang');
	});

	it('maps .t to Perl', () => {
		expect(getLanguageByExtension('.t')?.id).toBe('perl');
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

	it('detects Clojure test files across dialects', () => {
		expect(isTestFile('core_test.clj', ['*_test.clj', '*_test.cljs', '*_test.cljc'])).toBe(true);
		expect(isTestFile('core_test.cljs', ['*_test.clj', '*_test.cljs', '*_test.cljc'])).toBe(true);
		expect(isTestFile('core_test.cljc', ['*_test.clj', '*_test.cljs', '*_test.cljc'])).toBe(true);
	});

	it('detects Erlang EUnit test files', () => {
		expect(isTestFile('my_test.erl', ['*_SUITE.erl', '*_test.erl', '*_tests.erl'])).toBe(true);
		expect(isTestFile('my_tests.erl', ['*_SUITE.erl', '*_test.erl', '*_tests.erl'])).toBe(true);
		expect(isTestFile('my_SUITE.erl', ['*_SUITE.erl', '*_test.erl', '*_tests.erl'])).toBe(true);
	});

	it('detects Java test patterns including integration tests', () => {
		expect(isTestFile('FooTest.java', ['*Test.java', '*Tests.java', '*IT.java'])).toBe(true);
		expect(isTestFile('FooTests.java', ['*Test.java', '*Tests.java', '*IT.java'])).toBe(true);
		expect(isTestFile('FooIT.java', ['*Test.java', '*Tests.java', '*IT.java'])).toBe(true);
	});

	it('detects Kotlin test patterns', () => {
		expect(isTestFile('FooTest.kt', ['*Test.kt', '*Tests.kt'])).toBe(true);
		expect(isTestFile('FooTests.kt', ['*Test.kt', '*Tests.kt'])).toBe(true);
	});

	it('detects Swift singular and plural test patterns', () => {
		expect(isTestFile('FooTests.swift', ['*Tests.swift', '*Test.swift'])).toBe(true);
		expect(isTestFile('FooTest.swift', ['*Tests.swift', '*Test.swift'])).toBe(true);
	});

	it('detects F# test patterns', () => {
		expect(isTestFile('FooTests.fs', ['*Tests.fs', '*Test.fs'])).toBe(true);
		expect(isTestFile('FooTest.fs', ['*Tests.fs', '*Test.fs'])).toBe(true);
	});

	it('detects Objective-C test patterns (plural and singular)', () => {
		expect(isTestFile('FooTests.m', ['*Tests.m', '*Test.m'])).toBe(true);
		expect(isTestFile('FooTest.m', ['*Tests.m', '*Test.m'])).toBe(true);
	});

	it('detects C test file patterns', () => {
		expect(isTestFile('test_math.c', ['test_*.c', '*_test.c'])).toBe(true);
		expect(isTestFile('math_test.c', ['test_*.c', '*_test.c'])).toBe(true);
	});

	it('detects C++ test file patterns', () => {
		expect(
			isTestFile('test_math.cpp', ['test_*.cpp', '*_test.cpp', '*_test.cc', '*_test.cxx'])
		).toBe(true);
		expect(
			isTestFile('math_test.cc', ['test_*.cpp', '*_test.cpp', '*_test.cc', '*_test.cxx'])
		).toBe(true);
	});

	it('detects OCaml test file patterns', () => {
		expect(isTestFile('parser_test.ml', ['*_test.ml'])).toBe(true);
	});

	it('detects JS ESM test files', () => {
		const patterns = ['*.test.mjs', '*.spec.mjs', '*.test.cjs', '*.spec.cjs'];
		expect(isTestFile('app.test.mjs', patterns)).toBe(true);
		expect(isTestFile('app.spec.cjs', patterns)).toBe(true);
	});

	it('detects TS ESM test files', () => {
		const patterns = ['*.test.mts', '*.spec.mts', '*.test.cts', '*.spec.cts'];
		expect(isTestFile('app.test.mts', patterns)).toBe(true);
		expect(isTestFile('app.spec.cts', patterns)).toBe(true);
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

	it('detects files in spec directory (default pattern)', () => {
		expect(isInTestDir('spec/models/user_spec.rb')).toBe(true);
	});

	it('detects files in __mocks__ and __fixtures__ directories', () => {
		expect(isInTestDir('src/__mocks__/api.ts')).toBe(true);
		expect(isInTestDir('src/__fixtures__/data.json')).toBe(true);
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

describe('countZigInlineTestLines', () => {
	it('counts lines in a test block', () => {
		const content = [
			'const std = @import("std");',
			'',
			'pub fn add(a: i32, b: i32) i32 {',
			'    return a + b;',
			'}',
			'',
			'test "basic add" {',
			'    try std.testing.expect(add(3, 2) == 5);',
			'}'
		].join('\n');
		expect(countZigInlineTestLines(content)).toBe(3);
	});

	it('returns 0 when no test blocks exist', () => {
		const content = [
			'const std = @import("std");',
			'pub fn add(a: i32, b: i32) i32 {',
			'    return a + b;',
			'}'
		].join('\n');
		expect(countZigInlineTestLines(content)).toBe(0);
	});

	it('handles multiple test blocks', () => {
		const content = [
			'pub fn add(a: i32, b: i32) i32 {',
			'    return a + b;',
			'}',
			'',
			'test "add positive" {',
			'    try std.testing.expect(add(3, 2) == 5);',
			'}',
			'',
			'test "add negative" {',
			'    try std.testing.expect(add(-1, -2) == -3);',
			'}'
		].join('\n');
		expect(countZigInlineTestLines(content)).toBe(6);
	});

	it('handles test block with no description', () => {
		const content = [
			'pub fn foo() void {}',
			'',
			'test {',
			'    try std.testing.expect(true);',
			'}'
		].join('\n');
		expect(countZigInlineTestLines(content)).toBe(3);
	});
});

describe('noTestSplit languages', () => {
	const noTestSplitIds = [
		'html',
		'css',
		'sql',
		'shell',
		'svelte',
		'vue',
		'astro',
		'docs',
		'config'
	];

	it('marks expected languages as noTestSplit', () => {
		const languages = getLanguages();
		for (const id of noTestSplitIds) {
			const lang = languages.find((l) => l.id === id);
			expect(lang?.noTestSplit, `${id} should have noTestSplit`).toBe(true);
		}
	});

	it('does not mark programming languages as noTestSplit', () => {
		const languages = getLanguages();
		const programmingIds = ['python', 'javascript', 'typescript', 'rust', 'go', 'java', 'c', 'cpp'];
		for (const id of programmingIds) {
			const lang = languages.find((l) => l.id === id);
			expect(lang?.noTestSplit, `${id} should not have noTestSplit`).toBeFalsy();
		}
	});
});

describe('language definition fixes', () => {
	it('Perl recognizes .t extension', () => {
		expect(getLanguageByExtension('.t')?.id).toBe('perl');
	});

	it('Perl has t in testDirPatterns', () => {
		const perl = getLanguages().find((l) => l.id === 'perl');
		expect(perl?.testDirPatterns).toContain('t');
	});

	it('Java does not have custom testDirPatterns', () => {
		const java = getLanguages().find((l) => l.id === 'java');
		expect(java?.testDirPatterns).toBeUndefined();
	});
});
