import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

/**
 * 把「高频实词」讲义词条并入成语校订底稿。
 * 输入：视频/成语校订/实词-实词N.json（group/word/六字段，按讲义组号分组的实词）。
 * 输出：改写 成语校订.json 的 groups 与各来源 words 计数，并为每条生成逐字稿行号与片段作为依据。
 * 失败情形：词在指定行范围内找不到、字段缺失、组 ID 重复时抛错，不写入文件。
 */
const phrase = new URL('../../', import.meta.url);
const draftUrl = new URL('视频/成语校订/成语校订.json', phrase);
const draft = JSON.parse(await readFile(draftUrl, 'utf8'));
const fields = ['释义', '日常用法', '记忆技巧', '适用语境', '例句', '关联词'];
const files = (await readdir(new URL('视频/成语校订/', phrase))).filter(name => /^实词-实词\d+\.json$/.test(name)).sort();

const transcripts = new Map();
for (const source of draft.sources) {
    transcripts.set(source.id, (await readFile(new URL(source.transcript, phrase), 'utf8')).split(/\r?\n/));
}

function locate(word, range, lines, sourceId) {
    for (let line = range[0]; line <= range[1]; line += 1) {
        const text = lines[line - 1] ?? '';
        const index = text.indexOf(word);
        if (index < 0) continue;
        const start = Math.max(0, index - 30);
        return { transcript_line: line, transcript_excerpt: text.slice(start, index + word.length + 30) };
    }
    throw new Error(`${sourceId} 的「${word}」在 ${range[0]}–${range[1]} 行内找不到逐字稿依据`);
}

for (const name of files) {
    const input = JSON.parse(await readFile(new URL(`视频/成语校订/${name}`, phrase), 'utf8'));
    const source = draft.sources.find(item => item.id === input.source);
    if (!source) throw new Error(`${name} 的来源 ${input.source} 不在校订底稿中`);
    const lines = transcripts.get(source.id);
    for (const group of input.groups) {
        if (draft.groups.some(item => item.id === group.id)) continue;
        const range = input.lineRanges[group.id];
        if (!range) throw new Error(`${group.id} 缺少逐字稿行号范围`);
        const entries = group.words.map(({ word, fields: content }) => {
            const keys = Object.keys(content);
            if (keys.length !== fields.length || !fields.every(field => keys.includes(field))) {
                throw new Error(`${group.id} 的「${word}」字段不完整`);
            }
            if (!content['例句'].startsWith('【自拟例句】')) throw new Error(`${word} 例句需自拟标注`);
            return { word, fields: Object.fromEntries(fields.map(field => [field, content[field]])), evidence: locate(word, range, lines, source.id) };
        });
        draft.groups.push({ id: group.id, title: group.title, source_id: source.id, category: group.category, entries });
    }
}

for (const source of draft.sources) {
    source.words = draft.groups.filter(group => group.source_id === source.id).reduce((sum, group) => sum + group.entries.length, 0);
}
draft.revision = new Date().toISOString().slice(0, 10);
const bytes = Buffer.from(`${JSON.stringify(draft, null, 2)}\n`);
await writeFile(draftUrl, bytes);
console.log(JSON.stringify({
    groups: draft.groups.length,
    entries: draft.groups.reduce((sum, group) => sum + group.entries.length, 0),
    sources: draft.sources.map(source => `${source.id}:${source.words}`),
    sha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 4));
