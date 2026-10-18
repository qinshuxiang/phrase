/**
 * 汉典（zdic.net）词条页面解析器。
 *
 * 页面有三种形态：成语页（xxjs 分节，含拼音、义项、书证、近反义）、
 * 成语简表页（idiom-section，含解释/出处/示例/语法）、国语辞典页（gy 分节）。
 * 解析只做文本抽取与空白归一化，不改写措辞；缺字段返回空数组或 null，由调用方标记缺失。
 */

/** 解码 HTML 实体并合并连续空白，保留中文标点。 */
export function normalizeText(fragment) {
    return String(fragment ?? '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/\s+/g, ' ')
        .trim();
}

/** 取第一个匹配分组的归一化文本。 */
function firstText(html, pattern) {
    const match = pattern.exec(html);
    return match ? normalizeText(match[1]) : '';
}

/** 取所有匹配分组的归一化文本。 */
function allTexts(html, pattern) {
    return [...html.matchAll(pattern)].map(match => normalizeText(match[1])).filter(Boolean);
}

/** 解析 xxjs 成语分节：词形、拼音、注音、义项、书证、近反义、英文。 */
function parseWordsSection(html) {
    const pinyin = firstText(html, /class="[^"]*xxjs-reading__py[^"]*"[^>]*>([\s\S]*?)</).split(/\s+/).filter(Boolean);
    const zhuyin = firstText(html, /class="[^"]*xxjs-reading__zy[^"]*"[^>]*>([\s\S]*?)</).split(/\s+/).filter(Boolean);
    const citations = [];
    const citationPattern = /class="[^"]*xxjs-citation__text[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>([\s\S]{0,400}?)class="[^"]*xxjs-citation__source[^"]*"[^>]*>([\s\S]*?)</g;
    for (const match of html.matchAll(citationPattern)) {
        const text = normalizeText(match[1]);
        if (text) citations.push({ text, source: normalizeText(match[3]) });
    }
    const definitions = allTexts(html, /class="[^"]*xxjs-item__def[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/g);
    const synonymBlock = /class="[^"]*synonym-section--entry[^"]*"([\s\S]*?)(?=<\/section>|$)/.exec(html)?.[1] ?? '';
    const labelPattern = /class="[^"]*synonym-label--(syn|ant)[^"]*"[^>]*>([\s\S]*?)</g;
    const labels = [...synonymBlock.matchAll(labelPattern)].map(match => ({
        kind: match[1], index: match.index, end: match.index + match[0].length,
    }));
    const synonyms = [];
    const antonyms = [];
    labels.forEach((label, position) => {
        const next = labels[position + 1]?.index ?? synonymBlock.length;
        const tags = allTexts(synonymBlock.slice(label.end, next), /class="[^"]*synonym-tag[^"]*"[^>]*>([\s\S]*?)</g);
        (label.kind === 'syn' ? synonyms : antonyms).push(...tags);
    });
    return {
        pinyin, zhuyin, citations,
        senses: definitions.map((definition, index) => ({ definition, citations: index === 0 ? citations.slice(0, 2) : [] })),
        synonyms: [...new Set(synonyms)], antonyms: [...new Set(antonyms)],
        english: firstText(html, /class="[^"]*xxjs-english__text[^"]*"[^>]*>([\s\S]*?)</),
        origin: null, grammar: '', example: '',
    };
}

/** 解析 idiom-section 简表分节：解释、出处、示例、语法以标签行给出。 */
function parseIdiomSection(html, word) {
    const fields = {};
    const linePattern = /class="[^"]*idiom-entry__label[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>\s*<[^>]*class="[^"]*idiom-entry__text[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/g;
    for (const match of html.matchAll(linePattern)) {
        fields[normalizeText(match[1])] = normalizeText(match[2]);
    }
    const definition = fields['解释'] ?? '';
    const origin = fields['出处'] ?? '';
    return {
        pinyin: [], zhuyin: [], citations: [],
        senses: definition ? [{ definition, citations: [] }] : [],
        synonyms: [], antonyms: [],
        english: '',
        origin: origin ? { text: origin, source: word } : null,
        grammar: fields['语法'] ?? '',
        example: fields['示例'] ?? '',
    };
}

/** 解析国语辞典分节：拼音、注音、义项、书证。 */
function parseGuoyuSection(html) {
    const pinyin = firstText(html, /class="[^"]*gy-reading__py[^"]*"[^>]*>([\s\S]*?)</).split(/\s+/).filter(Boolean);
    const zhuyin = firstText(html, /class="[^"]*gy-reading__zy[^"]*"[^>]*>([\s\S]*?)</).split(/\s+/).filter(Boolean);
    const citations = [];
    for (const match of html.matchAll(/class="[^"]*gy-sense__cit-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
        const block = match[1];
        const source = firstText(block, /class="[^"]*xxjs-citation__source[^"]*"[^>]*>([\s\S]*?)</);
        const text = normalizeText(block.replace(/<cite\b[\s\S]*?<\/cite>/gi, ' ').replace(/class="[^"]*xxjs-citation__dash[^"]*"[\s\S]*?<\/[^>]+>/gi, ' '));
        if (text) citations.push({ text, source });
    }
    const definitions = allTexts(html, /class="[^"]*gy-sense__def[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/g);
    return {
        pinyin, zhuyin, citations,
        senses: definitions.map((definition, index) => ({ definition, citations: index === 0 ? citations.slice(0, 2) : [] })),
        synonyms: [], antonyms: [], english: '', origin: null, grammar: '', example: '',
    };
}

/**
 * 解析汉典词条页面。
 *
 * @param {string} html 页面 HTML 原文
 * @param {string} expectedWord 期望词形，用于校验页面是否返回同一词
 * @returns {{found: boolean, word: string, section: string|null, readings: {pinyin: string[], zhuyin: string[]}, senses: {definition: string, citations: {text: string, source: string}[]}[], citations: {text: string, source: string}[], synonyms: string[], antonyms: string[], origin: {text: string, source: string}|null, grammar: string, example: string, english: string}}
 *   found 为 false 表示页面没有可用的词典内容；解析不抛异常，缺字段以空值表达。
 */
export function parseZdic(html, expectedWord) {
    const empty = {
        found: false, word: expectedWord, section: null,
        readings: { pinyin: [], zhuyin: [] }, senses: [], citations: [],
        synonyms: [], antonyms: [], origin: null, grammar: '', example: '', english: '',
    };
    if (!html) return empty;

    const word = firstText(html, /class="[^"]*dict-section__char[^"]*"[^>]*>([\s\S]*?)</) || expectedWord;
    const wordsMatch = /class="[^"]*xxjs-section[^"]*"/.test(html);
    const idiomMatch = /class="[^"]*idiom-section[^"]*"/.test(html);
    const guoyuMatch = /class="[^"]*guoyu-section[^"]*"/.test(html);

    let parsed = null;
    let section = null;
    if (wordsMatch) {
        parsed = parseWordsSection(html);
        section = 'words';
    } else if (idiomMatch) {
        const idiomSection = html.slice(html.search(/class="[^"]*idiom-section[^"]*"/));
        const fields = parseIdiomSection(idiomSection.slice(0, idiomSection.search(/<\/section>/)), word);
        if (fields.senses.length || fields.origin) {
            parsed = fields;
            section = 'idiom';
        }
    }
    if (!parsed && guoyuMatch) {
        parsed = parseGuoyuSection(html);
        section = 'guoyu';
    }
    // 简表页常不带拼音，若同页还有国语辞典分节，用其读音补足。
    if (parsed && section === 'idiom' && !parsed.pinyin.length && guoyuMatch) {
        const guoyu = parseGuoyuSection(html);
        parsed.pinyin = guoyu.pinyin;
        parsed.zhuyin = guoyu.zhuyin;
        if (!parsed.citations.length) parsed.citations = guoyu.citations;
    }
    if (!parsed) return { ...empty, word };

    return {
        found: parsed.senses.length > 0 || parsed.citations.length > 0 || Boolean(parsed.origin),
        word,
        section,
        readings: { pinyin: parsed.pinyin, zhuyin: parsed.zhuyin },
        senses: parsed.senses,
        citations: parsed.citations,
        synonyms: parsed.synonyms,
        antonyms: parsed.antonyms,
        origin: parsed.origin,
        grammar: parsed.grammar,
        example: parsed.example,
        english: parsed.english,
    };
}

/** 生成供 quote 校验使用的文本块，键名与 provenance.evidence_ref 的锚点一致。 */
export function evidenceBlocks(parsed) {
    const blocks = {};
    if (parsed.readings.pinyin.length) blocks.reading = parsed.readings.pinyin.join(' ');
    parsed.senses.forEach((sense, index) => {
        blocks[`sense-${index + 1}`] = sense.definition;
    });
    parsed.citations.forEach((citation, index) => {
        blocks[`citation-${index + 1}`] = [citation.text, citation.source].filter(Boolean).join(' — ');
    });
    if (parsed.origin) blocks.origin = parsed.origin.text;
    if (parsed.grammar) blocks.grammar = parsed.grammar;
    if (parsed.example) blocks.example = parsed.example;
    if (parsed.synonyms.length) blocks.synonyms = parsed.synonyms.join('、');
    if (parsed.antonyms.length) blocks.antonyms = parsed.antonyms.join('、');
    return blocks;
}
