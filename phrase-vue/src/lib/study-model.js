import { isCorrect } from './exam.js';

export const MODULES = ['政治理论', '常识判断', '言语理解与表达', '数量关系', '判断推理', '资料分析'];
/** 创建版本2学习档案。@returns {object} 全新的空档案，无外部I/O或失败分支，记录无自动裁剪。 */
export function emptyStudy() {
    return { version: 2, target: '山西', examType: '', active: null, records: [], wrong: {}, favorites: [], notes: {}, legacyHistory: [], migrated: false };
}
/** 对会话评分。@param {object} session 已校验会话 @param {object[]} questions 原序题目 @param {number} now 完成时间戳 @returns {object} 成绩；无可判分题时accuracy为null，输入由边界校验。 */
export function scoreSession(session, questions, now = Date.now()) {
    const outcomes = questions.map(q => {
        const choice = session.answers[q.id] ?? [];
        const answered = choice.length > 0;
        const gradable = q.provenance.status === 'verified' && q.answer.length > 0;
        return { id: q.id, module: q.module, category: q.category, answered, gradable,
            correct: gradable && answered && isCorrect(q, choice) };
    });
    const gradable = outcomes.filter(o => o.gradable).length;
    const correct = outcomes.filter(o => o.correct).length;
    return { ...session, finishedAt: now, duration: Math.max(0, (Math.min(now, session.deadline ?? now) - session.startedAt)), outcomes,
        total: outcomes.length, answered: outcomes.filter(o => o.answered).length, gradable, correct,
        accuracy: gradable ? correct / gradable : null };
}
/** 完成会话并更新错题。@param {object} state 档案 @param {object} session 会话 @param {object[]} questions 原序题目 @param {number} now 时间戳 @returns {object} 新档案；重复会话返回原值，无I/O。 */
export function completeStudy(state, session, questions, now = Date.now()) {
    if (state.records.some(r => r.id === session.id)) return state;
    const record = scoreSession(session, questions, now);
    const wrong = structuredClone(state.wrong);
    for (const outcome of record.outcomes) {
        if (!outcome.answered || !outcome.gradable) continue;
        const previous = wrong[outcome.id];
        if (!outcome.correct) wrong[outcome.id] = { ...previous, id: outcome.id, module: outcome.module,
            category: outcome.category, mastered: false, count: (previous?.count ?? 0) + 1, lastAt: now };
        else if (previous) wrong[outcome.id] = { ...previous, lastAt: now, correctCount: (previous.correctCount ?? 0) + 1 };
    }
    return { ...state, active: null, records: [record, ...state.records], wrong };
}
/** 汇总真实作答。@param {object} state 档案 @param {string} category 考试目标，空串为全部 @returns {object} 去重题数与模块统计；无有效作答时accuracy为null，旧成绩不参与。 */
export function studyStats(state, category = '') {
    const outcomes = state.records.flatMap(r => r.outcomes).filter(o => !category || o.category === category);
    const submitted = outcomes.filter(o => o.answered && o.gradable);
    return { studied: new Set(outcomes.filter(o => o.answered).map(o => o.id)).size,
        attempts: submitted.length, correct: submitted.filter(o => o.correct).length,
        accuracy: submitted.length ? submitted.filter(o => o.correct).length / submitted.length : null,
        duration: state.records.filter(r => !category || r.target === category).reduce((sum, r) => sum + r.duration, 0),
        modules: MODULES.map(module => {
            const list = outcomes.filter(o => o.module === module && o.answered);
            const graded = list.filter(o => o.gradable);
            return { module, studied: new Set(list.map(o => o.id)).size, attempts: graded.length,
                correct: graded.filter(o => o.correct).length };
        }) };
}
/** 校验备份结构。@param {unknown} value 外部档案 @returns {object} 校验通过的原对象 @throws {Error} 结构或数值无效；题库引用及选项上界由I/O边界继续校验。 */
export function validateStudy(value) {
    const assert = (ok, message) => { if (!ok) throw new Error(`学习记录无效：${message}`); };
    const object = v => v && typeof v === 'object' && !Array.isArray(v);
    assert(object(value) && value.version === 2, '版本必须为2');
    assert(['山西', '国考'].includes(value.target) && typeof value.examType === 'string', '备考目标');
    assert(Array.isArray(value.records) && Array.isArray(value.favorites) && Array.isArray(value.legacyHistory), '列表字段');
    assert(value.legacyHistory.every(r => object(r) && typeof r.id === 'string' && typeof r.at === 'string'
        && Number.isFinite(r.size) && Number.isFinite(r.accuracy)), '旧汇总成绩');
    assert(object(value.wrong) && object(value.notes) && typeof value.migrated === 'boolean', '档案字段');
    const validId = id => typeof id === 'string' && /^(?:[a-z0-9-]+:\d+|legacy:[a-zA-Z0-9]+)$/.test(id);
    const sessionIds = new Set();
    for (const s of [...value.records, ...(value.active ? [value.active] : [])]) {
        assert(object(s) && typeof s.id === 'string' && s.id && !sessionIds.has(s.id), '重复或缺失会话ID'); sessionIds.add(s.id);
        assert(typeof s.title === 'string' && ['山西', '国考'].includes(s.target), '会话标题与目标');
        assert(['practice', 'paper', 'review'].includes(s.mode) && Array.isArray(s.questionIds) && s.questionIds.length > 0 && s.questionIds.every(validId)
            && new Set(s.questionIds).size === s.questionIds.length, '会话题目');
        assert(object(s.answers) && object(s.submitted) && object(s.flags), '作答状态');
        assert(Number.isInteger(s.cursor) && s.cursor >= 0 && s.cursor < s.questionIds.length && Number.isFinite(s.startedAt), '阅读位置或时间');
        assert(s.deadline === null || Number.isFinite(s.deadline) && s.deadline > s.startedAt, '结束时间');
        for (const [id, answer] of Object.entries(s.answers)) assert(s.questionIds.includes(id) && Array.isArray(answer)
            && answer.length <= 1 && answer.every(n => Number.isInteger(n) && n >= 0 && n < 8), '作答选项');
        assert(Object.keys(s.submitted).every(id => s.questionIds.includes(id) && s.submitted[id] === true)
            && Object.keys(s.flags).every(id => s.questionIds.includes(id) && typeof s.flags[id] === 'boolean'), '题目状态引用');
        if (s !== value.active) assert(Array.isArray(s.outcomes) && Number.isFinite(s.finishedAt) && Number.isFinite(s.duration), '成绩字段');
    }
    assert(value.favorites.every(validId) && new Set(value.favorites).size === value.favorites.length, '收藏引用');
    for (const [id, note] of Object.entries(value.notes)) assert(validId(id) && typeof note === 'string' && note.length <= 100000, '笔记');
    for (const [id, wrong] of Object.entries(value.wrong)) assert(validId(id) && object(wrong) && wrong.id === id
        && typeof wrong.mastered === 'boolean' && Number.isInteger(wrong.count) && wrong.count > 0, '错题');
    return value;
}
