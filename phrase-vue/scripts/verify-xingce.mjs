import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const index = JSON.parse(await readFile(new URL('public/xingce/index.json', root)));
const baseline = JSON.parse(await readFile(new URL('evidence/refactor-baseline.json', root)));
const concurrent = JSON.parse(await readFile(new URL('evidence/refactor-vocab-concurrent.json', root)));
let preserved = 0;
for (const [path, expected] of Object.entries(baseline.hashes)) {
    const accepted = path === 'src/data/vocab-data.json' ? concurrent.acceptedHash : expected;
    assert.equal(hash(await readFile(new URL(path, root))), accepted, `原资料变更：${path}`); preserved++;
}
const oldVocab = JSON.parse(await readFile(new URL('evidence/refactor-vocab-before.json', root)));
assert.equal(hash(await readFile(new URL('evidence/refactor-vocab-before.json', root))), baseline.hashes['src/data/vocab-data.json'], '原词库快照必须匹配任务启动哈希');
const vocab = JSON.parse(await readFile(new URL('src/data/vocab-data.json', root)));
let groupCursor = -1;
for (const group of oldVocab.groups) {
    const at = vocab.groups.findIndex(g => g.id === group.id); assert.ok(at > groupCursor, '原分组顺序变更'); groupCursor = at;
    const next = vocab.groups[at]; assert.equal(group.title, next.title);
    let cursor = -1;
    for (const entry of group.entries) {
        const at = next.entries.findIndex(e => e.fileId === entry.fileId && e.word === entry.word);
        assert.ok(at > cursor, '原词条顺序变更'); cursor = at;
        assert.deepEqual(next.entries[at], entry);
    }
}
for (const file of oldVocab.files) {
    const current = vocab.files.find(f => f.id === file.id);
    for (const key of Object.keys(file).filter(k => k !== 'words')) assert.deepEqual(current[key], file[key]);
}
assert.equal(index.version, 2); assert.equal(index.papers.length, 46);
const ids = new Set(), refs = new Set();
const counts = { questions: 0, verified: 0, pending: 0, missing: 0, missingAnalysis: 0 };
for (const paper of index.papers) {
    const bytes = await readFile(new URL(`public/xingce/${paper.file}`, root));
    assert.equal(bytes.length, paper.bytes); assert.equal(hash(bytes), paper.sha256);
    const shard = JSON.parse(bytes);
    const original = JSON.parse(await readFile(new URL(`../fenbi/题库/${paper.category}/${paper.id}.json`, root)));
    assert.equal(shard.questions.length, original.questions.length); assert.equal(shard.questions.length, paper.questionCount);
    const modules = {};
    for (const [i, q] of shard.questions.entries()) {
        const raw = original.questions[i];
        assert.equal(q.id, `${paper.id}:${raw.no}`); assert.ok(!ids.has(q.id)); ids.add(q.id);
        assert.equal(q.number, raw.no); assert.equal(q.module, raw.module); modules[q.module] = (modules[q.module] ?? 0) + 1;
        assert.equal(q.stem, raw.stem); assert.deepEqual(q.options, raw.options.map(o => o.text));
        assert.equal(q.analysis, raw.explain ?? '');
        assert.equal(q.materialId ? shard.materials[q.materialId] : '', raw.material === null ? '' : original.materials[raw.material]);
        assert.deepEqual(q.answer, raw.answer ? [raw.answer.charCodeAt(0) - 65] : []);
        assert.ok(['verified', 'pending', 'missing'].includes(q.provenance.status));
        assert.ok(q.answer.every(i => Number.isInteger(i) && i >= 0 && i < q.options.length));
        if (q.provenance.status === 'verified') assert.ok(q.answer.length);
        counts.questions++; counts[q.provenance.status]++; if (!q.analysis) counts.missingAnalysis++;
    }
    for (const module of paper.modules) assert.equal(modules[module.name], module.count);
    for (const match of bytes.toString().matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) refs.add(match[1]);
}
assert.equal(counts.questions, 6020);
for (const key of Object.keys(counts)) assert.equal(counts[key], index.stats[key]);
assert.deepEqual([...refs].sort(), index.images);
for (const image of refs) assert.equal(hash(await readFile(new URL(`public/xingce/${image}`, root))), hash(await readFile(new URL(`../fenbi/题库/${image}`, root))));
assert.equal(index.pendingPdfs.length, 11);
const report = { passed: true, ...counts, papers: 46, images: refs.size, preserved_files: preserved,
    concurrent_vocab: concurrent, preserved_prior_offline_entries: oldVocab.stats.words, source_rebuild: 'npm run import:xingce -- --check' };
await writeFile(new URL('evidence/xingce-verification.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
