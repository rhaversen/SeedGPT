import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCodebaseContext, grepSearch, fileSearch, listDirectory, findUnusedFunctions, readFile } from './codebase.js'

function extractDeclarations(ctx: string): string {
	return ctx.split('## Declarations')[1] ?? ''
}

describe('declaration parsing', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-decl-'))
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('extracts functions with signatures', async () => {
		const src = `export function greet(name: string): string {
	return 'hi ' + name
}

export function helper(): void {
	console.log('help')
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export function greet  [L1-3]')
		expect(decls).toContain('export function helper  [L5-7]')
	})

	it('extracts async functions', async () => {
		const src = `export async function fetchData(url: string): Promise<string> {
	return ''
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export async function fetchData  [L1-3]')
	})

	it('extracts interfaces with members', async () => {
		const src = `export interface User {
	name: string
	age?: number
	greet(msg: string): void
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export interface User { name, age, greet }  [L1-5]')
		expect(decls).not.toContain('name: string')
	})

	it('extracts type aliases (short inline, long omitted)', async () => {
		const src = `export type ID = string
export type LongType = { a: string; b: number; c: boolean; d: string; e: number; f: boolean; g: string; h: number; i: boolean }
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export type ID = string')
		expect(decls).toContain('export type LongType')
		expect(decls).not.toContain('{ a:')
	})

	it('extracts enums with members', async () => {
		const src = `export enum Color {
	Red,
	Green,
	Blue,
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export enum Color { Red, Green, Blue }  [L1-5]')
	})

	it('extracts const and let variable declarations with types', async () => {
		const src = `export const API_URL: string = 'https://example.com'
export let counter: number = 0
export const untyped = 'hello'
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export const API_URL  [L1]')
		expect(decls).toContain('export let counter  [L2]')
		expect(decls).toContain('export const untyped  [L3]')
	})

	it('extracts classes with constructor, methods, and properties', async () => {
		const src = `export class Service {
	readonly name: string
	protected static count: number

	constructor(name: string) {
		this.name = name
	}

	async fetchData(url: string): Promise<string> {
		return ''
	}

	static reset(): void {}
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export class Service  [L1-14]')
		expect(decls).toContain('name  [L2]')
		expect(decls).toContain('static count  [L3]')
		expect(decls).toContain('constructor  [L5-7]')
		expect(decls).toContain('async fetchData  [L9-11]')
		expect(decls).toContain('static reset  [L13]')
	})

	it('extracts union types from type aliases', async () => {
		const src = `export type Result = 'ok' | 'error'
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain("export type Result = 'ok' | 'error'  [L1]")
	})

	it('extracts rest and optional parameters', async () => {
		const src = `export function process(required: string, optional?: number, ...rest: string[]): void {}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export function process  [L1]')
	})

	it('returns empty declarations for files with no declarations', async () => {
		const src = `console.log('hello')
import { foo } from 'bar'
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('### test.ts')
		expect(decls.split('\n').filter(l => l.includes('test.ts')).length).toBe(1)
	})

	it('handles single-line functions', async () => {
		const src = `export function id(x: number): number { return x }
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('[L1]')
		expect(decls).not.toContain('L1-')
	})

	it('omits type annotations from variables', async () => {
		const src = `export const s = 'hello'
export const n = 42
export const b = true
export const obj = { name: 'test', value: 1 }
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export const s  [L1]')
		expect(decls).toContain('export const n  [L2]')
		expect(decls).toContain('export const b  [L3]')
		expect(decls).toContain('export const obj  [L4]')
		expect(decls).not.toContain(': string')
		expect(decls).not.toContain(': number')
		expect(decls).not.toContain(': boolean')
	})

	it('exportedOnly omits non-exported declarations', async () => {
		const src = `export function greet(name: string): string {
	return 'hi ' + name
}

function helper(): void {
	console.log('help')
}

export const API = 'url'
const SECRET = 'shh'
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export function greet  [L1-3]')
		expect(decls).toContain('export const API  [L9]')
		expect(decls).not.toContain('helper')
		expect(decls).not.toContain('SECRET')
	})

	it('exportedOnly hides private class members', async () => {
		const src = `export class Service {
	private readonly name: string
	count: number

	constructor(name: string) {
		this.name = name
	}

	private internal(): void {}
	public fetch(): string { return '' }
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export class Service  [L1-11]')
		expect(decls).toContain('count  [L3]')
		expect(decls).toContain('constructor  [L5-7]')
		expect(decls).toContain('fetch  [L10]')
		expect(decls).not.toContain('private')
	})
})

describe('getCodebaseContext', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-ctx-'))
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('combines file tree and declarations', async () => {
		await writeFile(join(tempDir, 'a.ts'), "import { b } from './b.js'\nexport function main(): void {}\n")
		await writeFile(join(tempDir, 'b.ts'), 'export const b = 1\n')
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('## File Tree')
		expect(result).toContain('├── a.ts')
		expect(result).toContain('## Declarations')
		expect(result).toContain('export function main  [L2]')
	})

	it('indexes .ts files with declarations and line counts', async () => {
		await writeFile(join(tempDir, 'app.ts'), `export function main(): void {
	console.log('hi')
}
`)
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('### app.ts (4 lines)')
		expect(result).toContain('export function main  [L1-3]')
	})

	it('lists .json files with line count only', async () => {
		await writeFile(join(tempDir, 'config.json'), '{\n  "key": "value"\n}\n')
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('### config.json (4 lines)')
	})

	it('walks subdirectories', async () => {
		await mkdir(join(tempDir, 'src'))
		await writeFile(join(tempDir, 'src', 'util.ts'), 'export const VERSION = 1\n')
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('### src/util.ts')
	})

	it('ignores node_modules and .git', async () => {
		await mkdir(join(tempDir, 'node_modules'))
		await writeFile(join(tempDir, 'node_modules', 'lib.ts'), 'export const x = 1\n')
		await mkdir(join(tempDir, '.git'))
		await writeFile(join(tempDir, '.git', 'config.ts'), 'export const y = 2\n')
		await writeFile(join(tempDir, 'app.ts'), 'export function main(): void {}\n')
		const result = await getCodebaseContext(tempDir)
		expect(result).not.toContain('node_modules')
		expect(result).not.toContain('.git')
		expect(result).toContain('app.ts')
	})

	it('shows header only for files with no declarations', async () => {
		await writeFile(join(tempDir, 'empty.ts'), "console.log('side effect')\n")
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('### empty.ts (2 lines)')
	})

	it('skips test files in declarations', async () => {
		await writeFile(join(tempDir, 'app.ts'), 'export function main(): void {}\n')
		await writeFile(join(tempDir, 'app.test.ts'), 'import { main } from "./app.js"\n')
		await writeFile(join(tempDir, 'app.spec.ts'), 'describe("app", () => {})\n')
		const result = await getCodebaseContext(tempDir)
		const declarations = result.split('## Declarations')[1]!
		expect(declarations).toContain('### app.ts')
		expect(declarations).not.toContain('app.test.ts')
		expect(declarations).not.toContain('app.spec.ts')
	})

	it('only includes exported declarations in index', async () => {
		await writeFile(join(tempDir, 'mod.ts'), `export function pub(): void {}
function priv(): void {}
const SECRET = 'x'
`)
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('export function pub')
		expect(result).not.toContain('priv')
		expect(result).not.toContain('SECRET')
	})

	it('draws a tree with connectors', async () => {
		await writeFile(join(tempDir, 'a.ts'), '')
		await writeFile(join(tempDir, 'b.ts'), '')
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('├── a.ts')
		expect(result).toContain('└── b.ts')
	})

	it('nests subdirectories with proper indentation', async () => {
		await mkdir(join(tempDir, 'src'))
		await writeFile(join(tempDir, 'src', 'index.ts'), '')
		await writeFile(join(tempDir, 'src', 'util.ts'), '')
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('└── src/')
		expect(result).toContain('    ├── index.ts')
		expect(result).toContain('    └── util.ts')
	})

	it('uses │ for non-last directory siblings', async () => {
		await mkdir(join(tempDir, 'a'))
		await writeFile(join(tempDir, 'a', 'x.ts'), '')
		await writeFile(join(tempDir, 'b.ts'), '')
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('├── a/')
		expect(result).toContain('│   └── x.ts')
		expect(result).toContain('└── b.ts')
	})
})

