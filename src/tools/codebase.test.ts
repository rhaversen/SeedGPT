import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractDeclarations, getCodebaseIndex, getFileTree } from './codebase.js'

describe('extractDeclarations', () => {
	it('extracts exported and non-exported functions with signatures', () => {
		const src = `export function greet(name: string): string {
	return 'hi ' + name
}

function helper(): void {
	console.log('help')
}
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  export function greet(name: string): string  [L1-3]',
			'  function helper(): void  [L5-7]',
		])
	})

	it('extracts async functions', () => {
		const src = `export async function fetchData(url: string): Promise<string> {
	return ''
}
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  export async function fetchData(url: string): Promise<string>  [L1-3]',
		])
	})

	it('extracts interfaces with members', () => {
		const src = `export interface User {
	name: string
	age?: number
	greet(msg: string): void
}
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  export interface User  [L1-5]',
			'    name: string',
			'    age?: number',
			'    greet(msg: string): void',
		])
	})

	it('extracts type aliases (short inline, long omitted)', () => {
		const src = `export type ID = string
type LongType = { a: string; b: number; c: boolean; d: string; e: number; f: boolean; g: string; h: number; i: boolean }
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result[0]).toContain('export type ID = string')
		expect(result[1]).toContain('type LongType')
		expect(result[1]).not.toContain('{ a:')
	})

	it('extracts enums with members', () => {
		const src = `export enum Color {
	Red,
	Green,
	Blue,
}
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  export enum Color { Red, Green, Blue }  [L1-5]',
		])
	})

	it('extracts const and let variable declarations with types', () => {
		const src = `export const API_URL: string = 'https://example.com'
let counter: number = 0
const untyped = 'hello'
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  export const API_URL: string  [L1]',
			'  let counter: number  [L2]',
			'  const untyped: string  [L3]',
		])
	})

	it('extracts classes with constructor, methods, and properties', () => {
		const src = `export class Service {
	private readonly name: string
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
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  export class Service  [L1-14]',
			'    private readonly name: string  [L2]',
			'    protected static count: number  [L3]',
			'    constructor(name: string)  [L5-7]',
			'    async fetchData(url: string): Promise<string>  [L9-11]',
			'    static reset(): void  [L13]',
		])
	})

	it('extracts union types from type aliases', () => {
		const src = `export type Result = 'ok' | 'error'
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			"  export type Result = 'ok' | 'error'  [L1]",
		])
	})

	it('extracts rest and optional parameters', () => {
		const src = `function process(required: string, optional?: number, ...rest: string[]): void {}
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  function process(required: string, optional?: number, ...rest: string[]): void  [L1]',
		])
	})

	it('returns empty array for files with no declarations', () => {
		const src = `console.log('hello')
import { foo } from 'bar'
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([])
	})

	it('handles single-line functions', () => {
		const src = `function id(x: number): number { return x }
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result[0]).toContain('[L1]')
		expect(result[0]).not.toContain('L1-')
	})

	it('infers types from initializers', () => {
		const src = `const s = 'hello'
const t = \`template\`
const n = 42
const b = true
const f = false
const a = [1, 2, 3]
const obj = { name: 'test', value: 1 }
const fn = (x: number): string => String(x)
const inst = new Map()
`
		const result = extractDeclarations(src, 'test.ts')
		expect(result).toEqual([
			'  const s: string  [L1]',
			'  const t: string  [L2]',
			'  const n: number  [L3]',
			'  const b: boolean  [L4]',
			'  const f: boolean  [L5]',
			'  const a: [...]  [L6]',
			'  const obj: { name, value }  [L7]',
			'  const fn: (x: number) => string  [L8]',
			'  const inst: Map  [L9]',
		])
	})
})

