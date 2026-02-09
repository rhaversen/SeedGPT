import { readdir, readFile as fsReadFile } from 'fs/promises'
import { join, extname, dirname, posix } from 'path'
import ts from 'typescript'

const IGNORE = new Set(['node_modules', '.git', 'dist', 'logs', '.tmp-patch.diff'])
const TS_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs'])

export async function getFileTree(rootPath: string): Promise<string> {
	const lines: string[] = ['.']
	await walkTree(rootPath, '', lines)
	return lines.join('\n')
}

export async function getDeclarationIndex(rootPath: string): Promise<string> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const sections: string[] = []
	for (const relPath of allFiles) {
		if (relPath.endsWith('/')) continue
		const ext = extname(relPath)

		if (TS_EXTENSIONS.has(ext)) {
			try {
				const content = await fsReadFile(join(rootPath, relPath), 'utf-8')
				const lineCount = content.split('\n').length
				const declarations = extractDeclarations(content, relPath)
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

export async function getDependencyGraph(rootPath: string): Promise<string> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const sourceContents = new Map<string, string>()
	for (const relPath of allFiles) {
		if (relPath.endsWith('/') || !TS_EXTENSIONS.has(extname(relPath))) continue
		try {
			sourceContents.set(relPath, await fsReadFile(join(rootPath, relPath), 'utf-8'))
		} catch { /* skip */ }
	}

	return buildDependencyGraph(sourceContents)
}

export async function getCodebaseContext(rootPath: string): Promise<string> {
	const [tree, declarations, depGraph] = await Promise.all([
		getFileTree(rootPath),
		getDeclarationIndex(rootPath),
		getDependencyGraph(rootPath),
	])

	return `## File Tree\n\`\`\`\n${tree}\n\`\`\`\n\n## Dependency Graph\n${depGraph}\n\n## Declarations\n${declarations}`
}

function buildDependencyGraph(sourceContents: Map<string, string>): string {
	const allFiles = new Set(sourceContents.keys())
	const graph = new Map<string, { local: string[]; external: string[] }>()

	for (const [filePath, content] of sourceContents) {
		const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
		const local: string[] = []
		const external: string[] = []

		for (const stmt of sf.statements) {
			let specifier: string | null = null
			if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
				specifier = stmt.moduleSpecifier.text
			} else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
				specifier = stmt.moduleSpecifier.text
			}
			if (!specifier) continue

			if (specifier.startsWith('.')) {
				const resolved = resolveLocalImport(filePath, specifier, allFiles)
				if (resolved) local.push(resolved)
			} else {
				const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
				if (!external.includes(pkg)) external.push(pkg)
			}
		}

		graph.set(filePath, { local, external })
	}

	const lines: string[] = []
	for (const [file, deps] of [...graph].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (deps.local.length === 0 && deps.external.length === 0) continue
		const parts: string[] = []
		if (deps.local.length > 0) parts.push(deps.local.join(', '))
		if (deps.external.length > 0) parts.push(`[${deps.external.join(', ')}]`)
		lines.push(`${file} → ${parts.join(', ')}`)
	}

	return lines.length > 0 ? `\`\`\`\n${lines.join('\n')}\n\`\`\`` : 'No dependencies found.'
}

function resolveLocalImport(fromFile: string, specifier: string, allFiles: Set<string>): string | null {
	const dir = dirname(fromFile).replace(/\\/g, '/')
	const raw = posix.normalize(dir === '.' ? specifier.slice(2) : `${dir}/${specifier.slice(2)}`)
		.replace(/\\/g, '/')
	const stripped = raw.replace(/\.js$|\.mjs$|\.cjs$/, '')

	for (const ext of ['.ts', '.js', '.mjs', '.cjs']) {
		if (allFiles.has(stripped + ext)) return stripped + ext
	}
	if (allFiles.has(stripped + '/index.ts')) return stripped + '/index.ts'
	if (allFiles.has(stripped + '/index.js')) return stripped + '/index.js'
	if (allFiles.has(raw)) return raw
	return null
}

export function extractDeclarations(sourceText: string, filePath: string): string[] {
	const kind = filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
	const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind)
	const lines: string[] = []
	for (const stmt of sf.statements) visitNode(sf, stmt, lines, '  ')
	return lines
}

function visitNode(sf: ts.SourceFile, node: ts.Node, out: string[], indent: string): void {
	const range = lineRange(sf, node)
	const exp = isExported(node) ? 'export ' : ''

	if (ts.isFunctionDeclaration(node) && node.name) {
		const a = mod(node, ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''
		out.push(`${indent}${exp}${a}function ${node.name.text}(${params(sf, node)})${retType(sf, node)}  [${range}]`)
	} else if (ts.isClassDeclaration(node) && node.name) {
		out.push(`${indent}${exp}class ${node.name.text}  [${range}]`)
		for (const m of node.members) visitClassMember(sf, m, out, indent + '  ')
	} else if (ts.isInterfaceDeclaration(node)) {
		out.push(`${indent}${exp}interface ${node.name.text}  [${range}]`)
		for (const m of node.members) visitTypeMember(sf, m, out, indent + '  ')
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
			const type = d.type ? `: ${d.type.getText(sf)}` : inferType(sf, d.initializer)
			out.push(`${indent}${exp}${keyword} ${d.name.text}${type}  [${range}]`)
		}
	}
}

