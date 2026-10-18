import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { parseFragment } from 'parse5';

const root = new URL('../', import.meta.url);
const bank = new URL('../fenbi/题库/', root);
const cache = new URL('../fenbi/.cache/answers/', root);
const output = new URL('public/xingce/', root);
const check = process.argv.includes('--check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = url => readFile(url, 'utf8');
const sourceHashes = {};
async function source(url) {
    const value = await read(url);
    sourceHashes[fileURLToPath(url).replace(fileURLToPath(new URL('../', root)), '')] = hash(value);
    return value;
}
// 仅忽略排版、填空符和标点；数字、字母与汉字必须完整一致。
const norm = text => {
    const tree = parseFragment(String(text).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/✅/g, ''));
    const extract = n => n.nodeName === '#text' ? n.value : (n.childNodes ?? []).map(extract).join('');
    return extract(tree).normalize('NFKC').replace(/[\p{P}\p{Z}\p{C}\s＿_]/gu, '');
};
const hasImage = text => /!\[|<img\b/i.test(text ?? '');
const modules = ['政治理论', '常识判断', '言语理解与表达', '数量关系', '判断推理', '资料分析'];

function parseMarkdown(text) {
    const questions = [];
    let material = '', section = '', current;
    for (const line of text.split(/\r?\n/)) {
        if (/^#{2,3} 材料/.test(line)) { current = null; material = ''; section = 'material'; continue; }
        const heading = /^(#{2,3}) 第 \d+ 题.*?qid (\d+)/.exec(line);
        if (heading) {
            if (heading[1].length === 2) material = '';
            current = { qid: heading[2], stem: '', options: [], answer: '', material };
            questions.push(current); section = 'stem'; continue;
        }
        if (/^---\s*$/.test(line) || !line.trim()) continue;
        if (section === 'material') { material += line + '\n'; continue; }
        if (!current) continue;
        const option = /^- \*\*([A-D])\*\*\.\s?(.*)$/.exec(line);
        if (option) { current.options.push({ label: option[1], text: option[2] }); section = 'options'; continue; }
        const answer = /^\*\*答案\*\*[:：]\s*([A-D])/.exec(line);
        if (answer) { current.answer = answer[1]; section = 'tail'; continue; }
        if (section === 'stem') current.stem += line + '\n';
    }
    return questions;
}

function parseOldPaper(html, answers) {
    const doc = new JSDOM(html).window.document;
    const answerText = new JSDOM(answers).window.document.body.textContent;
    const answerMap = new Map([...answerText.matchAll(/(\d{1,3})\s*[、.．]\s*([A-D])/g)].map(m => [+m[1], m[2]]));
    return [...doc.querySelectorAll('#printcontent .row')].flatMap(row => {
        const left = row.querySelector('.left'), right = row.querySelector('.right');
        if (!left || !right) return [];
        const parts = [...right.children].map(el => ({ text: el.textContent.trim(), html: el.innerHTML }));
        const at = parts.findIndex(p => /^[A-D][、.．]/.test(p.text));
        if (at < 0) return [];
        return [{ no: Number(left.textContent), stem: parts.slice(0, at).map(p => p.html).join('\n'),
            options: parts.slice(at).filter(p => /^[A-D][、.．]/.test(p.text)).map(p => ({ label: p.text[0], text: p.html.replace(/^[A-D][、.．]/, '') })),
            answer: answerMap.get(Number(left.textContent)), material: '' }];
    });
}

async function emit(name, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const url = new URL(name, output);
    if (check) assert.deepEqual(await readFile(url), bytes, `生成物不一致：${name}`);
    else { await mkdir(new URL('.', url), { recursive: true }); await writeFile(url, bytes); }
    return { bytes: bytes.length, sha256: hash(bytes) };
}

const original = JSON.parse(await source(new URL('index.json', bank)));
const papers = [], images = new Set(), issues = [];
const stats = { papers: 0, questions: 0, verified: 0, pending: 0, missing: 0, missingAnalysis: 0 };
for (const item of original.exams) {
    const paper = JSON.parse(await source(new URL(item.file, bank)));
    let candidates = [], sourceName = '', sourceFile = '';
    try {
        const dir = new URL(`errrc/${paper.id}/`, cache);
        const files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort();
        for (const file of files) candidates.push(...parseMarkdown(await source(new URL(file, dir))));
        sourceName = 'ERRRC/xingcezhenti 本地缓存'; sourceFile = `errrc/${paper.id}`;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const dir = new URL(`gkzhenti/${paper.id}/`, cache);
        candidates = parseOldPaper(await source(new URL('paper.html', dir)), await source(new URL('answer.html', dir)));
        sourceName = 'gwy.gkzhenti.cn 本地缓存'; sourceFile = `gkzhenti/${paper.id}`;
    }
    const normalized = candidates.map(c => ({ ...c, normalized: norm(c.stem) }));
    const questions = paper.questions.map(q => {
        const materialText = q.material === null ? '' : paper.materials[q.material];
        assert.ok(q.material === null || typeof materialText === 'string', `${paper.id}:${q.no} 材料缺失`);
        const text = norm(q.stem);
        const pool = normalized.filter(c => c.normalized === text && (!q.qid || c.qid === q.qid));
        const candidate = pool.length === 1 ? pool[0] : null;
        const imageDependent = [q.stem, materialText, ...q.options.map(o => o.text)].some(hasImage);
        const optionsMatch = candidate?.options.length === q.options.length && q.options.every((o, i) =>
            candidate.options[i].label === o.label && norm(candidate.options[i].text) === norm(o.text));
        const materialMatch = !materialText ? !candidate?.material : candidate && norm(candidate.material) === norm(materialText);
        const verified = Boolean(q.answer && candidate && !imageDependent && ![candidate.stem, candidate.material, ...candidate.options.map(o => o.text)].some(hasImage)
            && optionsMatch && materialMatch && candidate.answer === q.answer);
        const status = !q.answer ? 'missing' : verified ? 'verified' : 'pending';
        const reason = status === 'verified' ? '完整题干、选项顺序、材料及答案一致'
            : status === 'missing' ? '原题库缺答案' : imageDependent ? '依赖图片，需要人工核验'
                : !candidate ? '完整题干无法唯一匹配来源' : !optionsMatch ? '选项内容或顺序待核验'
                    : !materialMatch ? '材料关联待核验' : '来源答案不一致';
        stats.questions++; stats[status]++; if (!q.explain) stats.missingAnalysis++;
        if (!verified) issues.push({ id: `${paper.id}:${q.no}`, status, reason });
        return { id: `${paper.id}:${q.no}`, paperId: paper.id, number: q.no, qid: q.qid ?? null,
            category: paper.category, year: paper.year, examType: paper.examType, module: q.module,
            stem: q.stem, options: q.options.map(o => o.text), materialId: q.material === null ? null : `${paper.id}:m${q.material}`,
            answer: q.answer ? [q.answer.charCodeAt(0) - 65] : [], analysis: q.explain ?? '',
            provenance: { name: sourceName, cache: sourceFile, status, reason } };
    });
    const materials = Object.fromEntries(paper.materials.map((text, i) => [`${paper.id}:m${i}`, text]));
    const content = JSON.stringify({ version: 2, id: paper.id, materials, questions }) + '\n';
    for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        assert.match(match[1], /^images\/[a-z0-9-]+\/\d+\.png$/); images.add(match[1]);
    }
    const file = `papers/${paper.id}.json`;
    papers.push({ ...item, file, ...await emit(file, content), verified: questions.filter(q => q.provenance.status === 'verified').length });
    stats.papers++;
}
for (const path of [...images].sort()) {
    const bytes = await readFile(new URL(path, bank));
    sourceHashes[`fenbi/题库/${path}`] = hash(bytes);
    await emit(path, bytes);
}
const indexed = new Set(original.exams.map(p => p.source));
const pendingPdfs = [];
for (const category of ['国考', '山西']) for (const file of (await readdir(new URL(`../fenbi/${category}/`, root))).sort()) {
    if (file.endsWith('.pdf') && !indexed.has(`${category}/${file}`)) pendingPdfs.push(`${category}/${file}`);
}
assert.equal(stats.papers, 46); assert.equal(stats.questions, 6020); assert.equal(pendingPdfs.length, 11);
const index = { version: 2, modules, papers, stats, images: [...images].sort(), pendingPdfs, sourceHashes };
await emit('index.json', JSON.stringify(index, null, 2) + '\n');
const report = { ...stats, images: images.size, pendingPdfs, issues, sourceHashes };
if (!check) await writeFile(new URL('evidence/xingce-import.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ check, ...stats, images: images.size, pendingPdfs: pendingPdfs.length }));
