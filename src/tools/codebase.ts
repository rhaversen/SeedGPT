import { readdir, readFile as fsReadFile } from 'fs/promises'
import { join, extname, dirname, posix } from 'path'
import ts from 'typescript'

const IGNORE = new Set(['node_modules', '.git', 'dist', 'logs', '.tmp-patch.diff', 'package-lock.json'])
const TS_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs'])

export async function getCodebaseContext(rootPath: string): Promise<string> {
	const tasks: [Promise<string>, Promise<string>, Promise<string>?] = [
		getFileTree(rootPath),
		getDeclarationIndex(rootPath),
	]
	const [tree, declarations] = await Promise.all(tasks)

	const sections = [`## File Tree\n\`\`\`\n${tree}\n\`\`\``]
	sections.push(`## Declarations (Omitting test files)\n${declarations}`)
	return sections.join('\n\n')
}

async function getFileTree(rootPath: string): Promise<string> {
	const lines: string[] = ['.']
	await walkTree(rootPath, '', lines)
	return lines.join('\n')
}

async function getDeclarationIndex(rootPath: string): Promise<string> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const sections: string[] = []
	for (const relPath of allFiles) {
		if (relPath.endsWith('/')) continue
		const ext = extname(relPath)

		if (isTestFile(relPath)) continue

		if (TS_EXTENSIONS.has(ext)) {
			try {
				const content = await fsReadFile(join(rootPath, relPath), 'utf-8')
				const lineCount = content.split('\n').length
				const declarations = extractDeclarations(content, relPath, { exportedOnly: true })
				const header = `### ${relPath} (${lineCount} lines)`
				sections.push(declarations.length > 0 ? `${header}\n${declarations.join('\n')}` : header)
			} catch { /* skip unreadable */ }
		} else if (ext === '.json') {
			try {
				const content = await fsReadFile(join(rootPath, relPath), 'utf-8')
				const lineCount = content.split('\n').length
				sections.push(`### ${relPath} (${lineCount} lines)`)
			} catch { /* skip */ }
		}
	}

	return sections.join('\n\n')
}

function extractDeclarations(sourceText: string, filePath: string, options?: { exportedOnly?: boolean }): string[] {
	const kind = filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
	const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind)
	const expOnly = options?.exportedOnly ?? false
	const lines: string[] = []
	for (const stmt of sf.statements) visitNode(sf, stmt, lines, '  ', expOnly)
	return lines
}

