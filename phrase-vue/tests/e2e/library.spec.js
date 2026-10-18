import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const appUrl = process.env.OFFLINE_HTML ? pathToFileURL(process.env.OFFLINE_HTML).href : '/';
const screenshotDir = process.env.OFFLINE_HTML ? 'evidence/offline-screenshots' : 'evidence/screenshots';
mkdirSync(screenshotDir, { recursive: true });

const data = JSON.parse(readFileSync(new URL('../../src/data/vocab-data.json', import.meta.url)));

// 阅读页标题规则：系列-序号，老师；与 src/lib/library.js 的 sourceTitle 保持一致。
const sourceTitle = file => {
    const match = /言语1000词(\d+)|高频实词(\d+)/.exec(file.label);
    return match ? `${match[1] ? '言语1000词' : '高频实词'}-${match[1] ?? match[2]}，${file.teacher}` : file.label;
};

async function navigate(page, view) {
    const destination = ['notes', 'dashboard'].includes(view) ? 'knowledge' : view;
    const item = page.getByTestId(`nav-${destination}`);
    if (!await item.isVisible()) await page.getByRole('button', { name: '切换导航菜单' }).click();
    await item.click();
    // 等待官方 Sheet 关闭，避免下一次导航误命中退出动画中的旧按钮。
    if (page.viewportSize().width <= 768) await expect(item).not.toBeVisible();
    if (view === 'notes') await page.getByTestId('knowledge-search').click();
    if (view === 'dashboard') await page.getByTestId('knowledge-sources').click();
}

