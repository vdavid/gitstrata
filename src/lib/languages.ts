import type { LanguageDefinition } from './types';

/** Directory names that indicate test code (global defaults) */
export const defaultTestDirPatterns = ['test', 'tests', '__tests__', 'e2e', 'testutil', 'testdata'];

/**
 * Count lines inside Rust #[cfg(test)] blocks using brace-depth tracking.
 * Ported from the Go reference implementation.
 */
export const countRustInlineTestLines = (content: string): number => {
	let testLines = 0;
	let depth = 0;
	let inTestBlock = false;

	for (const line of content.split('\n')) {
		const trimmed = line.trim();

		if (!inTestBlock && trimmed.includes('#[cfg(test)]')) {
			inTestBlock = true;
			testLines++;
			depth += countChar(line, '{') - countChar(line, '}');
			continue;
		}

		if (inTestBlock) {
			testLines++;
			depth += countChar(line, '{') - countChar(line, '}');
			if (depth <= 0) {
				inTestBlock = false;
				depth = 0;
			}
		}
	}

	return testLines;
};

const countChar = (str: string, char: string): number => {
	let count = 0;
	for (let i = 0; i < str.length; i++) {
		if (str[i] === char) count++;
	}
	return count;
};

/** All recognized languages, ordered by priority for extension conflicts */
const languages: readonly LanguageDefinition[] = [
	{
		id: 'python',
		name: 'Python',
		extensions: ['.py', '.pyw'],
		testFilePatterns: ['test_*.py', '*_test.py', 'conftest.py']
	},
	{
		id: 'javascript',
		name: 'JavaScript',
		extensions: ['.js', '.jsx', '.mjs', '.cjs'],
		testFilePatterns: ['*.test.js', '*.spec.js', '*.test.jsx', '*.spec.jsx']
	},
	{
		id: 'typescript',
		name: 'TypeScript',
		extensions: ['.ts', '.tsx', '.mts', '.cts'],
		testFilePatterns: ['*.test.ts', '*.spec.ts', '*.test.tsx', '*.spec.tsx']
	},
	{
		id: 'rust',
		name: 'Rust',
		extensions: ['.rs'],
		countInlineTestLines: countRustInlineTestLines
	},
	{
		id: 'go',
		name: 'Go',
		extensions: ['.go'],
		testFilePatterns: ['*_test.go']
	},
	{
		id: 'c',
		name: 'C',
		extensions: ['.c']
	},
	{
		id: 'cpp',
		name: 'C++',
		extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx']
	},
	{
		id: 'csharp',
		name: 'C#',
		extensions: ['.cs'],
		testFilePatterns: ['*Tests.cs', '*Test.cs']
	},
	{
		id: 'java',
		name: 'Java',
		extensions: ['.java'],
		testFilePatterns: ['*Test.java'],
		testDirPatterns: ['test', 'tests', '__tests__', 'e2e', 'testutil', 'testdata', 'src/test']
	},
	{
		id: 'kotlin',
		name: 'Kotlin',
		extensions: ['.kt', '.kts'],
		testFilePatterns: ['*Test.kt']
	},
	{
		id: 'swift',
		name: 'Swift',
		extensions: ['.swift'],
		testFilePatterns: ['*Tests.swift']
	},
	{
		id: 'objc',
		name: 'Objective-C',
		extensions: ['.m', '.mm']
	},
	{
		id: 'zig',
		name: 'Zig',
		extensions: ['.zig']
	},
	{
		id: 'ruby',
		name: 'Ruby',
		extensions: ['.rb'],
		testFilePatterns: ['*_test.rb', '*_spec.rb']
	},
	{
		id: 'php',
		name: 'PHP',
		extensions: ['.php'],
		testFilePatterns: ['*Test.php']
	},
	{
		id: 'scala',
		name: 'Scala',
		extensions: ['.scala'],
		testFilePatterns: ['*Test.scala', '*Spec.scala']
	},
	{
		id: 'dart',
		name: 'Dart',
		extensions: ['.dart'],
		testFilePatterns: ['*_test.dart']
	},
	{
		id: 'elixir',
		name: 'Elixir',
		extensions: ['.ex', '.exs'],
		testFilePatterns: ['*_test.exs']
	},
	{
		id: 'haskell',
		name: 'Haskell',
		extensions: ['.hs'],
		testFilePatterns: ['*Spec.hs']
	},
	{
		id: 'lua',
		name: 'Lua',
		extensions: ['.lua'],
		testFilePatterns: ['*_test.lua', '*_spec.lua']
	},
	{
		id: 'perl',
		name: 'Perl',
		extensions: ['.pl', '.pm'],
		testFilePatterns: ['*.t']
	},
	{
		id: 'r',
		name: 'R',
		extensions: ['.r', '.R'],
		testFilePatterns: ['test-*.R', 'test_*.R']
	},
	{
		id: 'julia',
		name: 'Julia',
		extensions: ['.jl']
	},
	{
		id: 'clojure',
		name: 'Clojure',
		extensions: ['.clj', '.cljs', '.cljc'],
		testFilePatterns: ['*_test.clj']
	},
	{
		id: 'erlang',
		name: 'Erlang',
		extensions: ['.erl'],
		testFilePatterns: ['*_SUITE.erl']
	},
	{
		id: 'ocaml',
		name: 'OCaml',
		extensions: ['.ml', '.mli']
	},
	{
		id: 'fsharp',
		name: 'F#',
		extensions: ['.fs', '.fsx']
	},
	{
		id: 'shell',
		name: 'Shell',
		extensions: ['.sh', '.bash', '.zsh']
	},
	{
		id: 'powershell',
		name: 'PowerShell',
		extensions: ['.ps1', '.psm1'],
		testFilePatterns: ['*.Tests.ps1']
	},
	{
		id: 'html',
		name: 'HTML',
		extensions: ['.html', '.htm']
	},
	{
		id: 'css',
		name: 'CSS',
		extensions: ['.css', '.scss', '.sass', '.less']
	},
	{
		id: 'sql',
		name: 'SQL',
		extensions: ['.sql']
	},
	{
		id: 'svelte',
		name: 'Svelte',
		extensions: ['.svelte']
	},
	{
		id: 'vue',
		name: 'Vue',
		extensions: ['.vue']
	},
	{
		id: 'astro',
		name: 'Astro',
		extensions: ['.astro']
	},
	{
		id: 'docs',
		name: 'Docs',
		extensions: ['.md', '.mdx', '.rst', '.txt', '.adoc'],
		isMeta: true
	},
	{
		id: 'config',
		name: 'Config/Data',
		extensions: ['.json', '.yaml', '.yml', '.toml', '.xml', '.ini'],
		isMeta: true
	}
];

