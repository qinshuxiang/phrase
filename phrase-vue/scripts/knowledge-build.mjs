import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

/**
 * 知识卡构建：把汉典证据与人工整理稿合并成 src/data/knowledge-cards.json。
 *
 * 用法：node scripts/knowledge-build.mjs [--check]
 * 约束：不联网；合并优先级人工稿 > 证据抽取；generated_at 固定，保证重复构建字节一致。
 * 词表取 research/sampling/all-words.json；差异稿 = confusables.json（试点）+ confusables-b*.json（补充批）。
 */

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const GENERATED_AT = '2026-10-18T00:00:00+08:00';
const RETRIEVED_AT = '2026-10-18';
const DERIVED_PREFIX = '整理（derived）';

const SOURCES = [
    { id: 'zdic', name: '汉典', homepage: 'https://www.zdic.net/', tier: 1 },
    { id: 'moe', name: '教育部《成语典》', homepage: 'https://dict.idioms.moe.edu.tw/', tier: 1 },
    { id: 'xuexi', name: '人民日报总编室易错字指南（学习强国转载）', homepage: 'https://article.xuexi.cn/', tier: 2 },
    { id: 'hao86', name: '好查汉语词典', homepage: 'https://www.hao86.com/', tier: 3 },
];

const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const vocab = await readJson('src/data/vocab-data.json');
const plan = await readJson('research/sampling/all-words.json');
const state = await readJson('research/cache/state.json');
const manualLexical = await readJson('research/manual/lexical.json');
const queries = await readJson('research/search/queries.json');
const vocabBytes = await readFile(new URL('src/data/vocab-data.json', root));

/** 合并试点稿与各补充批差异稿；缺文件视为该批尚未开始。 */
async function loadConfusables() {
    const merged = { ...(await readJson('research/manual/confusables.json')) };
    for (const batch of plan.batches.filter(item => item.id !== 'pilot-100')) {
        const extra = await readJson(`research/manual/confusables-${batch.id}.json`).catch(() => ({}));
        Object.assign(merged, extra);
    }
    return merged;
}
const manualConfusables = await loadConfusables();

const entryIndex = new Map();
const groupWords = new Map();
for (const group of vocab.groups) {
    groupWords.set(group.id, group.entries.map(entry => entry.word));
    for (const entry of group.entries) {
        if (!entryIndex.has(entry.word)) entryIndex.set(entry.word, []);
        entryIndex.get(entry.word).push({ group, entry });
    }
}
const allWords = new Set(entryIndex.keys());
const cardId = word => `kc-${createHash('sha1').update(word).digest('hex').slice(0, 10)}`;

/** 读取词条证据；缺文件时返回空证据，由卡片标记 missing。 */
async function readEvidence(word) {
    try {
        return await readJson(`research/evidence/${word}.json`);
    } catch {
        return { word, source: null, parsed: null, blocks: {} };
    }
}

/** 拼装来源字段：quote 型事实统一入口。 */
function quoteProvenance({ status, sourceId, sourceName, url, quote, note, evidenceRef, crossChecked = false }) {
    return {
        kind: 'quote', status, source_id: sourceId, source_name: sourceName,
        source_url: url, retrieved_at: RETRIEVED_AT, quote: quote ?? null,
        note: note ?? null, evidence_ref: evidenceRef ?? null, cross_checked: crossChecked,
    };
}

/** 拼装整理字段：所有 derived 内容必须带「整理（derived）」前缀。 */
function derivedProvenance({ note, derivedFrom = [], status = 'reviewed' }) {
    return {
        kind: 'derived', status, source_id: null, source_name: '本库释义与汉典义项归纳',
        source_url: null, retrieved_at: RETRIEVED_AT, quote: null,
        note: `${DERIVED_PREFIX}：${note}`, evidence_ref: null, derived_from: derivedFrom,
    };
}

/** 计算易混词与本词的关联依据。 */
function confusableBasis(word, candidate) {
    const basis = [];
    const refs = entryIndex.get(word) ?? [];
    const sameGroup = refs.some(item => (groupWords.get(item.group.id) ?? []).includes(candidate));
    if (sameGroup) basis.push('same_group');
    const related = refs.some(item => (item.entry.fields['关联词'] ?? '').includes(candidate));
    if (related) basis.push('library_related');
    if (manualLexical[word]?.variant_of === candidate) basis.push('variant');
    if (!basis.length) basis.push('curated');
    return basis;
}