describe('getCodebaseIndex', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-index-'))
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('indexes .ts files with declarations and line counts', async () => {
		await writeFile(join(tempDir, 'app.ts'), `export function main(): void {
	console.log('hi')
}
`)
		const result = await getCodebaseIndex(tempDir)
		expect(result).toContain('## File Tree')
		expect(result).toContain('## Declarations')
		expect(result).toContain('### app.ts (4 lines)')
		expect(result).toContain('export function main(): void  [L1-3]')
	})

	it('includes file tree with tree characters', async () => {
		await mkdir(join(tempDir, 'src'))
		await writeFile(join(tempDir, 'index.ts'), 'export const x = 1\n')
		await writeFile(join(tempDir, 'src', 'util.ts'), 'export const y = 2\n')
		const result = await getCodebaseIndex(tempDir)
		expect(result).toContain('├── ')
		expect(result).toContain('└── ')
	})

	it('lists .json files with line count only', async () => {
		await writeFile(join(tempDir, 'config.json'), '{\n  "key": "value"\n}\n')
		const result = await getCodebaseIndex(tempDir)
		expect(result).toContain('### config.json (4 lines)')
		expect(result).not.toContain('export')
	})

	it('walks subdirectories', async () => {
		await mkdir(join(tempDir, 'src'))
		await writeFile(join(tempDir, 'src', 'util.ts'), 'export const VERSION = 1\n')
		const result = await getCodebaseIndex(tempDir)
		expect(result).toContain('### src/util.ts')
	})

	it('ignores node_modules and .git', async () => {
		await mkdir(join(tempDir, 'node_modules'))
		await writeFile(join(tempDir, 'node_modules', 'lib.ts'), 'export const x = 1\n')
		await mkdir(join(tempDir, '.git'))
		await writeFile(join(tempDir, '.git', 'config.ts'), 'export const y = 2\n')
		const result = await getCodebaseIndex(tempDir)
		expect(result).not.toContain('node_modules')
		expect(result).not.toContain('.git')
	})

	it('shows header only for files with no declarations', async () => {
		await writeFile(join(tempDir, 'empty.ts'), "console.log('side effect')\n")
		const result = await getCodebaseIndex(tempDir)
		expect(result).toContain('### empty.ts (2 lines)')
		const declarationsSection = result.split('## Declarations')[1]
		expect(declarationsSection.split('\n').filter(l => l.includes('empty.ts')).length).toBe(1)
	})
})

describe('getFileTree', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-tree-'))
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	it('draws a tree with connectors', async () => {
		await writeFile(join(tempDir, 'a.ts'), '')
		await writeFile(join(tempDir, 'b.ts'), '')
		const result = await getFileTree(tempDir)
		expect(result).toBe('.\n├── a.ts\n└── b.ts')
	})

	it('nests subdirectories with proper indentation', async () => {
		await mkdir(join(tempDir, 'src'))
		await writeFile(join(tempDir, 'src', 'index.ts'), '')
		await writeFile(join(tempDir, 'src', 'util.ts'), '')
		const result = await getFileTree(tempDir)
		expect(result).toBe('.\n└── src/\n    ├── index.ts\n    └── util.ts')
	})

	it('uses │ for non-last directory siblings', async () => {
		await mkdir(join(tempDir, 'a'))
		await writeFile(join(tempDir, 'a', 'x.ts'), '')
		await writeFile(join(tempDir, 'b.ts'), '')
		const result = await getFileTree(tempDir)
		expect(result).toBe('.\n├── a/\n│   └── x.ts\n└── b.ts')
	})

	it('ignores node_modules and .git', async () => {
		await mkdir(join(tempDir, 'node_modules'))
		await writeFile(join(tempDir, 'node_modules', 'lib.js'), '')
		await mkdir(join(tempDir, '.git'))
		await writeFile(join(tempDir, '.git', 'HEAD'), '')
		await writeFile(join(tempDir, 'app.ts'), '')
		const result = await getFileTree(tempDir)
		expect(result).toBe('.\n└── app.ts')
	})

	it('returns just root for empty directory', async () => {
		const result = await getFileTree(tempDir)
		expect(result).toBe('.')
	})
})
