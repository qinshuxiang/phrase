import { beforeEach, describe, expect, it } from 'vitest';
import { drawPaper, filterPool, grade, hashSeed, isCorrect, mulberry32, shuffle, updateWrongItems } from './exam.js';
import { appendHistory, clearExamData, createRecord, readHistory, readWrongBook, saveWrongBook } from './exam-store.js';

const question = (id, year, type, answer = [0]) => ({
    qid: id, year, type, paper: `卷${year}`, stem: `题干 ${id}`, options: ['甲', '乙', '丙', '丁'], answer,
});

const pool = [
    question('q1', 2023, '逻辑填空'),
    question('q2', 2023, '片段阅读'),
    question('q3', 2024, '逻辑填空'),
    question('q4', 2024, '语句表达', [0, 2]),
];

describe('随机与组卷', () => {
    it('同一种子产生相同序列', () => {
        const a = Array.from({ length: 5 }, mulberry32('seed'));
        const b = Array.from({ length: 5 }, mulberry32('seed'));
        expect(a).toEqual(b);
        expect(hashSeed('seed')).toBe(hashSeed('seed'));
    });

    it('洗牌不修改原数组', () => {
        const source = [1, 2, 3, 4];
        const result = shuffle(source, mulberry32(1));
        expect(source).toEqual([1, 2, 3, 4]);
        expect([...result].sort()).toEqual([1, 2, 3, 4]);
    });

    it('同一种子组出同一套卷', () => {
        const first = drawPaper(pool, { count: 3, seed: 'exam' });
        const second = drawPaper(pool, { count: 3, seed: 'exam' });
        expect(first.questions.map(item => item.qid)).toEqual(second.questions.map(item => item.qid));
    });

    it('按年份与题型筛选', () => {
        expect(filterPool(pool, { years: [2024] }).map(item => item.qid)).toEqual(['q3', 'q4']);
        expect(filterPool(pool, { types: ['逻辑填空'] }).map(item => item.qid)).toEqual(['q1', 'q3']);
        expect(filterPool(pool)).toHaveLength(4);
    });

    it('题量超过题池时返回全部', () => {
        expect(drawPaper(pool, { count: 99 }).questions).toHaveLength(4);
    });
});

describe('判分', () => {
    it('多选需要集合完全一致', () => {
        expect(isCorrect(pool[3], [0, 2])).toBe(true);
        expect(isCorrect(pool[3], [2, 0])).toBe(true);
        expect(isCorrect(pool[3], [0])).toBe(false);
        expect(isCorrect(pool[3], [0, 1])).toBe(false);
    });

    it('统计未答与题型分布', () => {
        const result = grade(pool, [[0], null, [1], [0, 2]]);
        expect(result).toMatchObject({ total: 4, answered: 3, correct: 2, accuracy: 0.5 });
        expect(result.wrong.map(item => item.qid)).toEqual(['q2', 'q3']);
        expect(result.byType.find(item => item.type === '逻辑填空')).toMatchObject({ total: 2, correct: 1 });
    });

    it('空试卷不出现除零错误', () => {
        expect(grade([], []).accuracy).toBe(0);
    });
});

describe('错题本合并', () => {
    it('累加错误次数并记录最近选择', () => {
        const first = updateWrongItems([], pool, [null, null, [1], [0, 2]], '2026-01-01T00:00:00.000Z');
        expect(first.map(item => item.qid)).toEqual(['q1', 'q2', 'q3']);
        expect(first.find(item => item.qid === 'q3').wrong_count).toBe(1);

        const second = updateWrongItems(first, pool, [[0], null, [1], [0]], '2026-01-02T00:00:00.000Z');
        const q3 = second.find(item => item.qid === 'q3');
        expect(q3.wrong_count).toBe(2);
        expect(q3.last_at).toBe('2026-01-02T00:00:00.000Z');
    });
});

describe('成绩与错题持久化', () => {
    beforeEach(() => {
        clearExamData();
        localStorage.clear();
    });

    it('追加成绩并保留最新记录', () => {
        const record = createRecord({
            seed: 1, years: [2024], size: 4, duration: 120000,
            result: { answered: 4, correct: 3, accuracy: 0.75, wrong: [{ qid: 'q3' }] },
        });
        appendHistory(record);
        const history = readHistory();
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ correct: 3, accuracy: 0.75, wrong: ['q3'] });
    });

    it('损坏或版本不符时回退空结构', () => {
        localStorage.setItem('vocab-exam-history', '{oops');
        localStorage.setItem('vocab-exam-wrong', JSON.stringify({ version: 99, items: [{ qid: 'x' }] }));
        expect(readHistory()).toEqual([]);
        expect(readWrongBook()).toEqual([]);
    });

    it('错题本按上限截断', () => {
        const items = Array.from({ length: 620 }, (_, index) => ({ qid: `q${index}`, last_at: '2026-01-01' }));
        expect(saveWrongBook(items)).toHaveLength(500);
        expect(readWrongBook()).toHaveLength(500);
    });
});
