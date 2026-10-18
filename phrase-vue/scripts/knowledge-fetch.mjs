import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { evidenceBlocks, parseZdic } from './lib/zdic-parse.mjs';

/**
 * 汉典批量抓取：单并发、节流、缓存与断点续跑。
 *
 * 用法：node scripts/knowledge-fetch.mjs [--force] [--limit N] [--only 词] [--batch b1]
 * 产物：research/cache/zdic/<词>.html、research/evidence/<词>.json、research/cache/state.json
 * 失败：网络错误重试 3 次（退避 2/5/10 秒）；404 记为 not_found 终态；连续失败 5 次停批。
 * 词表取 research/sampling/all-words.json，--batch 只抓指定批次，已完成的词自动跳过。
 */

const root = new URL('../', import.meta.url);
const evidenceDir = new URL('research/evidence/', root);
const cacheDir = new URL('research/cache/zdic/', root);
const args = process.argv.slice(2);
const force = args.includes('--force');
const reparse = args.includes('--reparse');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const batchIndex = args.indexOf('--batch');
const batch = batchIndex >= 0 ? args[batchIndex + 1] : null;
const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const BATCH = 60;
const retrievedAt = new Date().toISOString().slice(0, 10);

const plan = JSON.parse(await readFile(new URL('research/sampling/all-words.json', root), 'utf8'));
const targets = (batch ? plan.words.filter(item => item.batch === batch) : plan.words);
const stateUrl = new URL('research/cache/state.json', root);
let state = {};
try {
    state = JSON.parse(await readFile(stateUrl, 'utf8'));
} catch {
    state = {};
}
await mkdir(cacheDir, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const jitter = () => 700 + Math.round(Math.random() * 300);

/** 用已缓存的 HTML 重新解析，适用于解析器升级后的离线重跑。 */
if (reparse) {
    let updated = 0;
    for (const item of targets) {
        const file = new URL(`${item.word}.html`, cacheDir);
        let bytes;
        try {
            bytes = await readFile(file);
        } catch {
            continue;
        }
        const parsed = parseZdic(bytes.toString('utf8'), item.word);
        const pageSha = createHash('sha256').update(bytes).digest('hex');
        const url = `https://www.zdic.net/hans/${encodeURIComponent(item.word)}`;
        // 汉典 404 返回极短的路由提示页，无 HTML 结构；据此恢复真实状态码，避免把 404 记成 200。
        const missingPage = bytes.length < 200 || !/<html/i.test(bytes.toString('utf8'));
        const httpStatus = missingPage ? 404 : 200;
        await writeFile(fileURLToPath(new URL(`${item.word}.json`, evidenceDir)), `${JSON.stringify({
            word: item.word,
            source: { id: 'zdic', name: '汉典', url, retrieved_at: retrievedAt, http_status: httpStatus, page_sha256: pageSha, bytes: bytes.length },
            parsed, blocks: evidenceBlocks(parsed),
        }, null, 4)}\n`);
        state[item.word] = {
            status: parsed.found ? 'parsed' : 'not_found', http_status: httpStatus,
            url, page_sha256: pageSha, bytes: bytes.length, section: parsed.section,
            pinyin: parsed.readings.pinyin.join(' '), senses: parsed.senses.length,
            citations: parsed.citations.length, synonyms: parsed.synonyms.length, antonyms: parsed.antonyms.length,
            origin: Boolean(parsed.origin), fetched_at: state[item.word]?.fetched_at ?? new Date().toISOString(),
        };
        updated++;
    }
    await writeFile(stateUrl, `${JSON.stringify(state, null, 4)}\n`);
    console.log(JSON.stringify({ reparse: true, updated }, null, 4));
    process.exit(0);
}

/** 抓取单个词条页面；返回 HTTP 状态码与字节内容。 */
async function fetchOnce(word) {
    const file = new URL(`${word}.html`, cacheDir);
    const url = `https://www.zdic.net/hans/${encodeURIComponent(word)}`;
    const { stdout } = await run('curl', [
        '-sL', '--max-time', '20', '--compressed', '-A', UA,
        '-H', 'Accept-Language: zh-CN,zh;q=0.9', '-o', fileURLToPath(file), '-w', '%{http_code}', url,
    ], { maxBuffer: 1024 * 1024 });
    const bytes = await readFile(file);
    return { status: Number(stdout.trim()), bytes, url };
}

let consecutiveFailures = 0;
let processed = 0;
for (const item of targets) {
    if (only && item.word !== only) continue;
    if (processed >= limit) break;
    const previous = state[item.word];
    if (!force && previous && ['parsed', 'not_found'].includes(previous.status)) continue;
    processed++;

    const attempts = [];
    let result = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            result = await fetchOnce(item.word);
            attempts.push(result.status);
            if (result.status === 200 || result.status === 404) break;
        } catch (error) {
            attempts.push(`error:${error.code ?? error.message}`);
        }
        await sleep([2000, 5000, 10000][attempt] ?? 10000);
    }

    const url = `https://www.zdic.net/hans/${encodeURIComponent(item.word)}`;
    if (!result || result.status !== 200) {
        const status = result?.status === 404 ? 'not_found' : 'failed';
        state[item.word] = {
            status, http_status: result?.status ?? null, attempts,
            url, fetched_at: new Date().toISOString(), error: status === 'failed' ? '抓取失败' : null,
        };
        await writeFile(fileURLToPath(new URL(`${item.word}.json`, evidenceDir)), `${JSON.stringify({
            word: item.word,
            source: { id: 'zdic', name: '汉典', url, retrieved_at: retrievedAt,
                http_status: result?.status ?? null, page_sha256: null, bytes: 0 },
            parsed: { found: false, word: item.word, readings: { pinyin: [], zhuyin: [] }, senses: [], citations: [], synonyms: [], antonyms: [], english: '' },
            blocks: {},
        }, null, 4)}\n`);
        consecutiveFailures = status === 'failed' ? consecutiveFailures + 1 : 0;
        console.log(`${item.word}\t${status}\t${attempts.join(',')}`);
        await sleep(jitter());
        if (consecutiveFailures >= 5) {
            console.error('连续失败 5 次，停止本批');
            break;
        }
        continue;
    }

    consecutiveFailures = 0;
    const parsed = parseZdic(result.bytes.toString('utf8'), item.word);
    const pageSha = createHash('sha256').update(result.bytes).digest('hex');
    const changed = Boolean(previous?.page_sha256) && previous.page_sha256 !== pageSha;
    const evidence = {
        word: item.word,
        source: { id: 'zdic', name: '汉典', url, retrieved_at: retrievedAt,
            http_status: 200, page_sha256: pageSha, bytes: result.bytes.length },
        parsed,
        blocks: evidenceBlocks(parsed),
    };
    await writeFile(fileURLToPath(new URL(`${item.word}.json`, evidenceDir)), `${JSON.stringify(evidence, null, 4)}\n`);
    state[item.word] = {
        status: parsed.found ? 'parsed' : 'not_found', http_status: 200, attempts,
        url, page_sha256: pageSha, bytes: result.bytes.length, changed,
        pinyin: parsed.readings.pinyin.join(' '), senses: parsed.senses.length,
        citations: parsed.citations.length, synonyms: parsed.synonyms.length, antonyms: parsed.antonyms.length,
        fetched_at: new Date().toISOString(),
    };
    console.log(`${item.word}\t${state[item.word].status}\t${parsed.readings.pinyin.join(' ') || '-'}\tsense=${parsed.senses.length}\tcit=${parsed.citations.length}\tsyn=${parsed.synonyms.length}\tant=${parsed.antonyms.length}`);
    await writeFile(stateUrl, `${JSON.stringify(state, null, 4)}\n`);
    await sleep(jitter());
    if (processed % BATCH === 0) {
        console.log(`--- 已完成 ${processed} 词，批间暂停 20 秒 ---`);
        await sleep(20000);
    }
}

await writeFile(stateUrl, `${JSON.stringify(state, null, 4)}\n`);
const summary = Object.entries(state).reduce((acc, [, value]) => {
    acc[value.status] = (acc[value.status] ?? 0) + 1;
    return acc;
}, {});
console.log(JSON.stringify({ processed, summary }, null, 4));
