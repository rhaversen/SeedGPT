import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCodebaseContext } from './codebase.js'

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
		expect(decls).toContain('export function greet(name: string): string  [L1-3]')
		expect(decls).toContain('export function helper(): void  [L5-7]')
	})

	it('extracts async functions', async () => {
		const src = `export async function fetchData(url: string): Promise<string> {
	return ''
}
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export async function fetchData(url: string): Promise<string>  [L1-3]')
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
		expect(decls).toContain('export interface User  [L1-5]')
		expect(decls).toContain('name: string')
		expect(decls).toContain('age?: number')
		expect(decls).toContain('greet(msg: string): void')
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
		expect(decls).toContain('export const API_URL: string  [L1]')
		expect(decls).toContain('export let counter: number  [L2]')
		expect(decls).toContain('export const untyped: string  [L3]')
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
		expect(decls).toContain('readonly name: string  [L2]')
		expect(decls).toContain('protected static count: number  [L3]')
		expect(decls).toContain('constructor(name: string)  [L5-7]')
		expect(decls).toContain('async fetchData(url: string): Promise<string>  [L9-11]')
		expect(decls).toContain('static reset(): void  [L13]')
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
		expect(decls).toContain('export function process(required: string, optional?: number, ...rest: string[]): void  [L1]')
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

	it('infers types from initializers', async () => {
		const src = `export const s = 'hello'
export const t = \`template\`
export const n = 42
export const b = true
export const f = false
export const a = [1, 2, 3]
export const obj = { name: 'test', value: 1 }
export const fn = (x: number): string => String(x)
export const inst = new Map()
`
		await writeFile(join(tempDir, 'test.ts'), src)
		const result = await getCodebaseContext(tempDir)
		const decls = extractDeclarations(result)
		expect(decls).toContain('export const s: string  [L1]')
		expect(decls).toContain('export const t: string  [L2]')
		expect(decls).toContain('export const n: number  [L3]')
		expect(decls).toContain('export const b: boolean  [L4]')
		expect(decls).toContain('export const f: boolean  [L5]')
		expect(decls).toContain('export const a: [...]  [L6]')
		expect(decls).toContain('export const obj: { name, value }  [L7]')
		expect(decls).toContain('export const fn: (x: number) => string  [L8]')
		expect(decls).toContain('export const inst: Map  [L9]')
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
		expect(decls).toContain('export function greet(name: string): string  [L1-3]')
		expect(decls).toContain('export const API: string  [L9]')
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
		expect(decls).toContain('count: number  [L3]')
		expect(decls).toContain('constructor(name: string)  [L5-7]')
		expect(decls).toContain('fetch(): string  [L10]')
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
		expect(result).toContain('export function main(): void  [L2]')
	})

	it('indexes .ts files with declarations and line counts', async () => {
		await writeFile(join(tempDir, 'app.ts'), `export function main(): void {
	console.log('hi')
}
`)
		const result = await getCodebaseContext(tempDir)
		expect(result).toContain('### app.ts (4 lines)')
		expect(result).toContain('export function main(): void  [L1-3]')
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
		expect(result).toContain('export function pub(): void')
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