function visitNode(sf: ts.SourceFile, node: ts.Node, out: string[], indent: string, expOnly: boolean): void {
	const exported = isExported(node)
	if (expOnly && !exported) return

	const range = lineRange(sf, node)
	const exp = exported ? 'export ' : ''

	if (ts.isFunctionDeclaration(node) && node.name) {
		const a = mod(node, ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''
		out.push(`${indent}${exp}${a}function ${node.name.text}  [${range}]`)
	} else if (ts.isClassDeclaration(node) && node.name) {
		out.push(`${indent}${exp}class ${node.name.text}  [${range}]`)
		for (const m of node.members) visitClassMember(sf, m, out, indent + '  ', expOnly)
	} else if (ts.isInterfaceDeclaration(node)) {
		const members = node.members
			.map(m => m.name?.getText(sf))
			.filter(Boolean)
		out.push(`${indent}${exp}interface ${node.name.text}${members.length ? ` { ${members.join(', ')} }` : ''}  [${range}]`)
	} else if (ts.isTypeAliasDeclaration(node)) {
		const text = node.type.getText(sf)
		const short = text.length < 80 ? ` = ${text}` : ''
		out.push(`${indent}${exp}type ${node.name.text}${short}  [${range}]`)
	} else if (ts.isEnumDeclaration(node)) {
		const members = node.members.map(m => m.name.getText(sf)).join(', ')
		out.push(`${indent}${exp}enum ${node.name.text} { ${members} }  [${range}]`)
	} else if (ts.isVariableStatement(node)) {
		const keyword = node.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let'
		for (const d of node.declarationList.declarations) {
			if (!ts.isIdentifier(d.name)) continue
			out.push(`${indent}${exp}${keyword} ${d.name.text}  [${range}]`)
		}
	}
}

function visitClassMember(sf: ts.SourceFile, node: ts.Node, out: string[], indent: string, expOnly: boolean): void {
	if (expOnly && mod(node, ts.SyntaxKind.PrivateKeyword)) return

	const range = lineRange(sf, node)
	const s = mod(node, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''
	const a = mod(node, ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''

	if (ts.isConstructorDeclaration(node)) {
		out.push(`${indent}constructor  [${range}]`)
	} else if (ts.isMethodDeclaration(node) && node.name) {
		out.push(`${indent}${s}${a}${node.name.getText(sf)}  [${range}]`)
	} else if (ts.isPropertyDeclaration(node) && node.name) {
		out.push(`${indent}${s}${node.name.getText(sf)}  [${range}]`)
	}
}

function lineRange(sf: ts.SourceFile, node: ts.Node): string {
	const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
	const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1
	return start === end ? `L${start}` : `L${start}-${end}`
}

function isExported(node: ts.Node): boolean {
	return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

function isTestFile(relPath: string): boolean {
	return /\.(test|spec)\.[tj]sx?$/.test(relPath)
}

function mod(node: ts.Node, kind: ts.SyntaxKind): boolean {
	return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === kind) ?? false)
}

async function walkTree(basePath: string, prefix: string, lines: string[]): Promise<void> {
	const entries = (await readdir(basePath, { withFileTypes: true }))
		.filter(e => !IGNORE.has(e.name))
		.sort((a, b) => a.name.localeCompare(b.name))

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]
		const isLast = i === entries.length - 1
		const connector = isLast ? '└── ' : '├── '
		const childPrefix = isLast ? '    ' : '│   '

		if (entry.isDirectory()) {
			lines.push(`${prefix}${connector}${entry.name}/`)
			await walkTree(join(basePath, entry.name), `${prefix}${childPrefix}`, lines)
		} else {
			lines.push(`${prefix}${connector}${entry.name}`)
		}
	}
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

export async function findUnusedFunctions(rootPath: string): Promise<string | null> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const tsFiles = allFiles.filter(f => !f.endsWith('/') && TS_EXTENSIONS.has(extname(f)))
	const srcFiles = tsFiles.filter(f => !isTestFile(f))
	const testFiles = tsFiles.filter(f => isTestFile(f))

	const declared: Array<{ name: string; file: string; exported: boolean; line: number }> = []
	const srcContents = new Map<string, string>()

	for (const relPath of srcFiles) {
		const content = await fsReadFile(join(rootPath, relPath), 'utf-8')
		srcContents.set(relPath, content)
		const kind = relPath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
		const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, kind)
		for (const stmt of sf.statements) {
			collectFunctionNames(stmt, relPath, sf, declared)
		}
	}

	const testContents = await Promise.all(testFiles.map(f => fsReadFile(join(rootPath, f), 'utf-8')))
	const megaTest = testContents.join('\n\n')

	const deadCode: string[] = []
	const testOnly: string[] = []
	const exportedForTests: string[] = []

	for (const fn of declared) {
		const content = srcContents.get(fn.file) ?? ''
		const lines = content.split('\n')
		const precedingLine = fn.line > 1 ? lines[fn.line - 2] : ''
		if (/@keep\b/.test(precedingLine)) continue

		const re = new RegExp(`\\b${fn.name}\\b`, 'g')
		const ownContent = content
		const ownMatches = ownContent.match(re)?.length ?? 0

		let otherSrcMatches = 0
		for (const [file, content] of srcContents) {
			if (file === fn.file) continue
			otherSrcMatches += content.match(re)?.length ?? 0
		}

		const testMatches = megaTest.match(re)?.length ?? 0

		if (ownMatches <= 1 && otherSrcMatches === 0) {
			if (testMatches === 0) {
				deadCode.push(`${fn.file}: ${fn.name}`)
			} else {
				testOnly.push(`${fn.file}: ${fn.name}`)
			}
		} else if (fn.exported && otherSrcMatches === 0 && testMatches > 0) {
			exportedForTests.push(`${fn.file}: ${fn.name}`)
		}
	}

	const sections: string[] = []
	if (deadCode.length > 0) sections.push(`Remove — dead code, not used anywhere (not even in tests):\n${deadCode.join('\n')}`)
	if (testOnly.length > 0) sections.push(`Review — has test coverage but is never called in production code. If this is reusable infrastructure worth keeping, add a // @keep comment above it to suppress this warning. If it is dead code with leftover tests, remove both the function and its tests:\n${testOnly.join('\n')}`)
	if (exportedForTests.length > 0) sections.push(`Refactor — exported only because tests import it directly, but used internally (either test through the public function that calls it and remove the export, or move to a utility file where the export is justified):\n${exportedForTests.join('\n')}`)
	return sections.length > 0 ? sections.join('\n\n') : null
}

