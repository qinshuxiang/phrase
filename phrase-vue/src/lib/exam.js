/** 将字符串或数字转为 32 位无符号种子；同一输入始终得到同一种子。 */
export function hashSeed(value) {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** mulberry32 伪随机数生成器，返回 [0, 1) 浮点数。 */
export function mulberry32(seed) {
    let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher–Yates 洗牌，返回新数组，不修改入参。 */
export function shuffle(items, random = Math.random) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/** 按年份与题型筛选题库；空数组表示不限制该维度。 */
export function filterPool(pool, { years = [], types = [] } = {}) {
    const yearSet = new Set(years);
    const typeSet = new Set(types);
    return pool.filter(question =>
        (yearSet.size === 0 || yearSet.has(question.year))
        && (typeSet.size === 0 || typeSet.has(question.type)));
}

/**
 * 从题库随机抽题组卷。
 * @param {object[]} pool 已筛选的题目
 * @param {{ count?: number, seed?: string|number }} options
 * @returns {{ seed: number, questions: object[] }} 题量不足时返回全部可用题目
 */
export function drawPaper(pool, { count = 20, seed = Date.now() } = {}) {
    const numericSeed = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    const random = mulberry32(numericSeed);
    const picked = shuffle(pool, random).slice(0, Math.max(0, count));
    return { seed: numericSeed, questions: picked };
}

/** 单题是否答对：多选要求所选集合与答案完全一致。 */
export function isCorrect(question, chosen) {
    if (!chosen || !chosen.length) return false;
    const expected = [...question.answer].sort((a, b) => a - b);
    const actual = [...chosen].sort((a, b) => a - b);
    return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
}

/**
 * 判分。
 * @param {object[]} questions 试卷题目
 * @param {(number[]|null)[]} answers 与题目等长的作答，未答为 null 或空数组
 */
export function grade(questions, answers) {
    const byType = new Map();
    const wrong = [];
    let correct = 0;
    let answered = 0;

    questions.forEach((question, index) => {
        const chosen = answers[index] ?? null;
        if (chosen && chosen.length) answered++;
        const ok = isCorrect(question, chosen);
        if (ok) correct++;
        else wrong.push({ qid: question.qid, chosen: chosen && chosen.length ? [...chosen] : null });

        const stat = byType.get(question.type) ?? { type: question.type, total: 0, correct: 0 };
        stat.total++;
        if (ok) stat.correct++;
        byType.set(question.type, stat);
    });

    const total = questions.length;
    return {
        total,
        answered,
        correct,
        accuracy: total ? correct / total : 0,
        byType: [...byType.values()],
        wrong,
    };
}

/** 按正误生成下一次的错题本条目；答对则标记已订正。 */
export function updateWrongItems(items, questions, answers, now = new Date().toISOString()) {
    const map = new Map(items.map(item => [item.qid, { ...item }]));
    questions.forEach((question, index) => {
        const ok = isCorrect(question, answers[index]);
        const previous = map.get(question.qid);
        if (ok) {
            if (previous) {
                previous.correct_count = (previous.correct_count ?? 0) + 1;
                previous.last_at = now;
            }
            return;
        }
        map.set(question.qid, {
            qid: question.qid,
            year: question.year,
            paper: question.paper,
            type: question.type,
            stem: question.stem.slice(0, 400),
            answer: [...question.answer],
            last_choice: answers[index]?.length ? [...answers[index]] : null,
            wrong_count: (previous?.wrong_count ?? 0) + 1,
            correct_count: previous?.correct_count ?? 0,
            last_at: now,
        });
    });
    return [...map.values()].sort((a, b) => b.last_at.localeCompare(a.last_at));
}

/** 截断列表到指定上限，保留最新项；入参已按时间倒序。 */
export function trimList(items, limit) {
    return items.slice(0, Math.max(0, limit));
}
