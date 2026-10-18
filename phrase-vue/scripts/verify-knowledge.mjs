import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

/**
 * 知识卡校验：结构、抽样一致性、来源可追溯、状态语义与体积门槛。
 *
 * 用法：node scripts/verify-knowledge.mjs [--strict]
 * --strict 额外要求 pending 字段为 0，供交付前使用。
 */

const root = new URL('../', import.meta.url);
const strict = process.argv.includes('--strict');
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

const dataBytes = await readFile(new URL('src/data/knowledge-cards.json', root));
const data = JSON.parse(dataBytes);
const provenance = await readJson('src/data/knowledge-provenance.json');
const currentVocabBytes = await readFile(new URL('src/data/vocab-data.json', root));
const currentVocab = JSON.parse(currentVocabBytes);
// 知识卡保留其构建时的事实与来源；词库增补不伪造卡片或改写原来源哈希。
const vocabBytes = createHash('sha256').update(currentVocabBytes).digest('hex') === data.plan.source_sha256
    ? currentVocabBytes : await readFile(new URL('evidence/refactor-vocab-before.json', root));
const vocab = JSON.parse(vocabBytes);
assert.equal(createHash('sha256').update(vocabBytes).digest('hex'), data.plan.source_sha256, '必须提供与知识卡构建来源匹配的词库快照');
for (const group of vocab.groups) for (const entry of group.entries) {
    const currentGroup = currentVocab.groups.find(g => g.id === group.id);
    assert.ok(currentGroup, `${group.id} 原分组不存在`);
    assert.ok(currentGroup.entries.some(e => JSON.stringify(e) === JSON.stringify(entry)), `${entry.word} 原笔记被修改或丢失`);
}
const sample = await readJson('research/sampling/all-words.json');
const manualLexical = await readJson('research/manual/lexical.json');

const entries = vocab.groups.flatMap(group => group.entries.map(entry => ({
    groupId: group.id, fileId: entry.fileId, word: entry.word, fields: entry.fields,
})));
const allWords = new Set(entries.map(entry => entry.word));
const refsByWord = new Map();
for (const entry of entries) {
    const list = refsByWord.get(entry.word) ?? [];
    list.push(`${entry.groupId}:${entry.fileId}`);
    refsByWord.set(entry.word, list);
}

const HOST_ALLOWLIST = new Set(['www.zdic.net', 'dict.idioms.moe.edu.tw', 'article.xuexi.cn', 'www.hao86.com', 'www.zhzidian.com']);
const STATUS = new Set(['verified', 'single-source', 'reviewed', 'pending', 'missing', 'conflict']);
const KIND = new Set(['quote', 'derived']);
const BASIS = new Set(['same_group', 'library_related', 'variant', 'curated']);
const FIELD_GROUPS = ['readings', 'senses', 'citations', 'synonyms', 'antonyms', 'confusables'];

assert.deepEqual(Object.keys(data), ['schema_version', 'generated_at', 'plan', 'stats', 'sources', 'cards']);
assert.match(data.schema_version, /^\d+\.\d+\.\d+$/);
assert.equal(data.plan.words_sha256, sample.words_sha256);
assert.equal(data.plan.source_sha256, createHash('sha256').update(vocabBytes).digest('hex'));
assert.deepEqual(data.plan.batches, sample.batches.map(batch => ({ id: batch.id, size: batch.size })), '批次计划必须一致');

assert.equal(data.cards.length, sample.words.length, `必须 ${sample.words.length} 张卡`);
assert.equal(new Set(data.cards.map(card => card.word)).size, sample.words.length, '词名唯一：同名词合并为一张卡');
assert.equal(new Set(data.cards.map(card => card.id)).size, sample.words.length, '卡片 id 唯一');
assert.deepEqual(data.cards.map(card => card.word), sample.words.map(item => item.word), '卡片顺序必须与全量词表一致');
assert.deepEqual(data.cards.map(card => card.word_rank), sample.words.map(item => item.word_rank), 'word_rank 必须连续');
assert.deepEqual(data.cards.map(card => card.batch), sample.words.map(item => item.batch), 'batch 必须与批次计划一致');