const cards = [];
for (const item of plan.words) {
    const word = item.word;
    const evidence = await readEvidence(word);
    const parsed = evidence.parsed;
    const lookupState = state[word] ?? {};
    const found = lookupState.status === 'parsed';
    const url = `https://www.zdic.net/hans/${encodeURIComponent(word)}`;
    const blocks = evidence.blocks ?? {};
    const lexical = manualLexical[word] ?? { status: found ? 'standard' : 'uncertain', variant_of: null, note: null, blocks: {}, sources: [] };
    const refs = entryIndex.get(word) ?? [];
    const registerLabel = (refs[0]?.entry.fields['日常用法'] ?? '').match(/【([^】]+)】/)?.[1] ?? '中性词';

    const missingProvenance = note => quoteProvenance({
        status: 'missing', sourceId: 'zdic', sourceName: '汉典', url, quote: null,
        note, evidenceRef: null,
    });

    const readings = (parsed?.readings.pinyin ?? []).length ? [{
        id: `${cardId(word)}-r1`,
        pinyin: parsed.readings.pinyin.join(' '),
        zhuyin: parsed.readings.zhuyin.join(' '),
        is_primary: true,
    }] : (lexical.blocks?.reading ? [{
        id: `${cardId(word)}-r1`, pinyin: lexical.blocks.reading, zhuyin: '', is_primary: true,
    }] : []);

    const readingsProvenance = readings.length
        ? quoteProvenance({
            status: lexical.blocks?.reading ? 'single-source' : 'verified',
            sourceId: lexical.blocks?.reading ? null : 'zdic',
            sourceName: lexical.blocks?.reading ? lexical.sources[0]?.name ?? '人工整理' : '汉典',
            url: lexical.blocks?.reading ? lexical.sources[0]?.url ?? null : url,
            quote: lexical.blocks?.reading ?? blocks.reading ?? readings[0].pinyin,
            evidenceRef: lexical.blocks?.reading ? null : `zdic:${word}#reading`,
        })
        : missingProvenance(found
            ? '汉典该词条未给出拼音与注音，未自行拟音。'
            : '汉典无该词条（HTTP 404），未自行拟音。');

    const senseItems = (parsed?.senses ?? []).map((sense, index) => ({
        id: `${cardId(word)}-s${index + 1}`,
        reading_ids: readings.length ? [readings[0].id] : [],
        definition: sense.definition,
        labels: index === 0 ? [registerLabel.replace('词', '')] : [registerLabel.replace('词', '')],
    }));
    if (!senseItems.length && lexical.blocks?.['sense-1']) {
        senseItems.push({
            id: `${cardId(word)}-s1`, reading_ids: readings.length ? [readings[0].id] : [],
            definition: lexical.blocks['sense-1'], labels: [registerLabel.replace('词', '')],
        });
    }
    const sensesProvenance = senseItems.length
        ? quoteProvenance({
            status: lexical.blocks?.['sense-1'] ? 'single-source' : 'verified',
            sourceId: lexical.blocks?.['sense-1'] ? null : 'zdic',
            sourceName: lexical.blocks?.['sense-1'] ? lexical.sources[0]?.name ?? '人工整理' : '汉典',
            url: lexical.blocks?.['sense-1'] ? lexical.sources[0]?.url ?? null : url,
            quote: lexical.blocks?.['sense-1'] ?? blocks['sense-1'] ?? senseItems[0].definition,
            evidenceRef: lexical.blocks?.['sense-1'] ? null : `zdic:${word}#sense-1`,
            note: senseItems.length > 1 ? `共 ${senseItems.length} 个义项，quote 仅记录第一个义项。` : null,
        })
        : missingProvenance(found
            ? '汉典该词条未提供可用释义，未自行补写。'
            : '汉典无该词条（HTTP 404），释义待补。');

    const origin = parsed?.origin
        ? {
            text: parsed.origin.text,
            provenance: quoteProvenance({
                status: 'verified', sourceId: 'zdic', sourceName: '汉典', url,
                quote: blocks.origin ?? parsed.origin.text, evidenceRef: `zdic:${word}#origin`,
            }),
        }
        : {
            text: null,
            provenance: missingProvenance(found
                ? '汉典该词条只列书证，无独立「出处」字段；未据书证反推出处。'
                : '汉典无该词条（HTTP 404），出处待补。'),
        };

    const citationItems = (parsed?.citations ?? []).map(citation => ({ text: citation.text, source: citation.source }));
    const citationsProvenance = citationItems.length
        ? quoteProvenance({
            status: 'verified', sourceId: 'zdic', sourceName: '汉典', url,
            quote: blocks['citation-1'] ?? citationItems[0].text, evidenceRef: `zdic:${word}#citation-1`,
            note: citationItems.length > 1 ? `共 ${citationItems.length} 条书证，quote 仅记录第一条。` : null,
        })
        : missingProvenance(found ? '汉典该词条未列书证。' : '汉典无该词条（HTTP 404），书证待补。');

    const synonyms = (parsed?.synonyms ?? []).map(candidate => ({ word: candidate, in_library: allWords.has(candidate) }));
    const antonyms = (parsed?.antonyms ?? []).map(candidate => ({ word: candidate, in_library: allWords.has(candidate) }));
    const synonymsProvenance = synonyms.length
        ? quoteProvenance({
            status: 'verified', sourceId: 'zdic', sourceName: '汉典', url,
            quote: blocks.synonyms ?? synonyms.map(item => item.word).join('、'), evidenceRef: `zdic:${word}#synonyms`,
        })
        : missingProvenance(found ? '汉典该词条未列近义词。' : '汉典无该词条（HTTP 404），近义词待补。');
    const antonymsProvenance = antonyms.length
        ? quoteProvenance({
            status: 'verified', sourceId: 'zdic', sourceName: '汉典', url,
            quote: blocks.antonyms ?? antonyms.map(item => item.word).join('、'), evidenceRef: `zdic:${word}#antonyms`,
        })
        : missingProvenance(found ? '汉典该词条未列反义词。' : '汉典无该词条（HTTP 404），反义词待补。');

    const curated = manualConfusables[word] ?? [];
    assert.ok(curated.length > 0, `${word} 缺少差异稿（批次 ${item.batch}）`);
    const confusableItems = curated.map(entry => {
        const basis = confusableBasis(word, entry.word);
        return {
            word: entry.word,
            basis,
            difference: entry.difference,
            provenance: derivedProvenance({
                note: '依据库内释义、关联词与汉典义项对比归纳，易混词来源逐条标注 basis。',
                derivedFrom: [url],
            }),
        };
    });

    const conflicts = [];
    const variantProvenance = lexical.status === 'variant' && lexical.sources?.length
        ? quoteProvenance({
            status: 'verified', sourceId: lexical.sources[0].url.includes('moe.edu.tw') ? 'moe' : 'xuexi',
            sourceName: lexical.sources[0].name, url: lexical.sources[0].url,
            quote: lexical.sources[0].quote, note: lexical.note,
        })
        : null;

    cards.push({
        id: cardId(word),
        word,
        batch: item.batch,
        word_rank: item.word_rank,
        lexical_status: lexical.status,
        variant_of: lexical.variant_of ?? null,
        variant_provenance: variantProvenance,
        lookup: {
            form: parsed?.word ?? word,
            status: found ? 'found' : 'not_found',
            section: parsed?.section ?? null,
            http_status: lookupState.http_status ?? null,
            page_sha256: lookupState.page_sha256 ?? null,
            fetched_at: lookupState.fetched_at ?? null,
            evidence_ref: found ? `zdic:${word}` : null,
        },
        entry_refs: refs.map(({ group, entry }) => ({ group_id: group.id, file_id: entry.fileId })),
        register: {
            label: registerLabel,
            provenance: derivedProvenance({
                note: '据库内「日常用法」标签归纳，非词典标注。',
            }),
        },
        readings: { items: readings, provenance: readingsProvenance },
        senses: { items: senseItems, provenance: sensesProvenance },
        origin,
        citations: { items: citationItems, provenance: citationsProvenance },
        synonyms: { items: synonyms, provenance: synonymsProvenance },
        antonyms: { items: antonyms, provenance: antonymsProvenance },
        confusables: {
            items: confusableItems,
            provenance: derivedProvenance({
                note: '易混词候选来自同组词条、「关联词」互指与异形关系；差异要点逐条整理并标注依据。',
            }),
        },
        conflicts,
        verification: {
            status: 'reviewed',
            reviewer_type: 'model',
            reviewer: 'WorkBuddy',
            reviewed_at: RETRIEVED_AT,
            review_log: 'research/manual/confusables.json、research/manual/confusables-b*.json',
            note: '事实字段逐条取自汉典页面或人工记录的来源原文；差异要点由模型整理，尚未经人工逐条复核。',
        },
    });
}