/** Build extension-to-language lookup. `.h` is assigned to C by default. */
const buildExtensionToLanguageMap = (): Map<string, LanguageDefinition> => {
	const map = new Map<string, LanguageDefinition>();
	for (const lang of languages) {
		for (const ext of lang.extensions) {
			if (!map.has(ext)) {
				map.set(ext, lang);
			}
		}
	}
	// .h defaults to C
	const cLang = languages.find((l) => l.id === 'c');
	if (cLang) {
		map.set('.h', cLang);
	}
	return map;
};

const extensionToLanguageMap = buildExtensionToLanguageMap();

/** Get the language definition for a file extension, or undefined if unknown */
export const getLanguageByExtension = (ext: string): LanguageDefinition | undefined => {
	return extensionToLanguageMap.get(ext.toLowerCase());
};

/** Get all registered language definitions */
export const getLanguages = (): readonly LanguageDefinition[] => languages;

/**
 * Check if the repo has C++ files, and if so, reassign .h to C++.
 * Call this once per commit tree before processing files.
 */
export const resolveHeaderLanguage = (extensions: Set<string>): Map<string, LanguageDefinition> => {
	const map = new Map(extensionToLanguageMap);
	const hasCpp = extensions.has('.cpp') || extensions.has('.cc') || extensions.has('.cxx');
	if (hasCpp) {
		const cppLang = languages.find((l) => l.id === 'cpp');
		if (cppLang) {
			map.set('.h', cppLang);
		}
	}
	return map;
};

/**
 * Match a filename against a glob-style pattern.
 * Supports only simple patterns: `*` matches anything, rest is literal.
 */
export const matchPattern = (filename: string, pattern: string): boolean => {
	// Split pattern by '*' and match segments in order
	const parts = pattern.split('*');
	let pos = 0;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i === 0) {
			// First segment must match from start
			if (!filename.startsWith(part)) return false;
			pos = part.length;
		} else if (i === parts.length - 1) {
			// Last segment must match at end
			if (!filename.endsWith(part)) return false;
			// Ensure no overlap with already-consumed prefix
			if (filename.length - part.length < pos) return false;
		} else {
			const idx = filename.indexOf(part, pos);
			if (idx === -1) return false;
			pos = idx + part.length;
		}
	}
	return true;
};

/** Check if a filename matches any of the given test file patterns */
export const isTestFile = (filename: string, patterns: string[]): boolean => {
	return patterns.some((p) => matchPattern(filename, p));
};

/** Check if a file path passes through any test directory */
export const isInTestDir = (filePath: string, dirPatterns?: string[]): boolean => {
	const patterns = dirPatterns ?? defaultTestDirPatterns;
	const parts = filePath.split('/');
	return parts.some((part) => patterns.includes(part));
};
