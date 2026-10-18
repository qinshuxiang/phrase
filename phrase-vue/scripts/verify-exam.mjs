import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = `${root}public/exam/`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const problems = [];
const warnings = [];
const fail = message => problems.push(message);

let index;
try {
    index = JSON.parse(await readFile(`${dir}index.json`, 'utf8'));
} catch (error) {
    console.error(`无法读取 index.json：${error.message}`);
    process.exit(1);
}

const expectedKeys = ['version', 'generated_at', 'module', 'years', 'stats'];
for (const key of expectedKeys) if (!(key in index)) fail(`index 缺少字段 ${key}`);
if (index.version !== 1) fail(`index.version 应为 1，实际 ${index.version}`);
if (index.module?.name !== '言语理解与表达') fail('index.module.name 不是言语理解与表达');

const seen = new Set();
let total = 0;
const types = new Set();

for (const entry of index.years ?? []) {
    const path = `${dir}${entry.file}`;
    let buffer;
    try {
        buffer = await readFile(path);
    } catch {
        fail(`缺少分片 ${entry.file}`);
        continue;
    }
    if (buffer.length !== entry.bytes) fail(`${entry.file} 字节数不符：${buffer.length} != ${entry.bytes}`);
    if (sha256(buffer) !== entry.sha256) fail(`${entry.file} sha256 不符`);
    const shard = JSON.parse(buffer.toString('utf8'));
    if (shard.version !== 1) fail(`${entry.file} version 不是 1`);
    if (shard.year !== entry.year) fail(`${entry.file} year 与索引不符`);
    if (!Array.isArray(shard.questions)) {
        fail(`${entry.file} 缺少 questions 数组`);
        continue;
    }
    if (shard.questions.length !== entry.count) fail(`${entry.file} 题数不符：${shard.questions.length} != ${entry.count}`);
    total += shard.questions.length;

    for (const question of shard.questions) {
        const label = `${entry.file}#${question.qid}`;
        if (!question.qid) fail(`${label} 缺少 qid`);
        if (seen.has(question.qid)) fail(`${label} qid 重复`);
        seen.add(question.qid);
        if (question.year !== entry.year) fail(`${label} year 字段错误`);
        if (!question.paper) fail(`${label} 缺少 paper`);
        if (!question.stem || question.stem.replace(/\s/g, '').length < 8) fail(`${label} 题干过短`);
        if (!Array.isArray(question.options) || question.options.length < 2) fail(`${label} 选项不足`);
        if (new Set(question.options).size !== question.options.length) fail(`${label} 选项重复`);
        if (!Array.isArray(question.answer) || !question.answer.length) fail(`${label} 缺少答案`);
        else if (question.answer.some(value => !Number.isInteger(value) || value < 0 || value >= question.options.length)) fail(`${label} 答案下标越界`);
        if (question.material && !(question.material in (shard.materials ?? {}))) fail(`${label} 材料引用缺失`);
        for (const field of ['stem', 'analysis', ...question.options]) {
            if (/<img\b|<p\b|<\/p>|&nbsp;|<br/i.test(field)) fail(`${label} 残留 HTML 标签`);
        }
        if (question.type) types.add(question.type);
    }
}

if (index.stats?.kept !== total) fail(`stats.kept ${index.stats?.kept} 与分片总数 ${total} 不一致`);
const stats = index.stats ?? {};
const parseRetention = stats.kept / Math.max(1, stats.kept + stats.invalid);
const imageRatio = (stats.skipped_image + stats.material_image)
    / Math.max(1, stats.kept + stats.skipped_image + stats.material_image + stats.invalid);
if (parseRetention < 0.98) warnings.push(`可解析保留率 ${(parseRetention * 100).toFixed(1)}% 低于 98%`);
if (imageRatio > 0.15) warnings.push(`含图跳过占比 ${(imageRatio * 100).toFixed(1)}% 超过 15%`);
if (process.argv.includes('--strict') && warnings.length) problems.push(...warnings);

if (warnings.length) console.warn(`警告：\n- ${warnings.join('\n- ')}`);
if (problems.length) {
    console.error(`校验失败（${problems.length} 项）：\n- ${problems.slice(0, 40).join('\n- ')}`);
    process.exit(1);
}
console.log(JSON.stringify({
    passed: true,
    years: index.years.length,
    questions: total,
    types: [...types].sort(),
    parse_retention: Number(parseRetention.toFixed(4)),
    image_skip_ratio: Number(imageRatio.toFixed(4)),
    bytes: index.years.reduce((sum, item) => sum + item.bytes, 0),
}, null, 4));