export async function findLargeFiles(rootPath: string, maxLines: number): Promise<string | null> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const large: Array<{ file: string; lines: number }> = []

	for (const relPath of allFiles) {
		if (relPath.endsWith('/')) continue
		if (!TS_EXTENSIONS.has(extname(relPath))) continue
		if (isTestFile(relPath)) continue

		try {
			const content = await fsReadFile(join(rootPath, relPath), 'utf-8')
			const lineCount = content.split('\n').length
			if (lineCount > maxLines) large.push({ file: relPath, lines: lineCount })
		} catch { /* skip unreadable */ }
	}

	if (large.length === 0) return null

	large.sort((a, b) => b.lines - a.lines)
	const entries = large.map(f => `${f.file}: ${f.lines} lines`)
	return `Consider splitting — these source files exceed ${maxLines} lines. Large files are harder to understand, edit, and test. Look for natural boundaries (e.g. groups of related functions) that could become separate modules:\n${entries.join('\n')}`
}

function collectFunctionNames(node: ts.Node, file: string, sf: ts.SourceFile, out: Array<{ name: string; file: string; exported: boolean; line: number }>): void {
	const exported = isExported(node)
	if (ts.isFunctionDeclaration(node) && node.name) {
		const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
		out.push({ name: node.name.text, file, exported, line })
	} else if (ts.isClassDeclaration(node)) {
		for (const member of node.members) {
			if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
				const line = sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1
				out.push({ name: member.name.text, file, exported, line })
			}
		}
	}
}

export async function grepSearch(rootPath: string, pattern: string, options?: { includePattern?: string }): Promise<string> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	let regex: RegExp
	try { regex = new RegExp(pattern, 'gi') } catch { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') }
	const includeGlob = options?.includePattern

	const matches: string[] = []
	const maxResults = 100

	for (const relPath of allFiles) {
		if (relPath.endsWith('/')) continue
		if (includeGlob && !minimatch(relPath, includeGlob)) continue

		try {
			const content = await fsReadFile(join(rootPath, relPath), 'utf-8')
			const lines = content.split('\n')
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				const isMatch = regex.test(line)
				regex.lastIndex = 0
				if (isMatch) {
					matches.push(`${relPath}:${i + 1}: ${line.trimStart()}`)
					if (matches.length >= maxResults) {
						matches.push(`(truncated at ${maxResults} results)`)
						return matches.join('\n')
					}
				}
			}
		} catch { /* skip binary/unreadable */ }
	}

	return matches.length > 0 ? matches.join('\n') : 'No matches found.'
}

export async function fileSearch(rootPath: string, globPattern: string): Promise<string> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const matches = allFiles.filter(f => minimatch(f, globPattern))
	if (matches.length === 0) return 'No files matched.'
	return matches.join('\n')
}

export async function listDirectory(rootPath: string, dirPath: string): Promise<string> {
	const fullPath = join(rootPath, dirPath)
	const entries = (await readdir(fullPath, { withFileTypes: true }))
		.filter(e => !IGNORE.has(e.name))
		.sort((a, b) => a.name.localeCompare(b.name))

	return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n')
}

// Simplified glob matcher to avoid pulling in a minimatch dependency.
// Handles the basic patterns the agent uses: **, *, ?, and dot escaping.
function minimatch(filePath: string, pattern: string): boolean {
	const regexStr = pattern
		.replace(/\./g, '\\.')
		.replace(/\*\*/g, '<<<GLOBSTAR>>>')
		.replace(/\*/g, '[^/]*')
		.replace(/<<<GLOBSTAR>>>/g, '.*')
		.replace(/\?/g, '.')
	return new RegExp(`^${regexStr}$`).test(filePath)
}