describe('grepSearch', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-grep-'))
		await writeFile(join(tempDir, 'example.ts'), [
			'import { config } from "./config.js"',
			'',
			'export function run(): void {',
			'  const max = config.coverage.maxLowCoverageFiles',
			'  console.log(max)',
			'}',
		].join('\n'))
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('finds plain text matches (case-insensitive)', async () => {
		const result = await grepSearch(tempDir, 'config')
		expect(result).toContain('example.ts:1:')
		expect(result).toContain('example.ts:4:')
	})

	it('treats regex pattern correctly', async () => {
		const result = await grepSearch(tempDir, 'config\\.')
		expect(result).toContain('example.ts:4:')
		expect(result).not.toContain('example.ts:5:')
	})

	it('plain dot is treated as regex wildcard', async () => {
		const result = await grepSearch(tempDir, 'config.')
		expect(result).toContain('example.ts:1:')
		expect(result).toContain('example.ts:4:')
	})

	it('escapes and retries on invalid regex', async () => {
		await writeFile(join(tempDir, 'brackets.ts'), 'const arr = [config]')
		const result = await grepSearch(tempDir, '[config')
		expect(result).toContain('brackets.ts:1:')
	})

	it('filters by includePattern', async () => {
		await writeFile(join(tempDir, 'other.js'), 'config.something')
		const result = await grepSearch(tempDir, 'config', { includePattern: '*.ts' })
		expect(result).toContain('example.ts')
		expect(result).not.toContain('other.js')
	})

	it('returns no-match message when nothing matches', async () => {
		const result = await grepSearch(tempDir, 'nonexistent_string_xyz')
		expect(result).toBe('No matches found.')
	})
})

