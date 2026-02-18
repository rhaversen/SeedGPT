export interface TrackedRegion {
	start: number
	end: number
	lastUseTurn: number
}

export function addRegion(regions: TrackedRegion[], start: number, end: number, turn: number): TrackedRegion[] {
	const result: TrackedRegion[] = []

	for (const existing of regions) {
		if (existing.end < start || existing.start > end) {
			result.push(existing)
			continue
		}
		if (existing.start < start) {
			result.push({ start: existing.start, end: start - 1, lastUseTurn: existing.lastUseTurn })
		}
		if (existing.end > end) {
			result.push({ start: end + 1, end: existing.end, lastUseTurn: existing.lastUseTurn })
		}
	}

	result.push({ start, end, lastUseTurn: turn })
	result.sort((a, b) => a.start - b.start)

	if (result.length <= 1) return result

	const merged: TrackedRegion[] = [{ ...result[0] }]
	for (let i = 1; i < result.length; i++) {
		const prev = merged[merged.length - 1]
		if (result[i].start <= prev.end + 1 && result[i].lastUseTurn === prev.lastUseTurn) {
			prev.end = Math.max(prev.end, result[i].end)
		} else {
			merged.push({ ...result[i] })
		}
	}

	return merged
}
