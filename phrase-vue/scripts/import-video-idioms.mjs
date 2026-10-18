import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const phrase = new URL('../', root);
const inputUrl = new URL('视频/成语校订/成语校订.json', phrase);
const dataUrl = new URL('src/data/vocab-data.json', root);
const provenanceUrl = new URL('src/data/provenance.json', root);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 4)}\n`;
const inputBytes = await readFile(inputUrl);
const input = JSON.parse(inputBytes);
const checkOnly = process.argv.includes('--check');
const previous = JSON.parse(await readFile(dataUrl));
const provenance = JSON.parse(await readFile(provenanceUrl));
const fields = ['释义', '日常用法', '记忆技巧', '适用语境', '例句', '关联词'];
const isVideo = item => item.id.startsWith('video-');
const original = provenance.original_content ?? {
    generated_at: previous.generated_at, stats: previous.stats,
    file_ids: previous.files.map(file => file.id), group_ids: previous.groups.map(group => group.id),
    sha256: provenance.retained_content_sha256,
};
const retained = {
    generated_at: original.generated_at, stats: original.stats,
    files: previous.files.filter(file => !isVideo(file)),
    groups: previous.groups.filter(group => !isVideo(group)),
};
assert.equal(hash(JSON.stringify(retained)), original.sha256, '导入前原有内容必须与基准一致');
assert.deepEqual(retained.files.map(file => file.id), original.file_ids);
assert.deepEqual(retained.groups.map(group => group.id), original.group_ids);
assert.equal(new Set(input.sources.map(source => source.id)).size, input.sources.length);
assert.equal(new Set(input.groups.map(group => group.id)).size, input.groups.length);
const sourceIds = new Set(input.sources.map(source => source.id));

// 在写入前核对全部本地依据；课件秒数是抽样定位，不是精确发言时间。
for (const source of input.sources) {
    assert.ok(isVideo(source));
    assert.ok(source.label.includes(`-${source.teacher}`), `${source.id} 老师与课程名须对应`);
    const transcript = await readFile(new URL(source.transcript, phrase));
    const slides = await readFile(new URL(source.slides, phrase));
    assert.equal(hash(transcript), source.transcript_sha256, `${source.id} 逐字稿发生变化`);
    assert.equal(hash(slides), source.slides_sha256, `${source.id} 课件识别发生变化`);
    const lines = transcript.toString().split(/\r?\n/);
    const samples = slides.toString().trim().split(/\r?\n/).map(line => JSON.parse(line));
    const entries = input.groups.filter(group => group.source_id === source.id).flatMap(group => group.entries);
    assert.equal(entries.length, source.words);
    assert.ok(entries.length > 0);
    assert.equal(new Set(entries.map(entry => entry.word)).size, entries.length, `${source.id} 同一课程不重复建词`);
    for (const entry of entries) {
        assert.ok(entry.word.trim());
        assert.deepEqual(Object.keys(entry.fields), fields);
        assert.ok(Object.values(entry.fields).every(value => typeof value === 'string' && value.trim()));
        assert.ok(entry.fields['例句'].startsWith('【自拟例句】'));
        const evidence = entry.evidence;
        assert.ok(evidence.transcript_line || evidence.slide_samples?.length, `${entry.word} 必须有本地依据`);
        if (evidence.transcript_line) {
            const line = lines[evidence.transcript_line - 1] ?? '';
            assert.ok(line.includes(entry.word) && line.includes(evidence.transcript_excerpt), `${entry.word} 逐字稿依据失配`);
        }
        for (const sample of evidence.slide_samples ?? []) {
            assert.ok(samples.some(row => row.image.endsWith(`/${String(sample.seconds).padStart(5, '0')}.jpg`)
                && row.lines.includes(sample.text) && sample.text.includes(entry.word)), `${entry.word} 课件依据失配`);
        }
    }
}
for (const group of input.groups) {
    assert.ok(isVideo(group) && sourceIds.has(group.source_id));
    assert.ok(['core', 'supplement'].includes(group.category));
    assert.ok(group.entries.length > 0);
}
const files = [...retained.files, ...input.sources.map(({ id, label, date, teacher, words }) => ({ id, label, date, teacher, words }))];
const groups = [...retained.groups, ...input.groups.map(group => ({
    id: group.id, title: group.title,
    entries: group.entries.map(({ word, fields }) => ({ word, fields, fileId: group.source_id })),
}))];
const data = {
    generated_at: `${input.revision}T00:00:00+08:00`,
    stats: { files: files.length, groups: groups.length, words: groups.reduce((sum, group) => sum + group.entries.length, 0),
        teachers: new Set(files.map(file => file.teacher)).size }, files, groups,
};
// 沿用原项目的紧凑序列化，且重复导入必须得到相同字节。
const bytes = Buffer.from(JSON.stringify(data));
const nextProvenance = {
    ...provenance, data_sha256: hash(bytes), bytes: bytes.length,
    retained_content_sha256: hash(JSON.stringify(data)), original_content: original,
    video_import: { revision: input.revision, input: '../视频/成语校订/成语校订.json', input_sha256: hash(inputBytes),
        sources: input.sources.length, groups: input.groups.length,
        core_records: input.groups.filter(group => group.category === 'core').reduce((n, group) => n + group.entries.length, 0),
        supplement_records: input.groups.filter(group => group.category === 'supplement').reduce((n, group) => n + group.entries.length, 0) },
};
const md = ['# 视频课程成语校订稿', '', `校订日期：${input.revision}（Asia/Shanghai）。`, '', input.scope, '', input.editorial_policy, '',
    '本稿按讲授内容整理，不代表已逐句回听约20小时视频。正文保留原始逐字稿，校订稿单独交付。每条有原稿行号或课件抽样依据；课件时间是取样位置，不是发言起点。', '',
    '| 课程 | 词条记录 |', '| --- | ---: |', ...input.sources.map(source => `| ${source.label} | ${source.words} |`), ''];
for (const source of input.sources) {
    md.push(`## ${source.label}`, '', `日期：${source.date}；老师：${source.teacher}；${source.words} 条。`, '');
    for (const group of input.groups.filter(group => group.source_id === source.id)) {
        md.push(`### ${group.title}`, '');
        for (const entry of group.entries) {
            md.push(`#### ${entry.word}`, '', ...fields.map(field => `- **${field}**：${entry.fields[field]}`));
            const evidence = entry.evidence;
            const locators = [];
            if (evidence.transcript_line) locators.push(`润色逐字稿第 ${evidence.transcript_line} 行`);
            for (const sample of evidence.slide_samples ?? []) {
                const h = Math.floor(sample.seconds / 3600), m = Math.floor(sample.seconds % 3600 / 60), s = sample.seconds % 60;
                locators.push(`课件抽样 ${[h, m, s].map(n => String(n).padStart(2, '0')).join(':')}`);
            }
            md.push(`- **核对定位**：${locators.join('；')}。`, '');
        }
    }
}
const report = {
    passed: true, revision: input.revision, input_sha256: hash(inputBytes), data_sha256: hash(bytes),
    original_content_preserved: true, original_records: original.stats.words,
    ...nextProvenance.video_import, current: data.stats,
    distinct_words: new Set(groups.flatMap(group => group.entries.map(entry => entry.word))).size,
    sources: input.sources.map(source => ({ id: source.id, label: source.label, words: source.words,
        transcript_sha256: source.transcript_sha256, slides_sha256: source.slides_sha256 })),
};
if (checkOnly) {
    assert.deepEqual(previous, data, '已导入数据必须与校订稿一致');
    assert.deepEqual(provenance, nextProvenance, '来源记录必须与校订稿一致');
    assert.equal(await readFile(new URL('视频/成语校订/成语校订稿.md', phrase), 'utf8'), `${md.join('\n')}\n`);
} else {
    await writeFile(dataUrl, bytes);
    await writeFile(provenanceUrl, json(nextProvenance));
    await writeFile(new URL('视频/成语校订/成语校订稿.md', phrase), `${md.join('\n')}\n`);
    await writeFile(new URL('evidence/video-import.json', root), json(report));
}
console.log(JSON.stringify({ passed: true, check_only: checkOnly, ...data.stats, added_records: data.stats.words - original.stats.words,
    distinct_words: report.distinct_words, original_content_preserved: true }, null, 4));
