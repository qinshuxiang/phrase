import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * 抽样脚本：从词库 859 个唯一词名中按固定种子抽取 100 个，输出可复算的清单。
 *
 * 算法固定为 mulberry32(20261018) + Fisher-Yates 洗牌 + 取末 100 个 + 按首次出现顺序排序，
 * 任何参数变化都会改变 words_sha256，`--check` 会因此失败。
 */

const SEED = 20261018;
const SIZE = 100;
const ALGORITHM = 'mulberry32(20261018) + Fisher-Yates + last-100 + first-appearance-sort';
const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');

/** 32 位种子随机数发生器，输出 [0,1)。 */
function mulberry32(seed) {
    let state = seed;
    return function random() {
        state |= 0;
        state = state + 0x6D2B79F5 | 0;
        let t = Math.imul(state ^ state >>> 15, 1 | state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const vocabBytes = await readFile(new URL('src/data/vocab-data.json', root));
const vocab = JSON.parse(vocabBytes);
const entries = vocab.groups.flatMap(group => group.entries.map(entry => ({
    groupId: group.id, fileId: entry.fileId, word: entry.word,
})));

/** 首次出现顺序决定唯一词名数组和每词的记录引用。 */
const refsByWord = new Map();
for (const entry of entries) {
    const list = refsByWord.get(entry.word) ?? [];
    list.push({ group_id: entry.groupId, file_id: entry.fileId });
    refsByWord.set(entry.word, list);
}
const words = [...refsByWord.keys()];

const shuffled = words.slice();
const random = mulberry32(SEED);
for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const picked = shuffled.slice(-SIZE).sort((a, b) => words.indexOf(a) - words.indexOf(b));

const sampleWords = picked.map((word, index) => {
    const refs = refsByWord.get(word);
    return {
        sample_rank: index + 1,
        word,
        group_ids: [...new Set(refs.map(ref => ref.group_id))],
        entry_refs: refs,
        duplicate_name: refs.length > 1,
    };
});
const wordsSha256 = createHash('sha256').update(JSON.stringify(picked)).digest('hex');
const groupCount = new Set(sampleWords.flatMap(item => item.group_ids)).size;
const refCount = sampleWords.reduce((sum, item) => sum + item.entry_refs.length, 0);

const report = {
    schema_version: '1.0.0',
    seed: SEED,
    size: SIZE,
    algorithm: ALGORITHM,
    source_file: 'src/data/vocab-data.json',
    source_sha256: createHash('sha256').update(vocabBytes).digest('hex'),
    source_bytes: vocabBytes.length,
    words_sha256: wordsSha256,
    stats: {
        distinct_words: words.length,
        sampled_words: sampleWords.length,
        entry_refs: refCount,
        groups_covered: groupCount,
        duplicate_names: sampleWords.filter(item => item.duplicate_name).length,
    },
    words: sampleWords,
};

const target = new URL('research/sampling/sample-100.json', root);
if (check) {
    const existing = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(existing.words_sha256, report.words_sha256, '抽样结果与已锁定清单不一致');
    assert.deepEqual(existing.stats, report.stats, '抽样统计与已锁定清单不一致');
    console.log(JSON.stringify({ passed: true, checked: true, ...report.stats, words_sha256: wordsSha256 }, null, 4));
} else {
    await mkdir(new URL('research/sampling/', root), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 4)}\n`);
    const rows = sampleWords.map(item => `| ${item.sample_rank} | ${item.word} | ${item.group_ids.join(' / ')} | ${item.entry_refs.length > 1 ? '是' : '否'} |`);
    const markdown = [
        '# 100 词试点抽样清单', '',
        `- 种子：${SEED}`,
        `- 算法：${ALGORITHM}`,
        `- 词库：${report.source_file}，sha256 \`${report.source_sha256}\``,
        `- 结果：${report.stats.sampled_words} 词 / ${report.stats.entry_refs} 条记录引用 / ${report.stats.groups_covered} 个分组 / ${report.stats.duplicate_names} 个重复词名`,
        `- 词序哈希：\`${wordsSha256}\``, '',
        '| 序号 | 词名 | 所属分组 | 重复词名 |',
        '| ---: | --- | --- | :---: |',
        ...rows, '',
    ].join('\n');
    await writeFile(new URL('research/sampling/sample-100.md', root), markdown);
    console.log(JSON.stringify({ passed: true, written: true, ...report.stats, words_sha256: wordsSha256 }, null, 4));
}