describe('fileSearch', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-fsearch-'))
		await writeFile(join(tempDir, 'app.ts'), 'export const x = 1')
		await writeFile(join(tempDir, 'readme.md'), '# Readme')
		await mkdir(join(tempDir, 'src'))
		await writeFile(join(tempDir, 'src', 'utils.ts'), 'export function f() {}')
		await writeFile(join(tempDir, 'src', 'index.js'), 'console.log("hi")')
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('matches files by glob pattern', async () => {
		const result = await fileSearch(tempDir, '**/*.ts')
		expect(result).toContain('src/utils.ts')
		expect(result).not.toContain('readme.md')
		expect(result).not.toContain('index.js')
	})

	it('returns no-match message for unmatched glob', async () => {
		const result = await fileSearch(tempDir, '**/*.xyz')
		expect(result).toBe('No files matched.')
	})

	it('matches specific file names', async () => {
		const result = await fileSearch(tempDir, '**/index.*')
		expect(result).toContain('src/index.js')
		expect(result).not.toContain('app.ts')
	})
})

describe('listDirectory', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-listdir-'))
		await writeFile(join(tempDir, 'file1.ts'), '')
		await writeFile(join(tempDir, 'file2.ts'), '')
		await mkdir(join(tempDir, 'subdir'))
		await writeFile(join(tempDir, 'subdir', 'nested.ts'), '')
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('lists files and directories', async () => {
		const result = await listDirectory(tempDir, '.')
		expect(result).toContain('file1.ts')
		expect(result).toContain('file2.ts')
		expect(result).toContain('subdir/')
	})

	it('lists contents of a subdirectory', async () => {
		const result = await listDirectory(tempDir, 'subdir')
		expect(result).toContain('nested.ts')
		expect(result).not.toContain('file1.ts')
	})

	it('ignores node_modules', async () => {
		await mkdir(join(tempDir, 'node_modules'))
		await writeFile(join(tempDir, 'node_modules', 'lib.js'), '')
		const result = await listDirectory(tempDir, '.')
		expect(result).not.toContain('node_modules')
	})

	it('throws for non-existent directory', async () => {
		await expect(listDirectory(tempDir, 'nonexistent')).rejects.toThrow()
	})
})

