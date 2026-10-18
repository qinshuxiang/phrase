import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './playwright.config.js';

process.env.OFFLINE_HTML ||= fileURLToPath(new URL('./offline/行测学习-离线版.html', import.meta.url));

export default defineConfig({
    ...base,
    outputDir: './test-results/offline',
    webServer: undefined,
    reporter: [['list'], ['json', { outputFile: 'evidence/offline-e2e-results.json' }]],
    use: { ...base.use, baseURL: undefined, offline: true },
});
