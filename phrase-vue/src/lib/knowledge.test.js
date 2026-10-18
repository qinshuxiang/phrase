import { describe, it, expect } from 'vitest';
import { library, searchGroups } from './library';
import {
    knowledge, knowledgeStats, cardForWord, cardForEntry, entryRefsForWord,
    cardsForGroup, contrastPairsForGroup, provenanceView, knowledgeCoverage,
} from './knowledge';
import provenance from '@/data/knowledge-provenance.json';

describe('知识卡覆盖率与引用', () => {
    it('全量 859 词覆盖 899 条记录与 108 个分组', () => {
        expect(knowledge.cards).toHaveLength(859);
        expect(new Set(knowledge.cards.map(card => card.word)).size).toBe(859);
        expect(knowledgeStats.entry_refs).toBe(899);
        expect(knowledgeStats.groups_covered).toBe(108);
        expect(knowledgeStats.pending_fields).toBe(0);
    });
    it('词名查询命中，未整理词返回 null', () => {
        expect(cardForWord('雨后春笋')?.word).toBe('雨后春笋');
        expect(cardForWord('不存在的词条')).toBe(null);
        expect(cardForWord()).toBe(null);
    });
    it('同名词的多条记录全部保留在 entry_refs', () => {
        const card = cardForWord('愈演愈烈');
        expect(card.entry_refs.length).toBeGreaterThan(1);
        const actual = card.entry_refs.map(ref => `${ref.group_id}:${ref.file_id}`).sort();
        const expected = library.groups.flatMap(group => group.entries
            .filter(entry => entry.word === '愈演愈烈')
            .map(entry => `${group.id}:${entry.fileId}`)).sort();
        expect(actual).toEqual(expected);
        expect(entryRefsForWord('愈演愈烈')).toEqual(card.entry_refs);
    });
    it('从词库记录可以直接取到同一张卡', () => {
        const entry = library.groups[0].entries.find(item => item.word === '雨后春笋');
        expect(cardForEntry(entry)?.id).toBe(cardForWord('雨后春笋').id);
        expect(cardForEntry(null)).toBe(null);
    });
});

describe('事实与状态语义', () => {
    it('汉典无词条的卡不伪造 quote，并说明缺失原因', () => {
        const card = cardForWord('既往开来');
        expect(card.lookup.status).toBe('not_found');
        expect(card.readings.items).toHaveLength(0);
        expect(card.readings.provenance.status).toBe('missing');
        expect(card.readings.provenance.quote).toBe(null);
        expect(card.readings.provenance.note).toContain('404');
    });
    it('异形词成对记录规范词形与来源', () => {
        const card = cardForWord('雕梁画柱');
        expect(card.lexical_status).toBe('variant');
        expect(card.variant_of).toBe('雕梁画栋');
        expect(card.variant_provenance.source_url).toContain('dict.idioms.moe.edu.tw');
        expect(card.variant_provenance.quote).toContain('雕梁畫柱');
    });
    it('整理内容带 derived 前缀，缺失内容带原因', () => {
        for (const card of knowledge.cards) {
            expect(card.confusables.provenance.note.startsWith('整理（derived）')).toBe(true);
            if (card.origin.provenance.status === 'missing') {
                expect(card.origin.provenance.note.length).toBeGreaterThan(6);
            }
            for (const field of [card.readings, card.senses, card.citations, card.synonyms, card.antonyms]) {
                if (field.provenance.status === 'missing') expect(field.provenance.note).toBeTruthy();
            }
        }
    });
    it('每卡只有一个主读音，义项只引用存在的读音', () => {
        for (const card of knowledge.cards) {
            if (!card.readings.items.length) continue;
            expect(card.readings.items.filter(item => item.is_primary)).toHaveLength(1);
            const ids = new Set(card.readings.items.map(item => item.id));
            for (const sense of card.senses.items) {
                for (const id of sense.reading_ids) expect(ids.has(id)).toBe(true);
            }
        }
    });
    it('冲突清单与字段一致', () => {
        for (const card of knowledge.cards) {
            expect(Array.isArray(card.conflicts)).toBe(true);
            for (const conflict of card.conflicts) expect(conflict.values.length).toBeGreaterThanOrEqual(2);
        }
    });
});

describe('辨析查询', () => {
    it('组内卡片只包含该组记录，顺序与全量词序一致', () => {
        const cards = cardsForGroup('g6');
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.every(card => card.entry_refs.some(ref => ref.group_id === 'g6'))).toBe(true);
        const expected = knowledge.cards.filter(card => card.entry_refs.some(ref => ref.group_id === 'g6')).map(card => card.word);
        expect(cards.map(card => card.word)).toEqual(expected);
        expect(cardsForGroup('missing-group')).toEqual([]);
    });
    it('组内辨析对无自环、无重复，两端均在同组', () => {
        const cards = cardsForGroup('g9');
        const words = new Set(cards.map(card => card.word));
        for (const pair of contrastPairsForGroup('g9')) {
            expect(pair.a).not.toBe(pair.b);
            expect(words.has(pair.a)).toBe(true);
            expect(words.has(pair.b)).toBe(true);
            expect(pair.difference.length).toBeGreaterThanOrEqual(20);
        }
        const keys = contrastPairsForGroup('g9').map(pair => `${pair.a}|${pair.b}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(contrastPairsForGroup('missing-group')).toEqual([]);
    });
    it('provenanceView 提供界面需要的来源字段', () => {
        const view = provenanceView(cardForWord('雨后春笋').readings.provenance);
        expect(view).toMatchObject({ kind: 'quote', status: 'verified', sourceName: '汉典', derived: false });
        expect(view.sourceUrl).toContain('zdic.net');
        expect(provenanceView(null)).toBe(null);
    });
    it('覆盖率按词库唯一词名计算', () => {
        const coverage = knowledgeCoverage();
        const total = new Set(library.groups.flatMap(group => group.entries.map(entry => entry.word))).size;
        expect(coverage.covered).toBe(859);
        expect(coverage.total).toBe(total);
        expect(coverage.byBatch).toEqual({ 'pilot-100': 100, b1: 95, b2: 95, b3: 95, b4: 95, b5: 95, b6: 95, b7: 95, b8: 94 });
        expect(coverage.percent).toBe(Math.round(coverage.covered / total * 1000) / 10);
    });
});

describe('与现有搜索语义隔离', () => {
    it('知识卡不改变全文搜索命中数', () => {
        expect(searchGroups(' 顾此失彼 ').flatMap(group => group.entries)).toHaveLength(5);
    });
    it('数据文件哈希记录与卡片统计一致', () => {
        expect(provenance.data_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(provenance.bytes).toBeGreaterThan(0);
        expect(provenance.cards).toBe(knowledge.cards.length);
        expect(provenance.entry_refs).toBe(knowledgeStats.entry_refs);
        expect(provenance.plan_words_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(knowledge.plan.words_sha256).toMatch(/^[0-9a-f]{64}$/);
    });
});
