import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'

jest.unstable_mockModule('../config.js', () => ({
	config: {},
}))

jest.unstable_mockModule('../env.js', () => ({
	env: {
		workspacePath: '',
	},
}))

const { env } = await import('../env.js')
const { applyEdits } = await import('./git.js')

let tempDir: string

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), 'seedgpt-test-'));
	(env as { workspacePath: string }).workspacePath = tempDir
})

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true })
})

describe('applyEdits', () => {
	describe('replace', () => {
		it('replaces exact match in a file', async () => {
			await writeFile(join(tempDir, 'test.ts'), 'const x = 1\nconst y = 2\n')

			await applyEdits([{
				type: 'replace',
				filePath: 'test.ts',
				oldString: 'const x = 1',
				newString: 'const x = 42',
			}])

			const result = await readFile(join(tempDir, 'test.ts'), 'utf-8')
			expect(result).toBe('const x = 42\nconst y = 2\n')
		})

		it('fails when oldString is not found', async () => {
			await writeFile(join(tempDir, 'test.ts'), 'const x = 1\n')

			await expect(applyEdits([{
				type: 'replace',
				filePath: 'test.ts',
				oldString: 'const z = 99',
				newString: 'const z = 100',
			}])).rejects.toThrow('oldString not found in file')
		})

		it('fails when oldString matches multiple locations', async () => {
			await writeFile(join(tempDir, 'test.ts'), 'foo\nbar\nfoo\n')

			await expect(applyEdits([{
				type: 'replace',
				filePath: 'test.ts',
				oldString: 'foo',
				newString: 'baz',
			}])).rejects.toThrow('matches multiple locations')
		})

		it('preserves whitespace and indentation exactly', async () => {
			const content = '\tif (true) {\n\t\treturn 1\n\t}\n'
			await writeFile(join(tempDir, 'test.ts'), content)

			await applyEdits([{
				type: 'replace',
				filePath: 'test.ts',
				oldString: '\t\treturn 1',
				newString: '\t\treturn 2',
			}])

			const result = await readFile(join(tempDir, 'test.ts'), 'utf-8')
			expect(result).toBe('\tif (true) {\n\t\treturn 2\n\t}\n')
		})

		it('handles multi-line replacements', async () => {
			await writeFile(join(tempDir, 'test.ts'), 'line1\nline2\nline3\nline4\n')

			await applyEdits([{
				type: 'replace',
				filePath: 'test.ts',
				oldString: 'line2\nline3',
				newString: 'replaced2\nreplaced3\nextraLine',
			}])

			const result = await readFile(join(tempDir, 'test.ts'), 'utf-8')
			expect(result).toBe('line1\nreplaced2\nreplaced3\nextraLine\nline4\n')
		})
	})

	describe('create', () => {
		it('creates a new file', async () => {
			await applyEdits([{
				type: 'create',
				filePath: 'newfile.ts',
				content: 'export const x = 1\n',
			}])

			const result = await readFile(join(tempDir, 'newfile.ts'), 'utf-8')
			expect(result).toBe('export const x = 1\n')
		})

		it('creates nested directories', async () => {
			await applyEdits([{
				type: 'create',
				filePath: 'src/deep/nested/file.ts',
				content: 'hello',
			}])

			const result = await readFile(join(tempDir, 'src/deep/nested/file.ts'), 'utf-8')
			expect(result).toBe('hello')
		})
	})

	describe('delete', () => {
		it('deletes an existing file', async () => {
			await writeFile(join(tempDir, 'deleteme.ts'), 'bye')

			await applyEdits([{
				type: 'delete',
				filePath: 'deleteme.ts',
			}])

			expect(existsSync(join(tempDir, 'deleteme.ts'))).toBe(false)
		})

		it('fails when deleting a non-existent file', async () => {
			await expect(applyEdits([{
				type: 'delete',
				filePath: 'nope.ts',
			}])).rejects.toThrow()
		})
	})

	describe('mixed operations', () => {
		it('applies multiple operations in sequence', async () => {
			await writeFile(join(tempDir, 'a.ts'), 'const a = 1\n')

			await applyEdits([
				{ type: 'replace', filePath: 'a.ts', oldString: 'const a = 1', newString: 'const a = 2' },
				{ type: 'create', filePath: 'b.ts', content: 'const b = 3\n' },
			])

			expect(await readFile(join(tempDir, 'a.ts'), 'utf-8')).toBe('const a = 2\n')
			expect(await readFile(join(tempDir, 'b.ts'), 'utf-8')).toBe('const b = 3\n')
		})

		it('collects all errors from a batch', async () => {
			await writeFile(join(tempDir, 'a.ts'), 'hello')

			try {
				await applyEdits([
					{ type: 'replace', filePath: 'a.ts', oldString: 'missing', newString: 'x' },
					{ type: 'delete', filePath: 'nonexistent.ts' },
				])
				expect(true).toBe(false)
			} catch (err) {
				const msg = (err as Error).message
				expect(msg).toContain('oldString not found')
				expect(msg).toContain('nonexistent.ts')
			}
		})
	})
})
