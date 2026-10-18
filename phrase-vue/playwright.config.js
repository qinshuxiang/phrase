import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './test-results/http',
    fullyParallel: false,
    workers: 1,
    timeout: 60000,
    expect: { timeout: 10000 },
    reporter: [['list'], ['json', { outputFile: process.env.E2E_REPORT || 'evidence/e2e-results.json' }]],
    use: {
        baseURL: 'http://127.0.0.1:4178',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
        { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
    webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4178', reuseExistingServer: false, timeout: 30000 },
});
