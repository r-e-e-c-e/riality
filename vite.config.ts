import { enhancedImages } from '@sveltejs/enhanced-img';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-bun';
import { loadEnv } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ mode }) => ({
	plugins: [
		enhancedImages(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'frame-ancestors': ['none'],
					'form-action': ['self']
				}
			},
			paths: { origin: loadEnv(mode, process.cwd(), '').APP_ORIGIN || undefined },
			experimental: { remoteFunctions: true }
		})
	],
	// Vitest is only for Svelte component tests, in a real browser. Name them
	// *.svelte.test.ts next to the component. Server code is tested with bun test.
	test: {
		expect: { requireAssertions: true },
		include: ['src/**/*.svelte.test.ts'],
		passWithNoTests: true,
		browser: {
			enabled: true,
			provider: playwright(),
			instances: [{ browser: 'chromium', headless: true }]
		}
	}
}));
