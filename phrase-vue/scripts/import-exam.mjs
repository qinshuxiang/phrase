import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { parsePaper } from '../src/lib/exam-parse.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = name => {
    const index = args.indexOf(name);
    return index === -1 ? '' : args[index + 1];
};
const src = resolve(option('--src') || join(root, '../xingcezhenti/03-言语理解与表达'));
const out = resolve(option('--out') || join(root, 'public/exam'));
const check = args.includes('--check');
const MODULE = '言语理解与表达';

if (!existsSync(src)) {
    console.error(`缺少真题源目录：${src}`);
    console.error('先执行：git clone --depth 1 --filter=blob:none --sparse https://github.com/ERRRC/xingcezhenti.git');
    console.error('再执行：git -C xingcezhenti sparse-checkout set "03-言语理解与表达"');
    process.exit(2);
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = value => createHash('sha1').update(value).digest('hex');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function gitInfo() {
    try {
        const commit = execFileSync('git', ['-C', src, 'log', '-1', '--format=%H'], { encoding: 'utf8' }).trim();
        const date = execFileSync('git', ['-C', src, 'log', '-1', '--format=%cI'], { encoding: 'utf8' }).trim();
        return { commit, date };
    } catch {
        return { commit: '', date: '' };
    }
}

const { commit, date } = gitInfo();
const generatedAt = date || new Date().toISOString();
const started = Date.now();
const files = (await readdir(src)).filter(name => name.endsWith('.md') && name !== 'README.md').sort(compare);

const years = new Map();
const seenQid = new Set();
const stats = { papers: files.length, raw: 0, kept: 0, skipped_image: 0, material_image: 0, invalid: 0, duplicates: 0 };
const perPaper = [];

for (const file of files) {
    const markdown = await readFile(join(src, file), 'utf8');
    const { paper, materials, questions, skipped } = parsePaper(markdown, { module: MODULE });
    stats.skipped_image += skipped.image;
    stats.material_image += skipped.material_image;
    stats.invalid += skipped.invalid;
    if (!paper.year || !questions.length) {
        perPaper.push({ file, year: paper.year, kept: 0, skipped });
        continue;
    }
    const paperKey = `p${fileHash(file).slice(0, 8)}`;
    const bucket = years.get(paper.year) ?? { materials: {}, questions: [] };
    years.set(paper.year, bucket);
    let kept = 0;
    for (const question of questions) {
        stats.raw++;
        const qid = question.qid || `h${fileHash(`${question.stem}\u0000${question.options.join('\u0001')}`).slice(0, 12)}`;
        if (seenQid.has(qid)) {
            stats.duplicates++;
            continue;
        }
        seenQid.add(qid);
        let materialId = null;
        if (question.material && materials[question.material]) {
            materialId = `${paperKey}:${question.material}`;
            bucket.materials[materialId] = materials[question.material];
        }
        bucket.questions.push({
            qid,
            year: paper.year,
            region: paper.region,
            paper: paper.title,
            type: question.type,
            stem: question.stem,
            material: materialId,
            options: question.options,
            answer: question.answer,
            analysis: question.analysis,
        });
        kept++;
        stats.kept++;
    }
    perPaper.push({ file, year: paper.year, kept, skipped });
}

const yearList = [...years.keys()].sort((a, b) => a - b);
const shards = new Map();
for (const year of yearList) {
    const bucket = years.get(year);
    const content = `${JSON.stringify({ version: 1, year, materials: bucket.materials, questions: bucket.questions })}\n`;
    shards.set(year, {
        file: `verbal/${year}.json`,
        content,
        bytes: Buffer.byteLength(content),
        sha256: sha256(content),
        count: bucket.questions.length,
    });
}

const index = {
    version: 1,
    generated_at: generatedAt,
    module: { id: 'verbal', name: MODULE, source: 'ERRRC/xingcezhenti', commit, license: null },
    years: yearList.map(year => {
        const shard = shards.get(year);
        return { year, count: shard.count, file: shard.file, bytes: shard.bytes, sha256: shard.sha256 };
    }),
    stats,
};
const indexContent = `${JSON.stringify(index, null, 4)}\n`;
const sourceContent = `# 真题数据来源

- 仓库：ERRRC/xingcezhenti（https://github.com/ERRRC/xingcezhenti）
- 提交：${commit || '未知'}
- 模块：${MODULE}（2016–2026）
- 导入时间：${generatedAt}
- 题量：${stats.papers} 套卷，入库 ${stats.kept} 题

## 授权提示

该仓库未提供 LICENSE。题目与解析的版权归原题库及粉笔所有，本目录数据仅用于个人学习，不得再分发或用于商业用途。
`;

const targets = [
    ['index.json', indexContent],
    ['SOURCE.md', sourceContent],
    ...[...shards].map(([year, shard]) => [shard.file, shard.content]),
];

if (check) {
    const problems = [];
    for (const [name, content] of targets) {
        const path = join(out, name);
        if (!existsSync(path)) {
            problems.push(`缺少 ${name}`);
            continue;
        }
        if (await readFile(path, 'utf8') !== content) problems.push(`内容不一致 ${name}`);
    }
    if (problems.length) {
        console.error(problems.join('\n'));
        process.exit(1);
    }
    console.log(`检查通过：${targets.length} 个文件与源数据一致。`);
    process.exit(0);
}

await mkdir(join(out, 'verbal'), { recursive: true });
for (const [name, content] of targets) await writeFile(join(out, name), content);

const considered = stats.kept + stats.skipped_image + stats.material_image + stats.invalid;
const evidence = {
    passed: true,
    source: src,
    commit,
    generated_at: generatedAt,
    duration_ms: Date.now() - started,
    stats,
    parse_retention: Number((stats.kept / Math.max(1, stats.kept + stats.invalid)).toFixed(4)),
    image_skip_ratio: Number(((stats.skipped_image + stats.material_image) / Math.max(1, considered)).toFixed(4)),
    years: index.years,
    files: targets.length,
    total_bytes: targets.reduce((sum, [, content]) => sum + Buffer.byteLength(content), 0),
    skipped_papers: perPaper.filter(item => item.kept === 0).map(item => basename(item.file)),
};
await writeFile(join(root, 'evidence/exam-import.json'), `${JSON.stringify(evidence, null, 4)}\n`);
console.log(JSON.stringify(evidence, null, 4));
