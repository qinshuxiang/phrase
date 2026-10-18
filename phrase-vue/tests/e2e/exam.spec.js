import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const appUrl = process.env.OFFLINE_HTML ? pathToFileURL(process.env.OFFLINE_HTML).href : '/';
const source = JSON.parse(readFileSync(new URL('../../public/xingce/papers/sx-2026.json', import.meta.url)));
const modules = [...new Set(source.questions.map(q => q.module))];
async function nav(page, view) {
    const button = page.getByTestId(`nav-${view}`);
    if (!await button.isVisible()) await page.getByRole('button', { name: '切换导航菜单' }).click();
    await button.click();
    if (page.viewportSize().width <= 768) await expect(button).not.toBeVisible();
}
async function practice(page, module = '政治理论') {
    await nav(page, 'practice');
    await page.getByLabel('年份', { exact: true }).selectOption('2026');
    await page.getByLabel('练习模块').selectOption(module);
    await page.getByLabel('出题顺序').selectOption('ordered');
    await page.getByLabel('练习题量').selectOption('10');
    await page.getByTestId('start-practice').click();
    await expect(page.getByTestId('question-stem')).toBeVisible();
}
async function state(page) {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('xingce-learning', 1);
        open.onsuccess = () => { const db = open.result, tx = db.transaction('archive'), req = tx.objectStore('archive').get('main'); req.onsuccess = () => { resolve(req.result); db.close(); }; req.onerror = () => reject(req.error); };
    }));
}
async function restoreFile(page, data) {
    await page.getByTestId('backup-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'xingce-study-backup', data })) });
    await page.getByTestId('confirm-restore').click();
}

test('六模块练习、待核验反馈、材料图片与放大', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(appUrl);
    await expect(page.getByTestId('target')).toHaveValue('山西');
    await expect(page.getByTestId('start-practice')).toHaveCount(0);
    await page.screenshot({ path: `evidence/${process.env.OFFLINE_HTML ? 'offline-' : ''}study-home-${testInfo.project.name}.png`, fullPage: true });
    for (const module of modules) {
        await practice(page, module);
        await page.getByTestId('option-0').click();
        await page.getByTestId('submit-answer').click();
        await expect(page.getByTestId('question-feedback')).toBeVisible();
        const images = page.getByTestId('study-question').locator('img');
        if (await images.count()) {
            await expect(images.first()).toBeVisible();
            expect(await images.first().evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
            await images.first().click();
            await expect(page.getByRole('heading', { name: '题目图片 · 可滚动查看' })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(images.first().locator('..')).toBeFocused();
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        if (module === '资料分析') await page.screenshot({ path: `evidence/${process.env.OFFLINE_HTML ? 'offline-' : ''}study-material-${testInfo.project.name}.png`, fullPage: true });
        await page.getByTestId('finish-session').click();
        await expect(page.getByTestId('session-result')).toBeVisible();
        await page.getByRole('button', { name: '返回专项练习', exact: true }).click();
    }
    expect((await state(page)).records).toHaveLength(6);
    expect(errors).toEqual([]);
});

test('套卷隐藏答案、修改答案、答题卡、草稿刷新与统一交卷', async ({ page }) => {
    await page.goto(appUrl);
    await nav(page, 'papers');
    await page.getByTestId('paper-sx-2026').click();
    await expect(page.getByTestId('question-stem')).toBeVisible();
    await expect(page.getByTestId('submit-answer')).toHaveCount(0);
    await page.getByTestId('option-0').click();
    await page.getByTestId('option-1').click();
    await expect(page.getByTestId('question-feedback')).toHaveCount(0);
    await page.getByRole('button', { name: '标记待检查', exact: true }).click();
    await page.getByRole('button', { name: '转到第106题', exact: true }).click();
    await expect(page.getByTestId('question-material')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('session-progress')).toContainText('第 106');
    await page.getByRole('button', { name: '转到第1题', exact: true }).click();
    await expect(page.getByTestId('option-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '取消待检查' })).toBeVisible();
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('session-result')).toContainText(`总题数 ${source.questions.length}`);
    await expect(page.getByTestId('question-feedback')).toBeVisible();
    const saved = await state(page);
    expect(saved.records[0].answers['sx-2026:1']).toEqual([1]);
    expect(saved.records[0].outcomes.filter(o => !o.answered)).toHaveLength(source.questions.length - 1);
    expect(Object.keys(saved.wrong)).toEqual(['sx-2026:1']);
});

test('错题、收藏、纯文本笔记、手动掌握与再次答错', async ({ page }) => {
    await page.goto(appUrl); await practice(page);
    await page.getByTestId('option-0').click(); await page.getByTestId('submit-answer').click();
    await page.getByTestId('favorite').click();
    await page.getByLabel('个人笔记（纯文本）').fill('<img src=x onerror=alert(1)> 我的解题笔记');
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.getByTestId('finish-session').click();
    await nav(page, 'review');
    await page.getByTestId('review-item-sx-2026:1').getByRole('button').click();
    await page.getByRole('button', { name: '标记已掌握', exact: true }).click();
    await page.getByRole('button', { name: '重做本题', exact: true }).click();
    await page.getByTestId('option-0').click(); await page.getByTestId('submit-answer').click();
    await page.getByTestId('finish-session').click();
    await page.getByRole('button', { name: '返回错题与笔记', exact: true }).click();
    await expect(page.getByTestId('review-item-sx-2026:1')).toContainText('累计答错2次 · 待复习');
    await page.reload();
    await page.getByTestId('review-notes').click();
    await expect(page.getByTestId('review-item-sx-2026:1')).toContainText('<img src=x onerror=alert(1)> 我的解题笔记');
    expect(await page.getByTestId('review-item-sx-2026:1').locator('img').count()).toBe(0);
    await page.getByTestId('review-favorites').click();
    await expect(page.getByTestId('review-item-sx-2026:1')).toBeVisible();
});

test('到时自动交卷、切换页面不暂停与重复交卷幂等', async ({ page }) => {
    await page.clock.install(); await page.goto(appUrl); await nav(page, 'papers');
    await page.getByLabel('训练时长', { exact: true }).fill('1');
    await page.getByTestId('paper-sx-2026').click();
    await expect(page.getByTestId('question-stem')).toBeVisible();
    await page.getByTestId('option-0').click();
    await nav(page, 'knowledge'); await page.clock.fastForward(61000);
    await nav(page, 'papers');
    await expect(page.getByTestId('session-result')).toBeVisible();
    expect((await state(page)).records).toHaveLength(1);
    await page.reload(); await nav(page, 'records');
    await expect(page.getByRole('heading', { name: '练习历史（1）' })).toBeVisible();
    expect((await state(page)).records[0].duration).toBe(60000);
});

test('备份包含草稿、恢复完整状态；非法引用失败不覆盖档案', async ({ page }) => {
    await page.goto(appUrl); await practice(page);
    await page.getByTestId('option-0').click();
    await page.getByTestId('favorite').click(); await nav(page, 'records');
    const before = await state(page);
    const download = page.waitForEvent('download'); await page.getByTestId('export-backup').click();
    expect((await download).suggestedFilename()).toContain('行测学习备份');
    const invalid = structuredClone(before); invalid.favorites.push('sx-9999:1');
    await restoreFile(page, invalid); await expect(page.getByRole('alert')).toContainText('试卷不存在');
    expect(await state(page)).toEqual(before);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const altered = structuredClone(before); altered.target = '国考'; altered.notes['sx-2026:1'] = '恢复的笔记';
    await restoreFile(page, altered); await expect(page.getByRole('status')).toContainText('备份已恢复');
    await page.reload(); await expect(page.getByTestId('target')).toHaveValue('国考');
    expect((await state(page)).notes['sx-2026:1']).toBe('恢复的笔记');
    await page.getByTestId('resume').click(); await expect(page.getByTestId('option-0')).toHaveAttribute('aria-pressed', 'true');
});

test('旧数据迁移一次，原键保留，旧错题仍能重做', async ({ page }) => {
    const legacy = JSON.parse(readFileSync(new URL('../../public/exam/verbal/2026.json', import.meta.url))).questions[0];
    await page.addInitScript(qid => {
        localStorage.setItem('vocab-exam-history', JSON.stringify({ version: 1, records: [{ id: 'old', at: '2026-10-01', size: 20, accuracy: 0.5 }] }));
        localStorage.setItem('vocab-exam-wrong', JSON.stringify({ version: 1, items: [{ qid, wrong_count: 1 }] }));
    }, legacy.qid);
    await page.goto(appUrl); await nav(page, 'review');
    await expect(page.getByTestId(`review-item-legacy:${legacy.qid}`)).toBeVisible({ timeout: 30000 });
    await page.getByTestId(`review-item-legacy:${legacy.qid}`).getByRole('button').click();
    await page.getByRole('button', { name: '重做本题', exact: true }).click();
    await expect(page.getByTestId('question-stem')).toBeVisible();
    await page.reload();
    expect((await state(page)).legacyHistory).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('vocab-exam-wrong'))).toContain(legacy.qid);
});

test('IndexedDB不可用时提示临时存储并能答题、导出', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('storage disabled'); } }));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(appUrl); await expect(page.getByRole('alert')).toContainText('临时记录');
    await practice(page); await page.getByTestId('option-0').click(); await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('session-result')).toBeVisible(); await nav(page, 'records');
    const download = page.waitForEvent('download'); await page.getByTestId('export-backup').click(); await download;
    expect(errors).toEqual([]);
});