const entryRefCount = cards.reduce((sum, card) => sum + card.entry_refs.length, 0);
const groupsCovered = new Set(cards.flatMap(card => card.entry_refs.map(ref => ref.group_id))).size;
const countProvenance = predicate => cards.length * 0 + cards.reduce((sum, card) => sum + predicate(card), 0);
const stats = {
    cards: cards.length,
    distinct_words: new Set(cards.map(card => card.word)).size,
    entry_refs: entryRefCount,
    groups_covered: groupsCovered,
    lookup_found: cards.filter(card => card.lookup.status === 'found').length,
    lookup_not_found: cards.filter(card => card.lookup.status === 'not_found').length,
    origin_present: cards.filter(card => Boolean(card.origin.text)).length,
    origin_missing: cards.filter(card => !card.origin.text).length,
    synonyms_present: cards.filter(card => card.synonyms.items.length > 0).length,
    antonyms_present: cards.filter(card => card.antonyms.items.length > 0).length,
    citations_present: cards.filter(card => card.citations.items.length > 0).length,
    readings_present: cards.filter(card => card.readings.items.length > 0).length,
    derived_fields: countProvenance(card => [card.register, card.confusables].filter(field => field.provenance.kind === 'derived').length),
    pending_fields: countProvenance(card => [card.readings, card.senses, card.origin, card.citations, card.synonyms, card.antonyms]
        .filter(field => field.provenance?.status === 'pending').length),
    conflicts: cards.reduce((sum, card) => sum + card.conflicts.length, 0),
};

