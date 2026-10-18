import { reactive, toRaw } from 'vue';
import { emptyStudy, completeStudy, validateStudy, scoreSession } from './study-model.js';
import { readStudy, writeStudy } from './study-storage.js';
import { resolveQuestions } from './study-data.js';

// 单应用共享状态；持久化只在本模块边界进行，会话提交按id去重。
export const study = reactive({ data: emptyStudy(), ready: false, storageWarning: '', error: '', questions: [], lastRecord: null, busy: false });
const copy = value => JSON.parse(JSON.stringify(toRaw(value)));
let queue = Promise.resolve();
let initialization;
let finishing;
let readFailed = false;

/** 顺序保存当前快照。@returns {Promise<void>} I/O失败转为可见提示，保留内存供导出；不删除旧存储。 */
export function persist() {
    if (readFailed) return Promise.resolve();
    const snapshot = copy(study.data);
    queue = queue.then(() => writeStudy(snapshot)).catch(error => {
        study.storageWarning = `本地保存失败：${error.message}。本次记录仍可使用，请及时导出备份。`;
    });
    return queue;
}
/** 一次性迁移旧成绩和错题；不改写原键，提交新档案后迁移标记才持久化。 */
function migrate(data) {
    if (data.migrated) return;
    try {
        const history = JSON.parse(localStorage.getItem('vocab-exam-history') ?? 'null');
        const wrong = JSON.parse(localStorage.getItem('vocab-exam-wrong') ?? 'null');
        if (history?.version === 1 && Array.isArray(history.records)) data.legacyHistory = history.records;
        if (wrong?.version === 1 && Array.isArray(wrong.items)) for (const item of wrong.items) {
            if (!item.qid) continue;
            const id = `legacy:${item.qid}`;
            data.wrong[id] = { id, module: '言语理解与表达', category: '言语扩展', mastered: (item.correct_count ?? 0) >= (item.wrong_count ?? 1),
                count: Math.max(1, item.wrong_count ?? 1), correctCount: item.correct_count ?? 0, lastAt: Date.parse(item.last_at) || Date.now() };
        }
        data.migrated = true;
    } catch {
        study.storageWarning = '旧记录读取失败或浏览器限制存储；原记录仍保留，可恢复访问后重试迁移。';
    }
}
/** 初始化档案并迁移旧记录。@returns {Promise<void>} 读取失败转临时内存与提示，不覆盖不可读原档案。 */
export function initStudy() {
    return initialization ??= (async () => {
        let readable = true;
        try { const saved = await readStudy(); if (saved) study.data = validateStudy(saved); }
        catch (error) { readable = false; readFailed = true; study.storageWarning = `本地档案不可读取：${error.message}。当前使用临时记录，请导出备份。`; }
        migrate(study.data);
        if (readable) await persist();
        study.ready = true;
    })();
}
/** 新建会话。@param {object[]} questions 有序题目 @param {object} options 模式、标题、训练分钟数 @returns {Promise<void>} 更新内存并保存；空题集抛错，I/O失败显示提示。已有草稿由界面处理。 */
export async function startStudy(questions, { mode = 'practice', title = '专项练习', minutes = 120 } = {}) {
    if (!questions.length) throw new Error('所选范围没有题目');
    const now = Date.now();
    study.data.active = { id: `s-${now}-${crypto.randomUUID()}`, mode, title, target: study.data.target,
        questionIds: questions.map(q => q.id), answers: {}, submitted: {}, flags: {}, cursor: 0,
        startedAt: now, deadline: mode === 'paper' ? now + minutes * 60000 : null };
    study.questions = questions; study.lastRecord = null;
    await persist();
}
/** 恢复当前会话题目，过期则交卷。@returns {Promise<void>} 无草稿时直接完成；引用或I/O失败拒绝并保留草稿。 */
export async function resumeStudy() {
    if (!study.data.active) return;
    study.questions = await resolveQuestions([...study.data.active.questionIds]);
    if (study.data.active.deadline && Date.now() >= study.data.active.deadline) await finishStudy();
}
/** 幂等交卷，包含未答题。@returns {Promise<object|undefined>} 成绩；题目恢复失败拒绝，保存失败显示提示。计分、错题和草稿同一事务保存。 */
export async function finishStudy() {
    if (finishing) return finishing;
    if (!study.data.active) return study.lastRecord;
    finishing = (async () => {
        const session = copy(study.data.active);
        const questions = study.questions.length && study.questions.every((q, i) => q.id === session.questionIds[i])
            && study.questions.length === session.questionIds.length ? study.questions : await resolveQuestions(session.questionIds);
        study.data = completeStudy(copy(study.data), session, questions);
        study.lastRecord = study.data.records.find(r => r.id === session.id);
        study.questions = questions;
        await persist();
        return study.lastRecord;
    })().finally(() => { finishing = null; });
    return finishing;
}
/** 选择单选答案。@param {string} id 当前题ID @param {number} option 选项下标 @returns {Promise<void>} 无草稿或已锁定则无操作，过期先交卷；保存失败显示提示。 */
export async function chooseAnswer(id, option) {
    const session = study.data.active;
    if (session?.deadline && Date.now() >= session.deadline) { await finishStudy(); return; }
    if (!session || session.mode !== 'paper' && session.submitted[id]) return;
    session.answers[id] = [option]; await persist();
}
/** 提交单题反馈。@param {string} id 当前题ID @returns {Promise<void>} 未选选项或无会话时无操作；保存失败显示提示。 */
export async function submitAnswer(id) {
    const session = study.data.active;
    if (session?.answers[id]?.length) { session.submitted[id] = true; await persist(); }
}
/** 获取完整备份，包含草稿。@returns {Promise<object>} 可JSON序列化的备份；等待保存队列，存储降级时也可导出内存。 */
export async function exportStudy() { await queue; return { format: 'xingce-study-backup', exportedAt: new Date().toISOString(), data: copy(study.data) }; }
/** 校验并恢复备份。@param {unknown} backup 外部JSON @returns {Promise<void>} 原子替换成功后完成 @throws {Error} 格式、引用、选项或I/O失败；失败不更改内存与原档案。 */
export async function restoreStudy(backup) {
    if (backup?.format !== 'xingce-study-backup') throw new Error('不是行测学习备份文件');
    const candidate = validateStudy(copy(backup.data));
    const ids = [...new Set([...candidate.favorites, ...Object.keys(candidate.notes), ...Object.keys(candidate.wrong),
        ...candidate.records.flatMap(r => r.questionIds), ...(candidate.active?.questionIds ?? [])])];
    const questions = await resolveQuestions(ids);
    const byId = new Map(questions.map(q => [q.id, q]));
    for (const session of [...candidate.records, ...(candidate.active ? [candidate.active] : [])]) {
        for (const [id, answer] of Object.entries(session.answers)) if (answer.some(i => i >= byId.get(id).options.length)) throw new Error(`选项越界：${id}`);
        if (session !== candidate.active) Object.assign(session, scoreSession(session, session.questionIds.map(id => byId.get(id)), session.finishedAt));
    }
    for (const [id, wrong] of Object.entries(candidate.wrong)) {
        const question = byId.get(id);
        wrong.module = question.module;
        wrong.category = id.startsWith('legacy:') ? '言语扩展' : question.category;
    }
    await queue;
    await writeStudy(candidate);
    readFailed = false;
    study.data = candidate; study.questions = []; study.lastRecord = null; study.storageWarning = '';
}
