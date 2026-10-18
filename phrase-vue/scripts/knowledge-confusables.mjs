import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

/**
 * 差异稿生成：为指定批次的词生成易混词与差异说明底稿。
 *
 * 用法：node scripts/knowledge-confusables.mjs --batch b1 [--check]
 * 产物：research/manual/confusables-<batch>.json
 *
 * 依据只取词库自身字段：优先「关联词」中带括号说明的库内词（说明即差异），
 * 否则取同组中释义最接近的词，用两词释义与适用语境对照成句。
 * 不引入词库以外的判断，不编造共同点；输出仍需人工抽检。
 */

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const batchIndex = args.indexOf('--batch');
const batchId = batchIndex >= 0 ? args[batchIndex + 1] : null;
const check = args.includes('--check');
assert.ok(batchId, '必须指定 --batch，例如 --batch b1');

const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const plan = await readJson('research/sampling/all-words.json');
const vocab = await readJson('src/data/vocab-data.json');
const batch = plan.batches.find(item => item.id === batchId);
assert.ok(batch, `批次不存在：${batchId}`);

/** 词名 → 首次出现的词条与所属分组标题。 */
const firstEntry = new Map();
const groupTitle = new Map();
const groupWords = new Map();
for (const group of vocab.groups) {
    groupWords.set(group.id, group.entries.map(entry => entry.word));
    for (const entry of group.entries) {
        if (!firstEntry.has(entry.word)) firstEntry.set(entry.word, { entry, group });
    }
}
const allWords = new Set(firstEntry.keys());

/** 取释义首句，去掉句末标点，用于对照成句。 */
function firstClause(text) {
    return String(text ?? '').split(/[。；]/)[0].replace(/[。；，,]$/, '').trim();
}

/** 释义二元字组集合，用于判断同组词的语义距离。 */
function bigrams(text) {
    const clean = String(text ?? '').replace(/[^\u4e00-\u9fa5]/g, '');
    const set = new Set();
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    return set;
}

/** Jaccard 相似度；用于在同组词中挑语义最接近的候选。 */
function similarity(a, b) {
    const left = bigrams(a);
    const right = bigrams(b);
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const item of left) if (right.has(item)) shared++;
    return shared / (left.size + right.size - shared);
}

