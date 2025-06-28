/**
 * src/ai-providers/deepseek.js
 *
 * Implementation for interacting with Deepseek models
 * using the OpenAI SDK since Deepseek API is OpenAI compatible.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { BaseAIProvider } from './base-provider.js';

export class DeepseekAIProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Deepseek';
	}

	/**
	 * Creates and returns a Deepseek client instance.
	 * @param {object} params - Parameters for client initialization
	 * @param {string} params.apiKey - Deepseek API key
	 * @param {string} [params.baseURL] - Optional custom API endpoint
	 * @returns {Function} Deepseek client function using OpenAI SDK
	 * @throws {Error} If API key is missing or initialization fails
	 */
	getClient(params) {
		try {
			const { apiKey, baseURL } = params;

			if (!apiKey) {
				throw new Error('Deepseek API key is required.');
			}

			// Deepseek API is OpenAI compatible, so we use the OpenAI SDK
			return createOpenAI({
				apiKey,
				baseURL: baseURL || 'https://api.deepseek.com',
				// Add Deepseek specific configuration if needed
				defaultQuery: {
					// Any default query parameters
				},
				defaultHeaders: {
					// Any default headers
				}
			});
		} catch (error) {
			this.handleError('client initialization', error);
		}
	}
} 