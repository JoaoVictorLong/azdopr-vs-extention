import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: 'stable',
	mocha: {
		ui: 'bdd',
		timeout: 30000,
		color: true
	}
});
