import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * 全量批次计划：把 859 个唯一词名排成 1 个试点批 + 8 个补充批，供抓取与构建共用。
 *
 * 用法：node scripts/knowledge-plan.mjs [--check]
 * 产物：research/sampling/all-words.json、research/sampling/all-words.md
 *
 * 规则：
 * - 词序＝词库首次出现顺序，与 pilot 清单的排序口径一致；
 * - 前 100 个沿用 pilot-100 清单的成员，id 由词名 sha1 决定，不随批次变化；
 * - 其余 759 个按首次出现顺序切成 8 批（前 7 批 95，末批 94）；
 * - entry_refs 直接取当前词库的全部记录，同名词合并到同一张卡。
 */

const PILOT_SIZE = 100;
const BATCH_COUNT = 8;
const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');

const vocabBytes = await readFile(new URL('src/data/vocab-data.json', root));
const vocab = JSON.parse(vocabBytes);
const pilot = JSON.parse(await readFile(new URL('research/sampling/sample-100.json', root), 'utf8'));

const refsByWord = new Map();
for (const group of vocab.groups) {
    for (const entry of group.entries) {
        const list = refsByWord.get(entry.word) ?? [];
        list.push({ group_id: group.id, file_id: entry.fileId });
        refsByWord.set(entry.word, list);
    }
}
const allWords = [...refsByWord.keys()];
assert.equal(allWords.length, 859, `唯一词名应为 859，实际 ${allWords.length}`);

const pilotWords = new Set(pilot.words.map(item => item.word));
assert.equal(pilotWords.size, PILOT_SIZE, 'pilot 清单必须是 100 个唯一词名');
for (const word of pilotWords) assert.ok(refsByWord.has(word), `${word} 不在当前词库中`);

const remaining = allWords.filter(word => !pilotWords.has(word));
assert.equal(remaining.length, 759, `剩余词应为 759，实际 ${remaining.length}`);

/** 均分剩余词：前 7 批 95，末批 94。 */
const base = Math.floor(remaining.length / BATCH_COUNT);
const extra = remaining.length % BATCH_COUNT;
const batches = [{ id: 'pilot-100', size: PILOT_SIZE, words: allWords.filter(word => pilotWords.has(word)) }];
let cursor = 0;
for (let index = 0; index < BATCH_COUNT; index++) {
    const size = base + (index < extra ? 1 : 0);
    batches.push({ id: `b${index + 1}`, size, words: remaining.slice(cursor, cursor + size) });
    cursor += size;
}
assert.equal(cursor, remaining.length, '批次切分未覆盖全部剩余词');

const batchByWord = new Map();
for (const batch of batches) for (const word of batch.words) batchByWord.set(word, batch.id);

const words = allWords.map((word, index) => {
    const refs = refsByWord.get(word);
    return {
        word_rank: index + 1,
        word,
        batch: batchByWord.get(word),
        group_ids: [...new Set(refs.map(ref => ref.group_id))],
        entry_refs: refs,
        duplicate_name: refs.length > 1,
        pilot: pilotWords.has(word),
    };
});

const wordsSha256 = createHash('sha256').update(JSON.stringify(allWords)).digest('hex');
const report = {
    schema_version: '1.0.0',
    source_file: 'src/data/vocab-data.json',
    source_sha256: createHash('sha256').update(vocabBytes).digest('hex'),
    source_bytes: vocabBytes.length,
    words_sha256: wordsSha256,
    stats: {
        distinct_words: words.length,
        pilot_words: pilotWords.size,
        remaining_words: remaining.length,
        entry_refs: words.reduce((sum, item) => sum + item.entry_refs.length, 0),
        groups_covered: new Set(words.flatMap(item => item.group_ids)).size,
        duplicate_names: words.filter(item => item.duplicate_name).length,
    },
    batches: batches.map(batch => ({ id: batch.id, size: batch.size, words: batch.words })),
    words,
};

const target = new URL('research/sampling/all-words.json', root);
if (check) {
    const existing = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(existing.words_sha256, report.words_sha256, '词序与已锁定计划不一致');
    assert.deepEqual(existing.stats, report.stats, '统计与已锁定计划不一致');
    assert.deepEqual(existing.batches, report.batches, '批次切分与已锁定计划不一致');
    console.log(JSON.stringify({ passed: true, checked: true, ...report.stats, words_sha256: wordsSha256 }, null, 4));
    process.exit(0);
}

await mkdir(new URL('research/sampling/', root), { recursive: true });
await writeFile(target, `${JSON.stringify(report, null, 4)}\n`);

const batchRows = batches.map(batch => `| ${batch.id} | ${batch.size} | ${batch.words.slice(0, 3).join('、')}… |`);
const markdown = [
    '# 全量批次计划', '',
    `- 词库：${report.source_file}，sha256 \`${report.source_sha256}\``,
    `- 结果：${report.stats.distinct_words} 个词名 / ${report.stats.entry_refs} 条记录引用 / ${report.stats.groups_covered} 个分组 / ${report.stats.duplicate_names} 个重复词名`,
    `- 词序哈希：\`${wordsSha256}\``, '',
    '| 批次 | 词数 | 起始词 |',
    '| --- | ---: | --- |',
    ...batchRows, '',
    '词序为词库首次出现顺序；卡片 id 取词名 sha1 前 10 位，批次变化不影响 id。',
].join('\n');
await writeFile(new URL('research/sampling/all-words.md', root), markdown);
console.log(JSON.stringify({ passed: true, written: true, ...report.stats, words_sha256: wordsSha256 }, null, 4));
