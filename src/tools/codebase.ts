import { readdir, readFile as fsReadFile } from 'fs/promises'
import { join } from 'path'

const IGNORE = new Set(['node_modules', '.git', 'dist', 'logs', '.tmp-patch.diff'])

export async function getFileTree(rootPath: string): Promise<string> {
	const files: string[] = []
	await walk(rootPath, '', files)
	return files.join('\n')
}

async function walk(basePath: string, prefix: string, files: string[]): Promise<void> {
	const entries = await readdir(basePath, { withFileTypes: true })

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (IGNORE.has(entry.name)) continue
		const relPath = prefix ? `${prefix}/${entry.name}` : entry.name

		if (entry.isDirectory()) {
			files.push(`${relPath}/`)
			await walk(join(basePath, entry.name), relPath, files)
		} else {
			files.push(relPath)
		}
	}
}

export async function readFile(rootPath: string, filePath: string): Promise<string> {
	return fsReadFile(join(rootPath, filePath), 'utf-8')
}

export async function readFiles(rootPath: string, filePaths: string[]): Promise<Record<string, string>> {
	const result: Record<string, string> = {}
	for (const filePath of filePaths) {
		try {
			result[filePath] = await readFile(rootPath, filePath)
		} catch {
			result[filePath] = `[File not found: ${filePath}]`
		}
	}
	return result
}
