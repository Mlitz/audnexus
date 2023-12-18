import type { AxiosResponse } from 'axios'

import type { AudibleChapter } from '#config/types'
import ChapterHelper from '#helpers/books/audible/ChapterHelper'
import * as fetchPlus from '#helpers/utils/fetchPlus'
import SharedHelper from '#helpers/utils/shared'
import { regions } from '#static/regions'
import { apiChapters, parsedChapters } from '#tests/datasets/helpers/chapters'

jest.mock('#helpers/utils/fetchPlus')
jest.mock('#helpers/utils/shared')

let asin: string
let helper: ChapterHelper
let mockResponse: AudibleChapter
let region: string
let url: string
const deepCopy = (obj: unknown) => JSON.parse(JSON.stringify(obj))

beforeEach(() => {
	// Variables
	asin = 'B079LRSMNN'
	region = 'us'
	url = `https://api.audible.com/1.0/content/${asin}/metadata?response_groups=chapter_info&quality=High`
	mockResponse = deepCopy(apiChapters)
	// Set up spys
	jest.spyOn(SharedHelper.prototype, 'buildUrl').mockReturnValue(url)
	jest
		.spyOn(fetchPlus, 'default')
		.mockImplementation(() => Promise.resolve({ data: mockResponse, status: 200 } as AxiosResponse))
	// Set up helpers
	helper = new ChapterHelper(asin, region)
})

describe('ChapterHelper should', () => {
	test('setup constructor correctly', () => {
		expect(helper.asin).toBe(asin)
		expect(helper.adpToken).toBeDefined()
		expect(helper.privateKey).toBeDefined()
		expect(helper.requestUrl).toBe(url)
	})

	test('build path', () => {
		expect(helper.buildPath()).toBe(
			`/1.0/content/${asin}/metadata?response_groups=chapter_info&quality=High`
		)
	})

	test('cleanup chapter titles', () => {
		// Regular title isn't changed
		expect(helper.chapterTitleCleanup('Chapter 1')).toBe('Chapter 1')
		// Title with trailing period is changed
		expect(helper.chapterTitleCleanup('Chapter 1.')).toBe('Chapter 1')
		// Title with just a number is changed
		expect(helper.chapterTitleCleanup('123')).toBe('Chapter 123')
        // Title with an underscore is changed
        expect(helper.chapterTitleCleanup('Chapter_1')).toBe('Chapter 1')
	})

	test('sign request', () => {
		expect(helper.signRequest(helper.adpToken, helper.privateKey)).toBeDefined()
	})

	test('fetch chapters', async () => {
		await expect(helper.fetchChapter()).resolves.toEqual(apiChapters)
	})

	test('return undefined if no chapters', async () => {
		asin = asin.slice(0, -1)
		jest
			.spyOn(fetchPlus, 'default')
			.mockImplementation(() => Promise.resolve({ data: undefined, status: 404 } as AxiosResponse))
		url = `https://api.audible.com/1.0/content/${asin}/metadata?response_groups=chapter_info`
		jest.spyOn(SharedHelper.prototype, 'buildUrl').mockReturnValue(url)
		helper = new ChapterHelper(asin, region)

		await expect(helper.fetchChapter()).resolves.toBeUndefined()
	})

	test('parse response', async () => {
		const chapters = await helper.fetchChapter()
		await expect(helper.parseResponse(chapters)).resolves.toEqual(parsedChapters)
	})

	test('return undefined if no dom for parse response', async () => {
		await expect(helper.parseResponse(undefined)).resolves.toBeUndefined()
	})

	test('process', async () => {
		await expect(helper.process()).resolves.toEqual(parsedChapters)
	})

	describe('handle region: ', () => {
		test.each(Object.keys(regions))('%s', (region) => {
			helper = new ChapterHelper(asin, region)
			expect(helper.chapterTitleCleanup('123')).toBe(`${regions[region].strings.chapterName} 123`)
		})
	})
})

describe('ChapterHelper should throw error when', () => {
	test('no input data', () => {
		expect(() => helper.getFinalData()).toThrowError('No input data')
	})

	const OLD_ENV = process.env

	test('missing environment vars', () => {
		// Set environment variables
		process.env = { ...OLD_ENV }
		process.env.ADP_TOKEN = undefined
		process.env.PRIVATE_KEY = undefined
		// setup function to fail if environment variables are missing
		const bad_helper = function () {
			new ChapterHelper(asin, region)
		}
		expect(bad_helper).toThrowError('Missing environment variable(s): ADP_TOKEN or PRIVATE_KEY')
		// Restore environment
		process.env = OLD_ENV
	})

	test('chapter missing required keys', async () => {
		await expect(
			helper.parseResponse({
				content_metadata: {
					chapter_info: {
						brandIntroDurationMs: 2043,
						brandOutroDurationMs: 5062,
						is_accurate: true,
						runtime_length_ms: 62548009,
						runtime_length_sec: 62548
					}
				},
				response_groups: ['chapter_info']
			} as AudibleChapter)
		).rejects.toThrowError(
			`Required key 'chapters' does not exist for chapter in Audible API response for ASIN ${asin}`
		)
	})
	// test('chapter has required keys and missing values', () => {
	// 	helper.inputJson = {
	// 		brandIntroDurationMs: '',
	// 		brandOutroDurationMs: 5062,
	// 		chapters: [
	// 			{
	// 				length_ms: 945561,
	// 				start_offset_ms: 22664,
	// 				start_offset_sec: 23,
	// 				title: '1'
	// 			}
	// 		],
	// 		is_accurate: true,
	// 		runtime_length_ms: 62548009,
	// 		runtime_length_sec: 62548
	// 	} as unknown as AudibleChapter['content_metadata']['chapter_info']
	// 	expect(helper.hasRequiredKeys()).toEqual({
	// 		isValid: false,
	// 		message:
	// 			"Required key 'brandIntroDurationMs' does not have a valid value in Audible API response for ASIN B079LRSMNN"
	// 	})
	// })
	test('error fetching Chapter data', async () => {
		// Mock Fetch to fail once
		jest.spyOn(fetchPlus, 'default').mockImplementation(() =>
			Promise.reject({
				status: 403
			})
		)
		jest.spyOn(global.console, 'log')
		await expect(helper.fetchChapter()).resolves.toBeUndefined()
		expect(console.log).toHaveBeenCalledWith(
			`An error occured while fetching data from chapters. Response: 403, ASIN: ${asin}`
		)
	})
})
