import { trimList } from './exam.js';

const HISTORY_KEY = 'vocab-exam-history';
const WRONG_KEY = 'vocab-exam-wrong';
const HISTORY_LIMIT = 50;
const WRONG_LIMIT = 500;
const SIZE_LIMIT = 1_200_000;
const VERSION = 1;

const memory = new Map();
let degraded = false;

function readRaw(key) {
    if (!degraded) {
        try {
            return localStorage.getItem(key);
        } catch {
            degraded = true;
        }
    }
    return memory.get(key) ?? null;
}

function writeRaw(key, value) {
    if (!degraded) {
        try {
            localStorage.setItem(key, value);
            return;
        } catch {
            degraded = true;
        }
    }
    memory.set(key, value);
}

function readObject(key, fallback) {
    const raw = readRaw(key);
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.version !== VERSION) return fallback;
        return parsed;
    } catch {
        return fallback;
    }
}

/** 读取成绩历史；损坏或版本不符时返回空结构。 */
export function readHistory() {
    const data = readObject(HISTORY_KEY, { version: VERSION, records: [] });
    return Array.isArray(data.records) ? data.records : [];
}

/** 追加一条成绩，超过 50 条丢弃最旧记录。 */
export function appendHistory(record) {
    const records = trimList([record, ...readHistory()], HISTORY_LIMIT);
    writeRaw(HISTORY_KEY, JSON.stringify({ version: VERSION, records }));
    return records;
}

/** 读取错题本条目，按最近作答时间倒序。 */
export function readWrongBook() {
    const data = readObject(WRONG_KEY, { version: VERSION, items: [] });
    return Array.isArray(data.items) ? data.items : [];
}

/**
 * 保存错题本。总量超过 1.2 MB 时先裁历史，再裁错题，避免写入失败。
 */
export function saveWrongBook(items) {
    let next = trimList(items, WRONG_LIMIT);
    let payload = JSON.stringify({ version: VERSION, items: next });
    if (payload.length > SIZE_LIMIT) {
        const records = trimList(readHistory(), 20);
        writeRaw(HISTORY_KEY, JSON.stringify({ version: VERSION, records }));
        payload = JSON.stringify({ version: VERSION, items: next });
    }
    if (payload.length > SIZE_LIMIT) {
        next = trimList(next, 200);
        payload = JSON.stringify({ version: VERSION, items: next });
    }
    writeRaw(WRONG_KEY, payload);
    return next;
}

/** 清空成绩与错题本。 */
export function clearExamData() {
    for (const key of [HISTORY_KEY, WRONG_KEY]) {
        try {
            localStorage.removeItem(key);
        } catch {
            degraded = true;
        }
        memory.delete(key);
    }
}

/** 生成一条成绩记录；id 含时间戳与随机后缀，避免同毫秒重复。 */
export function createRecord({ seed, years, size, result, duration }) {
    return {
        id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        at: new Date().toISOString(),
        seed,
        years,
        size,
        answered: result.answered,
        correct: result.correct,
        accuracy: Number(result.accuracy.toFixed(4)),
        duration_ms: Math.round(duration),
        wrong: result.wrong.map(item => item.qid),
    };
}

export const examLimits = { history: HISTORY_LIMIT, wrong: WRONG_LIMIT };
