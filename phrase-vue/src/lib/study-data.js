import { loadIndex as legacyIndex, loadYears, flattenShards } from './exam-data.js';

let indexPromise;
const cache = new Map();
const imageUrls = new Map();
const embedded = () => JSON.parse(document.getElementById('xingce-embedded')?.textContent ?? 'null');
let payload;
function bundle() { return payload ??= embedded(); }
async function decode(value) {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
async function json(path) {
    const response = await fetch(new URL(`xingce/${path}`, document.baseURI));
    if (!response.ok) throw new Error(`题库加载失败：${path} (${response.status})`);
    return response.json();
}
/** 加载全科索引，离线包优先内嵌。@returns {Promise<object>} 索引；I/O失败拒绝并清缓存供重试。 */
export function loadStudyIndex() {
    return indexPromise ??= (bundle()?.index ? Promise.resolve(bundle().index) : json('index.json'))
        .catch(error => { indexPromise = null; throw error; });
}
/** 按试卷加载并展开材料。@param {string} id 试卷ID @returns {Promise<object[]>} 原序题目；不存在或I/O失败时拒绝，可重试。 */
export async function loadPaper(id) {
    if (!cache.has(id)) cache.set(id, (async () => {
        const index = await loadStudyIndex();
        const meta = index.papers.find(p => p.id === id);
        if (!meta) throw new Error(`试卷不存在：${id}`);
        const shard = bundle()?.papers[id] ? await decode(bundle().papers[id]) : await json(meta.file);
        return shard.questions.map(q => ({ ...q, paper: meta.title, materialText: shard.materials[q.materialId] ?? '' }));
    })().catch(error => { cache.delete(id); throw error; }));
    return cache.get(id);
}
/** 读取独立言语扩展题源。@param {number[]} years 年份 @returns {Promise<object[]>} 统一接口题目；I/O失败拒绝，保留旧qid。 */
export async function loadExtension(years) {
    const shards = await loadYears(years);
    return flattenShards(shards).map(q => ({ ...q, id: `legacy:${q.qid}`, paperId: `legacy-${q.year}`, number: null,
        category: q.region === '山西' ? '山西' : q.region, module: '言语理解与表达', examType: '言语扩展',
        provenance: { status: 'verified', name: 'ERRRC/xingcezhenti（原言语题库）', reason: '原题源题干与答案一体导入' } }));
}
/** 沿用旧题源索引接口；返回Promise，I/O失败拒绝。 */
export { legacyIndex as loadExtensionIndex };
/** 按稳定ID恢复题目。@param {string[]} ids 题目引用 @returns {Promise<object[]>} 与输入同序的题目；引用缺失或I/O失败时拒绝。 */
export async function resolveQuestions(ids) {
    const mainIds = [...new Set(ids.filter(id => !id.startsWith('legacy:')).map(id => id.split(':')[0]))];
    let questions = (await Promise.all(mainIds.map(loadPaper))).flat();
    if (ids.some(id => id.startsWith('legacy:'))) {
        const index = await legacyIndex();
        questions = questions.concat(await loadExtension(index.years.map(y => y.year)));
    }
    const map = new Map(questions.map(q => [q.id, q]));
    return ids.map(id => { if (!map.has(id)) throw new Error(`题目已缺失：${id}`); return map.get(id); });
}
/** 解析本地图片。@param {string} path 图片相对路径 @returns {string} HTTP或Blob地址；非法路径返回空串，离线按需创建Blob。 */
export function studyImage(path) {
    if (!/^images\/[a-z0-9-]+\/\d+\.png$/.test(path)) return '';
    const images = bundle()?.images;
    if (!images) return new URL(`xingce/${path}`, document.baseURI).href;
    if (!images[path]) return '';
    if (!imageUrls.has(path)) imageUrls.set(path, URL.createObjectURL(new Blob([
        Uint8Array.from(atob(images[path]), c => c.charCodeAt(0)),
    ], { type: 'image/png' })));
    return imageUrls.get(path);
}
window.addEventListener('pagehide', event => { if (event.persisted) return; for (const url of imageUrls.values()) URL.revokeObjectURL(url); imageUrls.clear(); });