test('统计与所有来源阅读、词条边界及来源循环', async ({ page }) => {
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await expect(page.getByTestId('stat-value')).toHaveText(Object.values(data.stats).map(String));
    const mobile = page.viewportSize().width <= 768;
    if (mobile) await page.getByRole('button', { name: '切换导航菜单' }).click();
    await expect(page.locator('[data-testid^="nav-"]')).toHaveText(['学习首页01', '专项练习02', '真题套卷03', '错题与笔记04', '言语知识库05', '学习记录06']);
    if (mobile) await navigate(page, 'dashboard');
    for (const file of data.files) {
        await page.getByTestId(`source-${file.id}`).click();
        await expect(page.getByTestId('source-position')).toHaveText(`第 1 / ${file.words} 个`);
        await expect(page.getByRole('button', { name: '上一个', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '下一个', exact: true }).click();
        await expect(page.getByTestId('source-position')).toHaveText(`第 2 / ${file.words} 个`);
        await page.getByRole('button', { name: '返回全部来源' }).click();
    }
    await page.getByTestId(`source-${data.files[0].id}`).click();
    await page.getByRole('button', { name: '上一个来源', exact: true }).click();
    await expect(page.getByTestId('source-reader').getByRole('heading', { level: 2 })).toHaveText(sourceTitle(data.files.find(file => file.id === 'video-实词3')));
    await page.getByRole('button', { name: '下一个来源', exact: true }).click();
    await expect(page.getByTestId('source-reader').getByRole('heading', { level: 2 })).toHaveText(sourceTitle(data.files[0]));
    await page.getByRole('button', { name: '下一个', exact: true }).click();
    await navigate(page, 'notes');
    await navigate(page, 'dashboard');
    await expect(page.getByTestId('source-position')).toHaveText(`第 2 / ${data.files[0].words} 个`);
    await navigate(page, 'dashboard');
    await expect(page.getByTestId('dashboard')).toBeVisible();
});

test('分组单开、全文搜索、高亮、特殊字符与状态保留', async ({ page }) => {
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await navigate(page, 'notes');
    const groups = page.getByTestId('note-group');
    await expect(groups).toHaveCount(data.stats.groups);
    await groups.nth(0).getByRole('button').first().click();
    await expect(groups.nth(0)).toHaveAttribute('data-state', 'open');
    await groups.nth(1).getByRole('button').first().click();
    await expect(groups.nth(0)).toHaveAttribute('data-state', 'closed');
    await expect(groups.nth(1)).toHaveAttribute('data-state', 'open');
    await page.locator('#notes-search').fill(' 顾此失彼 ');
    await expect(page.getByTestId('notes-count')).toHaveText('找到 5 个词条 · 2 个词组');
    await expect(page.getByTestId('word-entry')).toHaveCount(5);
    await expect(page.getByTestId('notes-page').locator('mark').first()).toHaveText('顾此失彼');
    await navigate(page, 'dashboard');
    await navigate(page, 'notes');
    await expect(page.locator('#notes-search')).toHaveValue(' 顾此失彼 ');
    await page.locator('#notes-search').fill('.*');
    await expect(page.getByTestId('notes-count')).toHaveText('找到 0 个词条 · 0 个词组');
    await page.locator('#notes-search').fill('<img src=x onerror=alert(1)>');
    await expect(page.getByTestId('notes-page').locator('img')).toHaveCount(0);
    await page.getByRole('button', { name: '清除词条搜索', exact: true }).click();
    await expect(page.getByTestId('notes-count')).toHaveText(`共 ${data.stats.words} 个词条 · ${data.stats.groups} 个词组`);
    await expect(page.locator('#notes-search')).toBeFocused();
});

test('视频校订来源、课内成语与更正内容可阅读和检索', async ({ page }) => {
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await page.getByTestId('source-video-实词3').click();
    const idiom = data.files.find(file => file.id === 'video-实词3');
    await expect(page.getByTestId('source-position')).toHaveText(`第 1 / ${idiom.words} 个`);
    await expect(page.getByTestId('source-word')).toContainText('奉为圭臬');
    await expect(page.getByTestId('source-word')).toContainText('【自拟例句】');
    await navigate(page, 'notes');
    const file = data.files.find(file => file.id === 'video-21');
    await page.locator('#notes-search').fill(file.label);
    await expect(page.getByTestId('word-entry')).toHaveCount(file.words);
    await page.locator('#notes-search').fill('不能机械记成');
    await expect(page.getByTestId('word-entry')).toHaveCount(1);
    await expect(page.getByTestId('word-entry')).toContainText('鬼斧神工');
    await expect(page.getByTestId('word-entry')).toContainText('既可形容人工艺术');
    await page.locator('#notes-search').blur();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${screenshotDir}/video-correction-${page.viewportSize().width}.png`, fullPage: true });
    await page.locator('#notes-search').fill('不绝如缕');
    const corrected = page.getByTestId('word-entry').filter({ hasText: '若断若续' });
    await expect(corrected).toHaveCount(1);
    await expect(corrected).toContainText('【自拟例句】');
});

test('深浅主题跨刷新保存', async ({ page }) => {
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await page.getByRole('button', { name: '切换为深色' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: '切换为浅色' }).click();
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('浏览器禁用本地存储时仍可使用和切换主题', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('storage disabled'); } });
        Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('storage disabled'); } });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await page.getByRole('button', { name: '切换为深色' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await navigate(page, 'notes');
    await page.locator('#notes-search').fill('顾此失彼');
    await expect(page.getByTestId('notes-count')).toContainText('找到 5 个词条');
    expect(errors).toEqual([]);
});

test('无外部请求，页面载入后断网仍可检索所有内嵌数据', async ({ page, context }) => {
    const external = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        const url = route.request().url();
        const allowed = process.env.OFFLINE_HTML ? url === appUrl || url.startsWith('data:') || url.startsWith('blob:') : url.startsWith('http://127.0.0.1:4178/');
        if (!allowed) {
            external.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await context.setOffline(true);
    await navigate(page, 'notes');
    await page.locator('#notes-search').fill('顾此失彼');
    await expect(page.getByTestId('notes-count')).toContainText('找到 5 个词条');
    await navigate(page, 'dashboard');
    await page.getByTestId(`source-${data.files.at(-1).id}`).click();
    await expect(page.getByTestId('source-position')).toHaveText(`第 1 / ${data.files.at(-1).words} 个`);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
});

test('Lyra 样式、响应式导航、页面截图与横向溢出', async ({ page }, testInfo) => {
    mkdirSync(screenshotDir, { recursive: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(appUrl);
    await navigate(page, 'knowledge');
    await page.evaluate(() => document.fonts.ready);
    const style = await page.getByRole('button', { name: '切换为深色' }).evaluate(element => ({
        radius: getComputedStyle(element).borderRadius,
        font: getComputedStyle(element).fontFamily,
    }));
    expect(style.radius).toBe('0px');
    expect(style.font).toContain('JetBrains Mono');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(await overflow()).toBe(false);
    await page.screenshot({ path: `${screenshotDir}/${testInfo.project.name}-overview.png`, fullPage: true });
    await navigate(page, 'notes');
    await page.locator('#notes-search').fill('顾此失彼');
    await expect(page.getByTestId('notes-count')).toContainText('找到 5 个词条');
    expect(await overflow()).toBe(false);
    await page.screenshot({ path: `${screenshotDir}/${testInfo.project.name}-notes.png` });
    await navigate(page, 'dashboard');
    await page.getByTestId(`source-${data.files[0].id}`).click();
    await page.getByRole('button', { name: '切换为深色' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // 等待 neutral 深色主题完成颜色切换，避免捕获过渡中间帧。
    await expect(page.getByTestId('source-reader')).toHaveCSS('color', 'oklch(0.985 0 0)');
    await expect(page.getByRole('button', { name: '切换为浅色' })).toHaveCSS('color', 'oklch(0.985 0 0)');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${screenshotDir}/${testInfo.project.name}-reader-dark.png`, fullPage: true });
    expect(await overflow()).toBe(false);
    expect(errors).toEqual([]);
});

test('知识卡展示原来源、读音和易混辨析', async ({ page }) => {
    await page.goto(appUrl); await navigate(page, 'notes');
    await page.getByLabel('搜索词条', { exact: true }).fill('顾此失彼');
    const card = page.getByTestId('knowledge-card').filter({ hasText: '知识卡 · 顾此失彼' }).first();
    await card.locator('summary').click();
    await expect(card).toContainText('gù cǐ shī bǐ');
    await expect(card).toContainText('汉典');
    await expect(card).toContainText('整理归纳');
    await expect(card).toContainText('易混辨析');
});
