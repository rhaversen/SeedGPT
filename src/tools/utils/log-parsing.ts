function stripLogLine(line: string): string {
	return line
		.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '')
		.replace(/\x1b\[[0-9;]*m/g, '')
}

function isNoise(line: string): boolean {
	return /^\s*(console\.(log|warn|error))$/.test(line) ||
		/^\s+at\s+\S+\s+\(/.test(line) ||
		/^\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+\[(INFO|DEBUG)]/.test(line) ||
		/^\s*● Console$/.test(line)
}

function prioritizeFailures(lines: string[]): string {
	const failBlocks: string[] = []
	const summaryLines: string[] = []
	let inFail = false
	let inPass = false

	for (const line of lines) {
		if (/^\s*FAIL\s/.test(line)) {
			inFail = true
			inPass = false
			failBlocks.push(line)
		} else if (/^\s*PASS\s/.test(line)) {
			inFail = false
			inPass = true
		} else if (/^(Test Suites:|Tests:|Snapshots:|Time:|Ran all)/.test(line) || /^ERROR:/.test(line)) {
			inFail = false
			inPass = false
			summaryLines.push(line)
		} else if (inFail) {
			failBlocks.push(line)
		}
	}

	if (failBlocks.length > 0) {
		return [...failBlocks, '', ...summaryLines].join('\n').slice(-8000)
	}

	const errorLines = lines.filter(l =>
		/error\s*TS\d+/i.test(l) ||
		/SyntaxError|TypeError|ReferenceError|RangeError/.test(l) ||
		/Cannot find module|Module not found/.test(l) ||
		/ENOENT|EACCES/.test(l) ||
		(/^ERROR:/i.test(l) && !/Process completed with exit code/.test(l)),
	)

	if (errorLines.length > 0 || summaryLines.length > 0) {
		return [...errorLines, '', ...summaryLines].join('\n').slice(-8000)
	}

	const cleaned = lines.filter(l => l.trim() !== '' && !isNoise(l) && !/^\s*PASS\s/.test(l))
	return cleaned.join('\n').slice(-8000)
}

function parseStepSections(logText: string): { name: string; start: number; end: number; lines: string[] } [] {
	const raw = logText.split('\n')
	const lines = raw.map(stripLogLine)

	const sections: { name: string; start: number; end: number }[] = []
	let current: { name: string; start: number } | null = null

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^##\[group](.+)/)
		if (match) {
			if (current) sections.push({ ...current, end: i })
			current = { name: match[1], start: i }
		}
	}
	if (current) sections.push({ ...current, end: lines.length })

	return sections.map(s => ({ ...s, lines }))
}

export function extractFailedStepOutput(logText: string, failedStepNames: string[]): string {
	const parsed = parseStepSections(logText)
	const lines = parsed[0]?.lines ?? logText.split('\n').map(stripLogLine)
	const stepSections = parsed.map(({ name, start, end }) => ({ name, start, end }))

	const matchesStep = (sectionName: string, stepName: string): boolean => {
		const a = sectionName.toLowerCase()
		const b = stepName.toLowerCase()
		return a.includes(b) || a === `run ${b}`
	}

	const failedSections = failedStepNames.length > 0
		? stepSections.filter(s => failedStepNames.some(name => matchesStep(s.name, name)))
		: stepSections.filter(s => lines.slice(s.start, s.end).some(l => l.startsWith('##[error]')))

	if (failedSections.length > 0) {
		const output = failedSections.map(section => {
			const content = lines.slice(section.start, section.end)
				.filter(l => !l.startsWith('##[group]') && !l.startsWith('##[endgroup]') && l.trim() !== '')
				.map(l => l.replace(/^##\[error]/, 'ERROR: '))
			return `Step "${section.name}":\n${prioritizeFailures(content)}`
		}).join('\n\n')
		return output.slice(-8000)
	}

	const cleanedLines = lines
		.filter(l => !l.startsWith('##[group]') && !l.startsWith('##[endgroup]') && l.trim() !== '')
		.map(l => l.replace(/^##\[error]/, 'ERROR: '))

	return prioritizeFailures(cleanedLines)
}

export function extractCoverageFromLogs(logText: string): string | null {
	const parsed = parseStepSections(logText)
	const stepSections = parsed.map(({ name, start, end }) => ({ name, start, end }))
	const lines = parsed[0]?.lines ?? logText.split('\n').map(stripLogLine)

	const coverageSection = stepSections.find(s => {
		const name = s.name.toLowerCase()
		return name === 'coverage' || name === 'run coverage' || name.includes('coverage')
	})
	if (!coverageSection) return null

	const sectionLines = lines.slice(coverageSection.start, coverageSection.end)
		.filter(l => !l.startsWith('##[') && l.trim() !== '')

	const separators = sectionLines
		.map((l, i) => /^-+\|/.test(l) ? i : -1)
		.filter(i => i !== -1)
	if (separators.length < 2) return null

	return sectionLines.slice(separators[0], separators[separators.length - 1] + 1).join('\n')
}
