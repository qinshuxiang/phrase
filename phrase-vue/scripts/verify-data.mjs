import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const bytes = await readFile(new URL('src/data/vocab-data.json', root));
const provenance = JSON.parse(await readFile(new URL('src/data/provenance.json', root)));
assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.data_sha256, '当前数据文件哈希必须匹配');
assert.equal(bytes.length, provenance.bytes, '当前数据文件大小必须匹配');
const data = JSON.parse(bytes);
assert.deepEqual(Object.keys(data), ['generated_at', 'stats', 'files', 'groups']);
assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'), provenance.retained_content_sha256, '当前内容及顺序必须与记录一致');
const original = provenance.original_content;
const retained = {
    generated_at: original.generated_at, stats: original.stats,
    files: data.files.filter(file => original.file_ids.includes(file.id)),
    groups: data.groups.filter(group => original.group_ids.includes(group.id)),
};
assert.equal(createHash('sha256').update(JSON.stringify(retained)).digest('hex'), original.sha256, '原有515条内容及顺序必须完整保留');
assert.deepEqual(retained.files.map(file => file.id), original.file_ids);
assert.deepEqual(retained.groups.map(group => group.id), original.group_ids);
const entries = data.groups.flatMap(group => group.entries);
const fields = ['释义', '日常用法', '记忆技巧', '适用语境', '例句', '关联词'];
const files = new Set(data.files.map(file => file.id));
for (const collection of [data.files, data.groups]) {
    assert.equal(new Set(collection.map(item => item.id)).size, collection.length, 'ID 唯一');
}
for (const group of data.groups) {
    assert.ok(group.entries.length > 0, '每个分组必须有词条');
    assert.equal(new Set(group.entries.map(entry => `${entry.fileId}:${entry.word}`)).size, group.entries.length, '同组词条标识唯一');
}
for (const entry of entries) {
    assert.ok(files.has(entry.fileId));
    assert.deepEqual(Object.keys(entry.fields).sort(), [...fields].sort());
    assert.ok(Object.values(entry.fields).every(value => typeof value === 'string' && value.trim()));
}
for (const file of data.files) assert.equal(entries.filter(entry => entry.fileId === file.id).length, file.words);
const imported = entries.filter(entry => entry.fileId.startsWith('video-'));
assert.equal(imported.length, provenance.video_import.core_records + provenance.video_import.supplement_records);
assert.equal(data.files.filter(file => file.id.startsWith('video-')).length, provenance.video_import.sources);
assert.equal(data.groups.filter(group => group.id.startsWith('video-')).length, provenance.video_import.groups);
assert.ok(imported.every(entry => entry.fields['例句'].startsWith('【自拟例句】')));
assert.deepEqual({ files: data.files.length, groups: data.groups.length, words: entries.length,
    teachers: new Set(data.files.map(file => file.teacher)).size }, data.stats);
console.log(JSON.stringify({ passed: true, data_sha256: provenance.data_sha256, ...data.stats,
    distinct_words: new Set(entries.map(entry => entry.word)).size }, null, 4));