let entryRefTotal = 0;
const groupIds = new Set();
for (const card of data.cards) {
    assert.ok(allWords.has(card.word), `${card.word} 不在词库中`);
    const actual = card.entry_refs.map(ref => `${ref.group_id}:${ref.file_id}`).sort();
    const expected = [...(refsByWord.get(card.word) ?? [])].sort();
    assert.deepEqual(actual, expected, `${card.word} 的 entry_refs 与词库不一致`);
    entryRefTotal += card.entry_refs.length;
    card.entry_refs.forEach(ref => groupIds.add(ref.group_id));
    assert.ok(['standard', 'variant', 'modern_phrase', 'uncertain'].includes(card.lexical_status));
    if (card.lexical_status === 'variant') {
        assert.ok(card.variant_of && card.variant_provenance, `${card.word} 异形字段必须成对`);
    } else {
        assert.equal(card.variant_of, null);
    }
    assert.ok(['found', 'not_found'].includes(card.lookup.status));
    assert.equal(card.lookup.http_status, card.lookup.status === 'found' ? 200 : 404, `${card.word} 的 HTTP 状态与查询结果不一致`);
    if (card.lookup.status === 'found') assert.ok(card.lookup.page_sha256 && card.lookup.evidence_ref);

    for (const group of FIELD_GROUPS) {
        const block = card[group];
        assert.ok(block && Array.isArray(block.items), `${card.word} 缺少 ${group}.items`);
        const prov = block.provenance;
        assert.ok(prov, `${card.word} ${group} 缺少 provenance`);
        assert.ok(KIND.has(prov.kind));
        assert.ok(STATUS.has(prov.status));
        if (prov.kind === 'derived') assert.ok(prov.note?.startsWith('整理（derived）'), `${card.word} derived 缺少前缀`);
        if (prov.status === 'missing') assert.ok(prov.note && prov.note.length >= 6, `${card.word} missing 必须说明原因`);
        if (prov.status === 'pending') assert.fail(`${card.word} ${group} 仍有 pending 字段`);
        if (prov.source_url) {
            const url = new URL(prov.source_url);
            assert.equal(url.protocol, 'https:');
            assert.ok(HOST_ALLOWLIST.has(url.host), `${card.word} 来源域名不在允许列表：${url.host}`);
        }
        if (prov.kind === 'quote' && ['verified', 'single-source'].includes(prov.status)) {
            assert.ok(prov.quote && prov.quote.length <= 300, `${card.word} ${group} quote 缺失或超长`);
        }
    }
    assert.ok(card.register.label && card.register.label.length <= 20, `${card.word} 感情色彩标签异常`);
    assert.ok(['verified', 'missing'].includes(card.origin.provenance.status));

    if (card.lookup.status === 'found') {
        assert.ok(card.senses.items.length >= 1, `${card.word} 应有释义`);
        assert.ok(card.readings.items.length >= 1 || card.readings.provenance.status === 'missing',
            `${card.word} 缺读音时必须标记 missing`);
    }
    if (card.readings.items.length) {
        assert.equal(card.readings.items.filter(item => item.is_primary).length, 1, `${card.word} 主读音必须唯一`);
        const readingIds = new Set(card.readings.items.map(item => item.id));
        for (const sense of card.senses.items) {
            for (const id of sense.reading_ids) assert.ok(readingIds.has(id), `${card.word} 义项引用了不存在的读音`);
        }
    }
    if (card.lexical_status !== 'uncertain' && card.lookup.status === 'found') {
        assert.ok(card.confusables.items.length >= 1, `${card.word} 至少要有 1 个易混词`);
    }
    for (const item of card.confusables.items) {
        assert.notEqual(item.word, card.word, `${card.word} 易混词不能指向自身`);
        assert.ok(item.difference && item.difference.length >= 20, `${card.word} 差异说明过短`);
        assert.ok(item.basis.every(basis => BASIS.has(basis)));
        assert.ok(item.provenance?.note?.startsWith('整理（derived）'));
    }
    for (const item of [...card.synonyms.items, ...card.antonyms.items]) {
        assert.equal(item.in_library, allWords.has(item.word), `${card.word} 的 in_library 标记错误：${item.word}`);
    }
    for (const conflict of card.conflicts) {
        assert.ok(conflict.path && conflict.values?.length >= 2 && conflict.resolution);
    }
    assert.equal(card.verification.status, 'reviewed');
    assert.ok(card.verification.note);
}
assert.equal(entryRefTotal, 899);
assert.equal(groupIds.size, 108);

