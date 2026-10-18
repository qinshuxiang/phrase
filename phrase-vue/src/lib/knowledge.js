import data from '@/data/knowledge-cards.json';
import { library } from '@/lib/library';

/**
 * 知识卡查询层：只读、无副作用的纯函数集合。
 *
 * 与 library.js 分离，避免改变现有搜索语义；卡片按词名索引，一个词名一张卡，
 * 词库中的重复记录通过 entry_refs 全部保留。
 */

export const knowledge = data;
export const knowledgeStats = data.stats;
export const knowledgeSources = data.sources;

const cardByWord = new Map();
const cardsByGroup = new Map();
const sourceById = new Map(data.sources.map(source => [source.id, source]));
for (const card of data.cards) {
    cardByWord.set(card.word, card);
    for (const ref of card.entry_refs) {
        const list = cardsByGroup.get(ref.group_id) ?? [];
        if (!list.includes(card)) list.push(card);
        cardsByGroup.set(ref.group_id, list);
    }
}

/** 词库中全部唯一词名数量，用于覆盖率分母。 */
const totalWords = new Set(library.groups.flatMap(group => group.entries.map(entry => entry.word))).size;

/** 按词名取卡；未整理的词返回 null。 */
export function cardForWord(word) {
    return cardByWord.get(String(word ?? '')) ?? null;
}

/** 从词库记录取卡，兼容同名词的多条记录。 */
export function cardForEntry(entry) {
    return entry ? cardForWord(entry.word) : null;
}

/** 该词名在词库中的全部记录引用；无卡时返回空数组。 */
export function entryRefsForWord(word) {
    return cardForWord(word)?.entry_refs ?? [];
}

/** 某个词组下已整理的卡片，按抽样顺序返回。 */
export function cardsForGroup(groupId) {
    return [...(cardsByGroup.get(groupId) ?? [])];
}

/**
 * 组内辨析对：只保留两端都在该组且已整理的易混关系，按词名排序去重。
 * 返回的 difference 与 provenance 来自首条命中的卡片，便于界面直接渲染。
 */
export function contrastPairsForGroup(groupId) {
    const cards = cardsForGroup(groupId);
    const byWord = new Map(cards.map(card => [card.word, card]));
    const seen = new Set();
    const pairs = [];
    for (const card of cards) {
        for (const item of card.confusables.items) {
            if (!byWord.has(item.word)) continue;
            const [a, b] = [card.word, item.word].sort();
            const key = `${a}\u0000${b}`;
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push({ a, b, difference: item.difference, basis: item.basis, provenance: item.provenance });
        }
    }
    return pairs;
}

/** 把 provenance 摊平成界面可直接展示的字段。 */
export function provenanceView(provenance) {
    if (!provenance) return null;
    return {
        kind: provenance.kind,
        status: provenance.status,
        sourceName: provenance.source_name ?? sourceById.get(provenance.source_id)?.name ?? null,
        sourceUrl: provenance.source_url ?? null,
        retrievedAt: provenance.retrieved_at ?? null,
        quote: provenance.quote ?? null,
        note: provenance.note ?? null,
        derived: provenance.kind === 'derived',
    };
}

/** 覆盖率：已整理词数 / 词库唯一词名总数，按批次统计。 */
export function knowledgeCoverage() {
    const byBatch = {};
    for (const card of data.cards) {
        byBatch[card.batch] = (byBatch[card.batch] ?? 0) + 1;
    }
    return { covered: cardByWord.size, total: totalWords, percent: Math.round(cardByWord.size / totalWords * 1000) / 10, byBatch };
}