test('主库、扩展题源和六模块均无外部请求，页面无溢出', async ({ page }) => {
    const external = [], errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith('blob:') || u.startsWith('data:') || (process.env.OFFLINE_HTML ? u === appUrl : u.startsWith('http://127.0.0.1:4178/'))) return route.continue();
        external.push(u); return route.abort();
    });
    await page.goto(appUrl); await practice(page, '资料分析');
    await expect(page.getByTestId('question-material').locator('img').first()).toBeVisible();
    await page.getByTestId('finish-session').click(); await page.getByRole('button', { name: '返回专项练习' }).click();
    await page.getByLabel('题源', { exact: true }).selectOption('extension');
    await page.getByTestId('start-practice').click(); await expect(page.getByTestId('question-stem')).toBeVisible({ timeout: 30000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('关闭后过期的套卷刷新即交卷，保存时间不超过原时限', async ({ page }) => {
    await page.goto(appUrl); await nav(page, 'papers');
    await page.getByLabel('训练时长', { exact: true }).fill('1');
    await page.getByTestId('paper-sx-2026').click(); await expect(page.getByTestId('question-stem')).toBeVisible();
    await page.getByTestId('option-0').click();
    const saved = await state(page); saved.active.startedAt = Date.now() - 120000; saved.active.deadline = saved.active.startedAt + 60000;
    await page.evaluate(data => new Promise(resolve => {
        const open = indexedDB.open('xingce-learning', 1);
        open.onsuccess = () => { const db = open.result, tx = db.transaction('archive', 'readwrite'); tx.objectStore('archive').put(data, 'main'); tx.oncomplete = () => { db.close(); resolve(); }; };
    }), saved);
    await page.reload(); await expect(page.getByTestId('session-result')).toBeVisible();
    expect((await state(page)).records[0].duration).toBe(60000);
    expect((await state(page)).active).toBeNull();
});

test('恢复备份事务被取消时，原数据库和当前界面不变', async ({ page }) => {
    await page.goto(appUrl); await practice(page); await page.getByTestId('favorite').click(); await nav(page, 'records');
    const before = await state(page); const candidate = structuredClone(before); candidate.target = '国考';
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) { const request = put.apply(this, args); this.transaction.abort(); return request; };
    });
    await restoreFile(page, candidate);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await state(page)).toEqual(before);
    await expect(page.getByTestId('target')).toHaveValue('山西');
});

test('跳到主要内容保留当前学习页面与草稿', async ({ page }) => {
    await page.goto(appUrl); await practice(page);
    await page.getByRole('link', { name: '跳到主要内容' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('question-stem')).toBeVisible();
    await expect(page.locator('#main-content')).toBeFocused();
    expect((await state(page)).active.mode).toBe('practice');
});
