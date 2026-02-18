import { describe, it, expect } from '@jest/globals'
import { addRegion } from './contextRegions.js'

describe('addRegion', () => {
	it('returns single region for empty input', () => {
		expect(addRegion([], 1, 10, 1)).toEqual([{ start: 1, end: 10, lastUseTurn: 1 }])
	})

	it('merges adjacent regions with same turn', () => {
		const result = addRegion([{ start: 1, end: 5, lastUseTurn: 1 }], 6, 10, 1)
		expect(result).toEqual([{ start: 1, end: 10, lastUseTurn: 1 }])
	})

	it('keeps non-overlapping regions separate with different turns', () => {
		const result = addRegion([{ start: 1, end: 5, lastUseTurn: 1 }], 8, 10, 2)
		expect(result).toEqual([
			{ start: 1, end: 5, lastUseTurn: 1 },
			{ start: 8, end: 10, lastUseTurn: 2 },
		])
	})

	it('clips old region when new overlaps partially', () => {
		const result = addRegion([{ start: 1, end: 10, lastUseTurn: 1 }], 5, 15, 2)
		expect(result).toEqual([
			{ start: 1, end: 4, lastUseTurn: 1 },
			{ start: 5, end: 15, lastUseTurn: 2 },
		])
	})

	it('splits old region when new is contained within', () => {
		const result = addRegion([{ start: 1, end: 20, lastUseTurn: 1 }], 5, 10, 2)
		expect(result).toEqual([
			{ start: 1, end: 4, lastUseTurn: 1 },
			{ start: 5, end: 10, lastUseTurn: 2 },
			{ start: 11, end: 20, lastUseTurn: 1 },
		])
	})

	it('replaces old region when new fully covers it', () => {
		const result = addRegion([{ start: 5, end: 10, lastUseTurn: 1 }], 1, 15, 2)
		expect(result).toEqual([{ start: 1, end: 15, lastUseTurn: 2 }])
	})

	it('handles multiple overlapping old regions', () => {
		const regions = [
			{ start: 1, end: 5, lastUseTurn: 1 },
			{ start: 8, end: 12, lastUseTurn: 1 },
		]
		const result = addRegion(regions, 3, 10, 2)
		expect(result).toEqual([
			{ start: 1, end: 2, lastUseTurn: 1 },
			{ start: 3, end: 10, lastUseTurn: 2 },
			{ start: 11, end: 12, lastUseTurn: 1 },
		])
	})
})