function visitClassMember(sf: ts.SourceFile, node: ts.Node, out: string[], indent: string): void {
	const range = lineRange(sf, node)
	const access = mod(node, ts.SyntaxKind.PrivateKeyword) ? 'private '
		: mod(node, ts.SyntaxKind.ProtectedKeyword) ? 'protected ' : ''
	const s = mod(node, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''
	const ro = mod(node, ts.SyntaxKind.ReadonlyKeyword) ? 'readonly ' : ''
	const a = mod(node, ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''

	if (ts.isConstructorDeclaration(node)) {
		out.push(`${indent}constructor(${params(sf, node)})  [${range}]`)
	} else if (ts.isMethodDeclaration(node) && node.name) {
		out.push(`${indent}${access}${s}${a}${node.name.getText(sf)}(${params(sf, node)})${retType(sf, node)}  [${range}]`)
	} else if (ts.isPropertyDeclaration(node) && node.name) {
		const type = node.type ? `: ${node.type.getText(sf)}` : ''
		out.push(`${indent}${access}${s}${ro}${node.name.getText(sf)}${type}  [${range}]`)
	}
}

function visitTypeMember(sf: ts.SourceFile, node: ts.Node, out: string[], indent: string): void {
	if (ts.isPropertySignature(node) && node.name) {
		const opt = node.questionToken ? '?' : ''
		const type = node.type ? `: ${node.type.getText(sf)}` : ''
		out.push(`${indent}${node.name.getText(sf)}${opt}${type}`)
	} else if (ts.isMethodSignature(node) && node.name) {
		const p = node.parameters.map(p => {
			const dots = p.dotDotDotToken ? '...' : ''
			const name = p.name.getText(sf)
			const opt = p.questionToken ? '?' : ''
			const type = p.type ? `: ${p.type.getText(sf)}` : ''
			return `${dots}${name}${opt}${type}`
		}).join(', ')
		const ret = node.type ? `: ${node.type.getText(sf)}` : ''
		out.push(`${indent}${node.name.getText(sf)}(${p})${ret}`)
	}
}

function params(sf: ts.SourceFile, node: ts.FunctionLikeDeclaration): string {
	return node.parameters.map(p => {
		const dots = p.dotDotDotToken ? '...' : ''
		const name = p.name.getText(sf)
		const opt = p.questionToken ? '?' : ''
		const type = p.type ? `: ${p.type.getText(sf)}` : ''
		return `${dots}${name}${opt}${type}`
	}).join(', ')
}

function retType(sf: ts.SourceFile, node: ts.FunctionLikeDeclaration): string {
	return node.type ? `: ${node.type.getText(sf)}` : ''
}

function lineRange(sf: ts.SourceFile, node: ts.Node): string {
	const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
	const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1
	return start === end ? `L${start}` : `L${start}-${end}`
}

function isExported(node: ts.Node): boolean {
	return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

function mod(node: ts.Node, kind: ts.SyntaxKind): boolean {
	return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === kind) ?? false)
}

function inferType(sf: ts.SourceFile, init: ts.Expression | undefined): string {
	if (!init) return ''
	if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init)) return ': string'
	if (ts.isNumericLiteral(init)) return ': number'
	if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) return ': boolean'
	if (ts.isArrayLiteralExpression(init)) return ': [...]'
	if (ts.isNewExpression(init) && init.expression) return `: ${init.expression.getText(sf)}`
	if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
		const p = params(sf, init)
		const r = retType(sf, init)
		return `: (${p})${r ? ` => ${r.slice(2)}` : ''}`
	}
	if (ts.isObjectLiteralExpression(init)) {
		const keys = init.properties
			.map(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? p.name?.getText(sf) : null)
			.filter(Boolean)
		return keys.length > 0 ? `: { ${keys.join(', ')} }` : ': {}'
	}
	if (ts.isAsExpression(init)) return inferType(sf, init.expression)
	return ''
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

export async function grepSearch(rootPath: string, pattern: string, options?: { isRegexp?: boolean; includePattern?: string }): Promise<string> {
	const allFiles: string[] = []
	await walk(rootPath, '', allFiles)

	const regex = options?.isRegexp ? new RegExp(pattern, 'gi') : null
	const lowerPattern = pattern.toLowerCase()
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
				const isMatch = regex ? regex.test(line) : line.toLowerCase().includes(lowerPattern)
				if (regex) regex.lastIndex = 0
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

function minimatch(filePath: string, pattern: string): boolean {
	const regexStr = pattern
		.replace(/\./g, '\\.')
		.replace(/\*\*/g, '<<<GLOBSTAR>>>')
		.replace(/\*/g, '[^/]*')
		.replace(/<<<GLOBSTAR>>>/g, '.*')
		.replace(/\?/g, '.')
	return new RegExp(`^${regexStr}$`).test(filePath)
}