const data = {
    schema_version: '1.1.0',
    generated_at: GENERATED_AT,
    plan: {
        source_file: plan.source_file,
        source_sha256: plan.source_sha256,
        words_sha256: plan.words_sha256,
        batches: plan.batches.map(batch => ({ id: batch.id, size: batch.size })),
    },
    stats,
    sources: SOURCES,
    cards,
};

const json = `${JSON.stringify(data)}\n`;
const bytes = Buffer.from(json);
const provenance = {
    schema_version: '1.1.0',
    data_sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    gzip_bytes: gzipSync(bytes).length,
    cards: stats.cards,
    entry_refs: stats.entry_refs,
    plan_sha256: createHash('sha256').update(await readFile(new URL('research/sampling/all-words.json', root))).digest('hex'),
    plan_words_sha256: plan.words_sha256,
    vocab_data_sha256: createHash('sha256').update(vocabBytes).digest('hex'),
    generated_at: GENERATED_AT,
    reviewed_at: RETRIEVED_AT,
    lookup_found: stats.lookup_found,
    lookup_not_found: stats.lookup_not_found,
    pending_fields: stats.pending_fields,
    origin_present: stats.origin_present,
    queries: queries.length,
};

const target = new URL('src/data/knowledge-cards.json', root);
if (check) {
    const existing = await readFile(target, 'utf8');
    assert.equal(existing, json, '知识卡数据与重新构建结果不一致');
    console.log(JSON.stringify({ passed: true, checked: true, ...stats, bytes: bytes.length, gzip_bytes: provenance.gzip_bytes }, null, 4));
} else {
    await writeFile(target, json);
    await writeFile(new URL('src/data/knowledge-provenance.json', root), `${JSON.stringify(provenance, null, 4)}\n`);
    console.log(JSON.stringify({ passed: true, written: true, ...stats, bytes: bytes.length, gzip_bytes: provenance.gzip_bytes }, null, 4));
}
