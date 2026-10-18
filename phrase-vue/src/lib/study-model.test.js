import { describe, expect, test } from 'vitest';
import { emptyStudy, scoreSession, completeStudy, studyStats, validateStudy } from './study-model';
const question = (id, status = 'verified') => ({ id, category: '山西', module: '数量关系', provenance: { status }, options: ['A', 'B'], answer: status === 'missing' ? [] : [1] });
const session = (answers = {}) => ({ id: 'test', mode: 'practice', title: '测试', target: '山西', questionIds: ['sx-2026:1', 'sx-2026:2', 'sx-2026:3'], answers, submitted: {}, flags: {}, cursor: 0, startedAt: 1000, deadline: null });
const questions = [question('sx-2026:1'), question('sx-2026:2', 'pending'), question('sx-2026:3', 'missing')];
describe('学习会话边界', () => {
    test('待核验和缺答案不判分，未答独立计数', () => {
        const result = scoreSession(session({ 'sx-2026:2': [0] }), questions, 5000);
        expect(result).toMatchObject({ total: 3, answered: 1, gradable: 1, correct: 0, accuracy: 0, duration: 4000 });
        expect(completeStudy(emptyStudy(), session(), questions).wrong).toEqual({});
    });
    test('没有可判分题时正确率为null', () => expect(scoreSession({ ...session(), questionIds: ['sx-2026:2'] }, [questions[1]]).accuracy).toBeNull());
    test('仅真正答错的已核验题入错题', () => {
        const state = completeStudy(emptyStudy(), session({ 'sx-2026:1': [0], 'sx-2026:2': [0] }), questions, 5000);
        expect(Object.keys(state.wrong)).toEqual(['sx-2026:1']); expect(state.active).toBeNull();
    });
    test('掌握后再次答错重新打开，答对不自动移除', () => {
        const state = emptyStudy(); state.wrong['sx-2026:1'] = { id: 'sx-2026:1', mastered: true, count: 2 };
        expect(completeStudy(state, session({ 'sx-2026:1': [0] }), questions).wrong['sx-2026:1']).toMatchObject({ mastered: false, count: 3 });
        expect(completeStudy(state, session({ 'sx-2026:1': [1] }), questions).wrong['sx-2026:1']).toMatchObject({ mastered: true, count: 2, correctCount: 1 });
    });
    test('重复交卷幂等，重复练习题数去重', () => {
        const s = session({ 'sx-2026:1': [1] }); const first = completeStudy(emptyStudy(), s, questions, 5000);
        expect(completeStudy(first, s, questions)).toBe(first);
        const second = completeStudy(first, { ...s, id: 'second' }, questions, 6000);
        expect(studyStats(second, '山西')).toMatchObject({ studied: 1, attempts: 2, correct: 2, accuracy: 1 });
    });
    test('超时恢复按原截止时刻计时', () => expect(scoreSession({ ...session(), deadline: 4000 }, questions, 10000).duration).toBe(3000));
    test('不同卷相同外部qid不会合并', () => {
        const qs = [question('sx-2026:1'), question('gk-2026:1')];
        const state = completeStudy(emptyStudy(), { ...session({ 'sx-2026:1': [0], 'gk-2026:1': [0] }), questionIds: qs.map(q => q.id) }, qs);
        expect(Object.keys(state.wrong)).toHaveLength(2);
    });
});
describe('备份结构校验', () => {
    test('空档案和完整草稿通过', () => { expect(validateStudy(emptyStudy())).toEqual(emptyStudy()); expect(validateStudy({ ...emptyStudy(), active: session() }).active.id).toBe('test'); });
    for (const [name, change] of [
        ['未知版本', s => s.version = 99], ['非法引用', s => s.favorites = ['../bad']],
        ['重复收藏', s => s.favorites = ['sx-2026:1', 'sx-2026:1']], ['非文本笔记', s => s.notes['sx-2026:1'] = {}],
        ['重复会话题目', s => s.active.questionIds.push('sx-2026:1')], ['错题没有计数', s => s.wrong['sx-2026:1'] = { id: 'sx-2026:1', mastered: false }],
        ['负数选项', s => s.active.answers['sx-2026:1'] = [-1]], ['越界游标', s => s.active.cursor = 10],
        ['错误结束时间', s => s.active.deadline = 0], ['作答引用不属于试卷', s => s.active.answers['gk-2026:1'] = [0]],
    ]) test(`拒绝${name}`, () => { const state = { ...emptyStudy(), active: session() }; change(state); expect(() => validateStudy(state)).toThrow(); });
});
