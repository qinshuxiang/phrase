import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(new URL('src/data/vocab-data.json', root)));
const result = await build({
    root: fileURLToPath(root), configFile: fileURLToPath(new URL('vite.config.js', root)),
    build: { write: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false,
        modulePreload: false, sourcemap: false },
});
assert.ok(!Array.isArray(result) && 'output' in result, '只支持单入口构建');
const chunks = result.output.filter(item => item.type === 'chunk');
assert.equal(chunks.length, 1, '单HTML必须把所有脚本打进同一个入口');
assert.equal(chunks[0].imports.length + chunks[0].dynamicImports.length, 0, '不允许残留脚本依赖');
const htmlAsset = result.output.find(item => item.fileName === 'index.html');
assert.ok(htmlAsset, '必须生成HTML入口');
let html = String(htmlAsset.source);
const assets = new Map(result.output.map(item => [item.fileName, item]));
let scripts = 0, styles = 0;
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (_, url) => {
    const item = assets.get(url.replace(/^\.\//, ''));
    assert.ok(item?.type === 'chunk', `无法内嵌脚本：${url}`);
    scripts++;
    return `<script type="module">${item.code.replace(/<\/script/gi, '<\\/script')}</script>`;
});
html = html.replace(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+)")[^>]*>/gi, (_, url) => {
    const item = assets.get(url.replace(/^\.\//, ''));
    assert.ok(item?.type === 'asset', `无法内嵌样式：${url}`);
    styles++;
    const css = String(item.source);
    for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
        assert.match(match[1].replace(/^['"]|['"]$/g, ''), /^(?:data:|#)/, 'CSS资源必须内嵌');
    }
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
});
assert.equal(scripts, 1);
assert.equal(styles, 1);
assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)="[^"#]+"/i, '不得有外部脚本或样式');
const licenses = await Promise.all(['JetBrainsMono-OFL.txt', 'shadcn-vue-MIT.txt'].map(async name =>
    `${name}\n${await readFile(new URL(`licenses/${name}`, root), 'utf8')}`));
html = html.replace('</head>', `<!--\n离线单文件；包含 ${data.stats.words} 条词汇记录。\n${licenses.join('\n\n').replace(/-->/g, '-- >')}\n-->\n</head>`);

// 真题分片以 gzip+base64 内嵌；file:// 下 fetch 失败时由 DecompressionStream 解压。
let exam = { shards: 0, questions: 0, embedded_bytes: 0 };
const examIndexPath = new URL('public/exam/index.json', root);
if (existsSync(fileURLToPath(examIndexPath))) {
    const examIndex = JSON.parse(await readFile(examIndexPath, 'utf8'));
    const shards = {};
    for (const year of examIndex.years) {
        shards[year.year] = gzipSync(await readFile(new URL(`public/exam/${year.file}`, root)), { level: 9 }).toString('base64');
    }
    const payload = JSON.stringify({ version: 1, index: examIndex, shards }).replace(/</g, '\\u003c');
    assert.doesNotMatch(payload, /<\/script/i, '内嵌题库不得包含脚本结束标记');
    const before = html;
    html = html.replace('</body>', `<script type="application/json" id="exam-embedded">${payload}</script>\n</body>`);
    assert.notEqual(html, before, '必须把题库写入 body 结束标签前');
    exam = { shards: examIndex.years.length, questions: examIndex.stats.kept, embedded_bytes: Buffer.byteLength(payload) };
} else {
    console.warn('未找到 public/exam/index.json，离线版不含真题考试。');
}

// 全科卷按卷压缩，图片只内嵌被引用的文件；运行时按需转为Blob。
const studyIndex = JSON.parse(await readFile(new URL('public/xingce/index.json', root), 'utf8'));
const studyPapers = {}, studyImages = {};
for (const paper of studyIndex.papers) studyPapers[paper.id] = gzipSync(await readFile(new URL(`public/xingce/${paper.file}`, root)), { level: 9 }).toString('base64');
for (const path of studyIndex.images) studyImages[path] = (await readFile(new URL(`public/xingce/${path}`, root))).toString('base64');
const studyPayload = JSON.stringify({ index: studyIndex, papers: studyPapers, images: studyImages }).replace(/</g, '\\u003c');
html = html.replace('</body>', `<script type="application/json" id="xingce-embedded">${studyPayload}</script>\n</body>`);
const dir = new URL('offline/', root);
await mkdir(dir, { recursive: true });
const output = new URL('行测学习-离线版.html', dir);
await writeFile(output, html);
const bytes = Buffer.from(html);
assert.ok(bytes.length < 64 * 1024 * 1024, '离线单文件不得超过64MiB');
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(new URL('行测学习-离线版.html.sha256', dir), `${sha256}  行测学习-离线版.html\n`);
const report = { passed: true, output: fileURLToPath(output), bytes: bytes.length, sha256,
    stats: data.stats, inline_scripts: scripts, inline_styles: styles,
    embedded_font_faces: (html.match(/data:font\/woff2;base64,/g) ?? []).length,
    embedded_exam: exam, embedded_study: { ...studyIndex.stats, images: studyIndex.images.length, embedded_bytes: Buffer.byteLength(studyPayload) },
    external_assets: 0, data_sha256: createHash('sha256').update(await readFile(new URL('src/data/vocab-data.json', root))).digest('hex') };
await writeFile(new URL('evidence/offline-build.json', root), `${JSON.stringify(report, null, 4)}\n`);
console.log(JSON.stringify(report, null, 4));
