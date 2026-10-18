const EMBEDDED_ID = 'exam-embedded';
const cache = new Map();
let embeddedCache;

/** 读取离线单 HTML 内嵌的数据包；常规 HTTP 环境下返回 null。 */
function embeddedPayload() {
    if (embeddedCache !== undefined) return embeddedCache;
    const element = document.getElementById(EMBEDDED_ID);
    if (!element) {
        embeddedCache = null;
        return embeddedCache;
    }
    try {
        embeddedCache = JSON.parse(element.textContent);
    } catch {
        embeddedCache = null;
    }
    return embeddedCache;
}

/** 当前环境是否带内嵌考试数据（离线单 HTML）。 */
export function hasEmbeddedExam() {
    return Boolean(embeddedPayload()?.index);
}

function dataUrl(name) {
    return new URL(`exam/${name}`, document.baseURI).href;
}

/** file:// 下 fetch 必被 CORS 拦截，直接走内嵌数据。 */
function useEmbeddedFirst() {
    return window.location.protocol === 'file:' && Boolean(embeddedPayload()?.index);
}

async function gunzipBase64(value) {
    if (typeof DecompressionStream !== 'function') {
        throw Object.assign(new Error('当前浏览器不支持解压内嵌题库'), { code: 'unsupported-browser' });
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
}

async function fetchJson(name) {
    const response = await fetch(dataUrl(name));
    if (!response.ok) throw Object.assign(new Error(`题库请求失败：HTTP ${response.status}`), { code: 'no-data' });
    return response.json();
}

function loadCached(key, producer) {
    if (!cache.has(key)) {
        const promise = producer().catch(error => {
            cache.delete(key);
            throw error;
        });
        cache.set(key, promise);
    }
    return cache.get(key);
}

/** 加载题库索引；HTTP 失败时回退到内嵌数据。 */
export function loadIndex() {
    return loadCached('index', async () => {
        if (useEmbeddedFirst()) return embeddedPayload().index;
        try {
            return await fetchJson('index.json');
        } catch (error) {
            const embedded = embeddedPayload();
            if (embedded?.index) return embedded.index;
            throw Object.assign(new Error('未找到题库数据'), { code: 'no-data', cause: error });
        }
    });
}

/** 加载某一年份的题目分片；HTTP 失败时回退到内嵌 gzip 数据。 */
export function loadYear(year) {
    return loadCached(`year:${year}`, async () => {
        if (useEmbeddedFirst() && embeddedPayload()?.shards?.[year]) {
            return gunzipBase64(embeddedPayload().shards[year]);
        }
        try {
            return await fetchJson(`verbal/${year}.json`);
        } catch (error) {
            const encoded = embeddedPayload()?.shards?.[year];
            if (encoded) return gunzipBase64(encoded);
            throw Object.assign(new Error(`未找到 ${year} 年题库`), { code: error.code ?? 'no-data', cause: error });
        }
    });
}

/**
 * 并发加载多个年份，并按完成数回调进度。
 * @param {number[]} years
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function loadYears(years, onProgress) {
    let done = 0;
    return Promise.all(years.map(async year => {
        const shard = await loadYear(year);
        done++;
        onProgress?.(done, years.length);
        return shard;
    }));
}

/** 合并分片中的题目与材料，供组卷使用。 */
export function flattenShards(shards) {
    const pool = [];
    for (const shard of shards) {
        const materials = shard.materials ?? {};
        for (const question of shard.questions) {
            pool.push({
                ...question,
                materialText: question.material ? materials[question.material] ?? '' : '',
            });
        }
    }
    return pool;
}

/** 清空加载缓存，用于重试。 */
export function resetExamCache() {
    cache.clear();
}
