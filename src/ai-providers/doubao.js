/**
 * src/ai-providers/doubao.js
 *
 * Implementation for interacting with Doubao (火山方舟) models
 * using the OpenAI SDK since Doubao API is OpenAI compatible.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { BaseAIProvider } from './base-provider.js';

export class DoubaoAIProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Doubao';
	}

	/**
	 * Creates and returns a Doubao client instance.
	 * @param {object} params - Parameters for client initialization
	 * @param {string} params.apiKey - Doubao API key
	 * @param {string} [params.baseURL] - Optional custom API endpoint
	 * @returns {Function} Doubao client function using OpenAI SDK
	 * @throws {Error} If API key is missing or initialization fails
	 */
	getClient(params) {
		try {
			const { apiKey, baseURL } = params;

			if (!apiKey) {
				throw new Error('Doubao API key is required.');
			}

			// Doubao API is OpenAI compatible, so we use the OpenAI SDK
			return createOpenAI({
				apiKey,
				baseURL: baseURL || 'https://ark.cn-beijing.volces.com/api/v3',
				defaultHeaders: {
					'Content-Type': 'application/json'
				}
			});
		} catch (error) {
			this.handleError('client initialization', error);
		}
	}
} 