describe('findUnusedFunctions', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-unused-'))
		await mkdir(join(tempDir, 'src'), { recursive: true })
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('returns null when all functions are used', async () => {
		await writeFile(join(tempDir, 'src', 'utils.ts'), `export function add(a: number, b: number) { return a + b }`)
		await writeFile(join(tempDir, 'src', 'main.ts'), `import { add } from './utils'\nconst x = add(1, 2)`)

		const result = await findUnusedFunctions(tempDir)
		expect(result).toBeNull()
	})

	it('detects dead code (not used anywhere)', async () => {
		await writeFile(join(tempDir, 'src', 'utils.ts'), `export function dead() { return 42 }\nexport function alive() { return 1 }`)
		await writeFile(join(tempDir, 'src', 'main.ts'), `import { alive } from './utils'\nconsole.log(alive())`)

		const result = await findUnusedFunctions(tempDir)
		expect(result).toContain('dead')
		expect(result).toContain('Remove — dead code')
	})

	it('detects functions only used in tests', async () => {
		await writeFile(join(tempDir, 'src', 'utils.ts'), `export function helper() { return 1 }`)
		await writeFile(join(tempDir, 'src', 'utils.test.ts'), `import { helper } from './utils'\nexpect(helper()).toBe(1)`)

		const result = await findUnusedFunctions(tempDir)
		expect(result).toContain('helper')
		expect(result).toContain('Review — has test coverage but is never called in production code')
	})

	it('detects exported-for-tests pattern', async () => {
		await writeFile(join(tempDir, 'src', 'service.ts'), [
			`export function internal() { return compute() }`,
			`export function compute() { return 42 }`,
		].join('\n'))
		await writeFile(join(tempDir, 'src', 'service.test.ts'), `import { compute } from './service'\nexpect(compute()).toBe(42)`)

		const result = await findUnusedFunctions(tempDir)
		expect(result).toContain('compute')
		expect(result).toContain('Refactor — exported only because tests import it directly')
	})

	it('detects class method declarations as unused', async () => {
		await writeFile(join(tempDir, 'src', 'service.ts'), [
			`export class Service {`,
			`  unusedMethod() { return 1 }`,
			`}`,
		].join('\n'))

		const result = await findUnusedFunctions(tempDir)
		expect(result).toContain('unusedMethod')
	})

	it('skips functions with a @keep comment', async () => {
		await writeFile(join(tempDir, 'src', 'utils.ts'), [
			`// @keep`,
			`export function kept() { return 1 }`,
			`export function notKept() { return 2 }`,
		].join('\n'))
		await writeFile(join(tempDir, 'src', 'utils.test.ts'), `import { kept, notKept } from './utils'\nkept()\nnotKept()`)

		const result = await findUnusedFunctions(tempDir)
		expect(result).not.toContain('kept')
		expect(result).toContain('notKept')
	})
})

describe('readFile', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-readfile-'))
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('reads file content relative to root path', async () => {
		await writeFile(join(tempDir, 'hello.txt'), 'hello world')
		const content = await readFile(tempDir, 'hello.txt')
		expect(content).toBe('hello world')
	})
})