// quote 必须能在归档证据或人工稿文本块中找到原文。
const blockCache = new Map();
for (const card of data.cards) {
    const blocks = [];
    try {
        const evidence = await readJson(`research/evidence/${card.word}.json`);
        blocks.push(...Object.values(evidence.blocks ?? {}));
    } catch {
        // 无证据文件时只比对人工稿。
    }
    const manual = manualLexical[card.word];
    if (manual?.blocks) blocks.push(...Object.values(manual.blocks));
    if (manual?.sources) blocks.push(...manual.sources.map(source => source.quote).filter(Boolean));
    blockCache.set(card.word, blocks.join('\n'));
}
for (const card of data.cards) {
    const text = blockCache.get(card.word);
    const provenances = [
        card.readings.provenance, card.senses.provenance, card.origin.provenance,
        card.citations.provenance, card.synonyms.provenance, card.antonyms.provenance,
        ...card.confusables.items.map(item => item.provenance),
        card.register.provenance,
    ];
    for (const prov of provenances) {
        if (prov.kind === 'quote' && prov.quote) {
            assert.ok(text.includes(prov.quote), `${card.word} 的 quote 无法在归档证据中找到：${prov.quote.slice(0, 30)}`);
        }
    }
}

const stats = {
    cards: data.cards.length,
    distinct_words: new Set(data.cards.map(card => card.word)).size,
    entry_refs: entryRefTotal,
    groups_covered: groupIds.size,
    lookup_found: data.cards.filter(card => card.lookup.status === 'found').length,
    lookup_not_found: data.cards.filter(card => card.lookup.status === 'not_found').length,
    origin_present: data.cards.filter(card => Boolean(card.origin.text)).length,
    origin_missing: data.cards.filter(card => !card.origin.text).length,
    synonyms_present: data.cards.filter(card => card.synonyms.items.length > 0).length,
    antonyms_present: data.cards.filter(card => card.antonyms.items.length > 0).length,
    citations_present: data.cards.filter(card => card.citations.items.length > 0).length,
    readings_present: data.cards.filter(card => card.readings.items.length > 0).length,
    derived_fields: data.cards.reduce((sum, card) => sum + [card.register, card.confusables].filter(field => field.provenance.kind === 'derived').length, 0),
    pending_fields: data.cards.reduce((sum, card) => sum + [card.readings, card.senses, card.origin, card.citations, card.synonyms, card.antonyms]
        .filter(field => field.provenance?.status === 'pending').length, 0),
    conflicts: data.cards.reduce((sum, card) => sum + card.conflicts.length, 0),
};
assert.deepEqual(data.stats, stats, 'stats 必须由卡片重算一致');
assert.equal(stats.pending_fields, 0);
if (strict) assert.equal(stats.pending_fields, 0, 'strict 模式不允许 pending');

const bytes = dataBytes.length;
const gzipBytes = gzipSync(dataBytes).length;
assert.ok(bytes <= 5600 * 1024, `原始体积超限：${bytes}`);
assert.ok(gzipBytes <= 760 * 1024, `gzip 体积超限：${gzipBytes}`);

assert.equal(provenance.data_sha256, createHash('sha256').update(dataBytes).digest('hex'));
assert.equal(provenance.bytes, bytes);
assert.equal(provenance.cards, stats.cards);
assert.equal(provenance.entry_refs, stats.entry_refs);
assert.equal(provenance.pending_fields, stats.pending_fields);
assert.equal(provenance.vocab_data_sha256, data.plan.source_sha256);
assert.equal(provenance.plan_words_sha256, data.plan.words_sha256);

console.log(JSON.stringify({
    passed: true, strict, ...stats, bytes, gzip_bytes: gzipBytes,
    current_distinct_words: new Set(currentVocab.groups.flatMap(g => g.entries.map(e => e.word))).size,
    current_without_card: [...new Set(currentVocab.groups.flatMap(g => g.entries.map(e => e.word)))].filter(word => !data.cards.some(c => c.word === word)).length,
    data_sha256: provenance.data_sha256,
}, null, 4));
