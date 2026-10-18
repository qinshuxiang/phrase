const OPTION_RE = /^-\s+\*\*([A-Z])\*\*\s*[.．、]?\s*(.*)$/;
const ANSWER_RE = /^\*\*答案\*\*\s*[:：]\s*(.+)$/;
const ANALYSIS_RE = /^\*\*官方解析\*\*\s*$/;
const HEADING_RE = /^(#{2,3})\s+(.+)$/;
const MATERIAL_RE = /^材料\s*(\d+)\s*$/;
const QUESTION_RE = /^第\s*(\d+)\s*题(?:\s*　?\s*<sub>(.*?)<\/sub>)?/;
const QID_RE = /qid\s*(\d+)\s*·\s*([^<]+)/;

/** 解码 HTML 实体；在去标签之后调用，避免解码出的尖括号被当作标签。 */
function decodeEntities(text) {
    return text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&amp;/gi, '&');
}

/**
 * 清理真题正文：块级标签转换行、去剩余标签、解码实体、归一空白。
 * 图片标签会被移除；调用方需先用 hasImage 判定是否跳过该题。
 */
export function cleanText(raw) {
    if (!raw) return '';
    let text = String(raw)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<img[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '');
    text = decodeEntities(text)
        .replace(/[\u00a0\u3000]/g, ' ')
        .replace(/[ \t]{2,}/g, '\u3000\u3000')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

/** 正文是否依赖图片（题干、选项或材料图）。 */
export function hasImage(raw) {
    return /<img\b/i.test(raw ?? '');
}

/** 解析 YAML 头；值是带引号的字符串，缺失字段返回空串。 */
export function parseFrontMatter(markdown) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
    const meta = {};
    if (!match) return { meta, body: markdown };
    for (const line of match[1].split(/\r?\n/)) {
        const item = /^([^:：]+)\s*[:：]\s*(.*)$/.exec(line.trim());
        if (!item) continue;
        meta[item[1].trim()] = item[2].trim().replace(/^["']|["']$/g, '');
    }
    return { meta, body: markdown.slice(match[0].length) };
}

/** 从题目缓冲区解析选项、答案与解析；失败返回 null。 */
function parseQuestionBuffer(lines, meta) {
    const cleaned = lines.map(line => line.trimEnd());
    const firstOption = cleaned.findIndex(line => OPTION_RE.test(line.trim()));
    const stemLines = firstOption === -1 ? cleaned : cleaned.slice(0, firstOption);
    const restLines = firstOption === -1 ? [] : cleaned.slice(firstOption);

    const options = [];
    const marked = [];
    let cursor = 0;
    while (cursor < restLines.length && OPTION_RE.test(restLines[cursor].trim())) {
        const item = OPTION_RE.exec(restLines[cursor].trim());
        const correct = /✅/u.test(item[2]);
        const text = cleanText(item[2].replace(/✅/gu, ''));
        options.push({ letter: item[1], text });
        marked.push(correct);
        cursor++;
    }

    const tail = restLines.slice(cursor).map(line => line.trim());
    let answerText = '';
    let analysisStart = -1;
    for (let i = 0; i < tail.length; i++) {
        const answer = ANSWER_RE.exec(tail[i]);
        if (answer && !answerText) answerText = answer[1];
        if (ANALYSIS_RE.test(tail[i])) {
            analysisStart = i + 1;
            break;
        }
    }

    const analysisLines = analysisStart === -1 ? [] : tail.slice(analysisStart);
    const analysis = cleanText(analysisLines.join('\n').replace(/^-{3,}\s*$/gm, ''));

    const answer = [];
    const letters = [...answerText.toUpperCase()].filter(char => /[A-Z]/.test(char));
    if (letters.length > 0) {
        for (const letter of letters) {
            const index = options.findIndex(option => option.letter === letter);
            if (index === -1) return null;
            if (!answer.includes(index)) answer.push(index);
        }
    } else {
        marked.forEach((correct, index) => { if (correct) answer.push(index); });
    }

    const stem = cleanText(stemLines.join('\n'));
    if (!stem || options.length < 2 || answer.length === 0) return null;
    if (stem.replace(/\s/g, '').length < 8) return null;
    if (options.some(option => !option.text)) return null;

    return {
        qid: meta.qid ?? '',
        stem,
        type: meta.type ?? '',
        options: options.map(option => option.text),
        answer: answer.sort((a, b) => a - b),
        analysis,
        needsImage: hasImage([...stemLines, ...restLines.slice(0, cursor)].join('\n')),
    };
}

/**
 * 解析一份真题 Markdown。
 * @param {string} markdown 原文
 * @param {{ module?: string }} [options] module 用于丢弃非目标模块的文件
 * @returns {{ paper: object, materials: Record<string, string>, questions: object[], skipped: object }}
 */
export function parsePaper(markdown, options = {}) {
    const { meta, body } = parseFrontMatter(markdown);
    const skipped = { image: 0, material_image: 0, invalid: 0, duplicate: 0 };
    const materials = {};
    const questions = [];
    const seenQid = new Set();

    let section = null;
    let materialId = null;
    let activeMaterial = null;
    let activeMaterialHasImage = false;
    let materialLines = [];
    let materialHasImage = false;
    let questionMeta = null;
    let questionLines = [];

    const flushMaterial = () => {
        if (materialId) activeMaterialHasImage = materialHasImage;
        if (materialId && !materialHasImage) {
            const text = cleanText(materialLines.join('\n').replace(/^-{3,}\s*$/gm, ''));
            if (text) materials[materialId] = text;
        }
        materialId = null;
        materialLines = [];
        materialHasImage = false;
    };

    const flushQuestion = () => {
        if (!questionMeta) return;
        const materialKey = questionMeta.material;
        const parsed = parseQuestionBuffer(questionLines, questionMeta);
        if (questionMeta.materialHasImage) {
            skipped.material_image++;
        } else if (parsed?.needsImage) {
            skipped.image++;
        } else if (!parsed) {
            skipped.invalid++;
        } else if (parsed.qid && seenQid.has(parsed.qid)) {
            skipped.duplicate++;
        } else {
            if (parsed.qid) seenQid.add(parsed.qid);
            questions.push({
                qid: parsed.qid,
                number: questionMeta.number,
                type: parsed.type,
                stem: parsed.stem,
                material: materialKey && materials[materialKey] ? materialKey : null,
                options: parsed.options,
                answer: parsed.answer,
                analysis: parsed.analysis,
            });
        }
        questionMeta = null;
        questionLines = [];
    };

    for (const line of body.split(/\r?\n/)) {
        const heading = HEADING_RE.exec(line);
        if (heading) {
            const title = heading[2].trim();
            const material = MATERIAL_RE.exec(title);
            const question = QUESTION_RE.exec(title);
            if (material) {
                flushQuestion();
                flushMaterial();
                section = 'material';
                materialId = `m${material[1]}`;
                activeMaterial = materialId;
                activeMaterialHasImage = false;
                continue;
            }
            if (question) {
                flushQuestion();
                // 材料小题统一用三级标题；二级标题的题目不继承上一段材料。
                const nested = heading[1].length >= 3;
                const parentMaterial = nested ? activeMaterial : null;
                const parentHasImage = nested && activeMaterialHasImage;
                if (!nested) activeMaterial = null;
                if (section === 'material') flushMaterial();
                section = 'question';
                const sub = question[2] ? QID_RE.exec(question[2]) : null;
                questionMeta = {
                    number: Number(question[1]),
                    qid: sub ? sub[1] : '',
                    type: sub ? sub[2].trim() : '',
                    material: parentMaterial,
                    materialHasImage: parentHasImage,
                };
                continue;
            }
            flushQuestion();
            flushMaterial();
            activeMaterial = null;
            section = 'other';
            continue;
        }
        if (section === 'material') {
            materialLines.push(line);
            if (hasImage(line)) materialHasImage = true;
        } else if (section === 'question') {
            questionLines.push(line);
        }
    }
    flushQuestion();
    flushMaterial();

    const paper = {
        title: meta['试卷'] ?? '',
        region: meta['地区'] ?? '',
        year: Number(meta['年份']) || 0,
        module: meta['模块'] ?? '',
        declared: Number(meta['题数']) || 0,
    };
    if (options.module && paper.module && paper.module !== options.module) {
        questions.length = 0;
        skipped.invalid += 1;
    }

    return { paper, materials, questions, skipped };
}