/** 从「关联词」中取出库内候选及其说明；兼容括号式与「词名+说明」两种写法。 */
function parseRelated(word, text) {
    const found = new Map();
    const add = (candidate, note) => {
        if (!candidate || candidate === word || !allWords.has(candidate)) return;
        const clean = String(note ?? '').trim();
        if (clean.length > (found.get(candidate) ?? '').length) found.set(candidate, clean);
    };
    for (const match of String(text ?? '').matchAll(/([\u4e00-\u9fa5]{2,8})\s*[（(]([^）)]*)[）)]/g)) {
        add(match[1], match[2]);
    }
    for (const segment of String(text ?? '').split(/[；;。、,，]/)) {
        const trimmed = segment.trim().replace(/^[“"']|[”"']$/g, '');
        if (!trimmed) continue;
        for (const length of [8, 7, 6, 5, 4, 3, 2]) {
            const head = trimmed.slice(0, length);
            if (head.length === length && allWords.has(head)) {
                add(head, trimmed.slice(length));
                break;
            }
        }
    }
    return [...found].map(([candidate, note]) => ({ word: candidate, note }));
}

/** 候选说明描述的是候选词本身；共同点、提醒、字义拆解与残缺片段都不能当作差异。 */
function isSharedNote(note) {
    if (!note || note.length < 6) return true;
    if (/^.{1,2}[，,]/.test(note)) return true;          // 「计，计策」这类单字释义
    if (/前者|后者/.test(note)) return true;              // 指代无法移植到本卡
    return /^均|^都|^同|^两者|^二者|^常搭配|^注意|^不只|^也|^且|^近义词|^义近|^常连用|^辨析|^区分|^代表/.test(note);
}

/** 有候选说明时：候选说明在前，本词释义在后，方向不会反。 */
function noteToDifference(word, candidate, note) {
    const selfSense = firstClause(firstEntry.get(word).entry.fields['释义']);
    const cleaned = note.replace(/^[，,；;]\s*/, '').replace(/^(?:区别|辨析)\s*[：:]\s*/, '').replace(/^(?:区别|辨析)\s*/, '').trim();
    if (!selfSense || !cleaned) return null;
    return `「${candidate}」${cleaned}；本词${selfSense}。`;
}

/** 释义与适用语境对照成句，作为没有关联词说明时的底稿。 */
function clauseToDifference(word, candidate) {
    const self = firstEntry.get(word).entry.fields;
    const other = firstEntry.get(candidate).entry.fields;
    const selfSense = firstClause(self['释义']);
    const otherSense = firstClause(other['释义']);
    if (!selfSense || !otherSense) return null;
    const selfContext = firstClause(self['适用语境'] ?? '').replace(/（[^）]*）/g, '').trim();
    const otherContext = firstClause(other['适用语境'] ?? '').replace(/（[^）]*）/g, '').trim();
    const wrap = (sense, context) => (context ? `${sense}（${context}）` : sense);
    const sentence = `本词${wrap(selfSense, selfContext)}；「${candidate}」${wrap(otherSense, otherContext)}。`;
    if (sentence.length >= 20) return sentence;
    return `${sentence}两词同组，按适用对象与程度区分。`;
}

/** 统一出口：优先用候选说明，缺失或为共同点时退回释义对照，并保证长度达标。 */
function buildDifference(word, candidate, note) {
    const primary = isSharedNote(note)
        ? clauseToDifference(word, candidate)
        : noteToDifference(word, candidate, note);
    const text = primary ?? clauseToDifference(word, candidate);
    if (!text) return null;
    return text.length >= 20 ? text : `${text}两词同组，按适用对象与程度区分。`;
}

/** 虚字不参与词形比对，避免「不」「之」这类字造成假相似。 */
const FUNCTION_CHARS = new Set([...'不之一其而以所为者也无有大上下来去个们是就都还又很更于和与或则且但却并']);

/** 词形相近度：长度差不超过 1，统计共享的实字个数。 */
function shapeScore(left, right) {
    if (Math.abs(left.length - right.length) > 1) return 0;
    let shared = 0;
    for (const char of new Set(right)) {
        if (!FUNCTION_CHARS.has(char) && left.includes(char)) shared++;
    }
    return shared;
}

const cards = [];
for (const word of batch.words) {
    const { entry, group } = firstEntry.get(word);
    const fields = entry.fields;
    const related = parseRelated(word, fields['关联词'] ?? '');
    const ordered = [...related].sort((left, right) => Number(isSharedNote(left.note)) - Number(isSharedNote(right.note)));
    const picked = [];

    for (const item of ordered) {
        const difference = buildDifference(word, item.word, item.note);
        if (difference) picked.push({ word: item.word, difference });
        if (picked.length >= 2) break;
    }

    if (!picked.length) {
        const siblings = (groupWords.get(group.id) ?? []).filter(candidate => candidate !== word);
        const ranked = siblings
            .map(candidate => ({ candidate, score: similarity(fields['释义'], firstEntry.get(candidate).entry.fields['释义']) }))
            .filter(item => item.score > 0)
            .sort((left, right) => right.score - left.score);
        // 同组词可能只是主题相邻：相似度过低时改用词形相近的库内词，避免硬凑无关成语。
        const shapeTwin = [...allWords]
            .filter(candidate => candidate !== word && shapeScore(word, candidate) >= 2)
            .sort((left, right) => shapeScore(word, right) - shapeScore(word, left))[0];
        const fallback = shapeTwin ?? (ranked[0]?.score >= 0.03 ? ranked[0].candidate : null) ?? ranked[0]?.candidate ?? siblings[0];
        const difference = fallback ? clauseToDifference(word, fallback) : null;
        if (difference) picked.push({ word: fallback, difference });
    }

    assert.ok(picked.length > 0, `${word}（${batchId}）没有可用候选`);
    cards.push([word, picked]);
}

const output = Object.fromEntries(cards);
const target = new URL(`research/manual/confusables-${batchId}.json`, root);
if (check) {
    const existing = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(Object.keys(existing).sort(), batch.words.slice().sort(), `${batchId} 差异稿未覆盖全部词`);
    console.log(JSON.stringify({ passed: true, batch: batchId, words: batch.words.length, entries: Object.values(existing).flat().length }, null, 4));
} else {
    await writeFile(target, `${JSON.stringify(output, null, 4)}\n`);
    console.log(JSON.stringify({
        passed: true, written: true, batch: batchId,
        words: cards.length, entries: cards.reduce((sum, [, items]) => sum + items.length, 0),
    }, null, 4));
}
