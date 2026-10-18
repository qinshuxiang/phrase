import data from '@/data/vocab-data.json';

export const library = data;
export const fieldOrder = ['释义', '日常用法', '记忆技巧', '适用语境', '例句', '关联词'];
export const fileById = Object.fromEntries(data.files.map(file => [file.id, file]));

/**
 * 预先建立全文检索文本，保留原页面的搜索范围与记录顺序。
 * 不对同名词去重：同一个词在不同来源、分组中可以是独立笔记。
 */
const searchText = new WeakMap();
for (const group of data.groups) {
    for (const entry of group.entries) {
        const file = fileById[entry.fileId] ?? {};
        searchText.set(entry, [entry.word, group.title, file.label, file.teacher, file.date,
            ...Object.values(entry.fields)].join('\n').toLowerCase());
    }
}

/** 单个字面子串检索；空白查询返回完整分组，正则字符不具有特殊含义。 */
export function searchGroups(query) {
    const needle = String(query).trim().toLowerCase();
    if (!needle) return data.groups;
    return data.groups.map(group => ({
        ...group,
        entries: group.entries.filter(entry => searchText.get(entry).includes(needle)),
    })).filter(group => group.entries.length > 0);
}

/** 从来源名称中取出系列名与序号；识别不出时返回 null，由调用方回退。 */
function sourceKey(file) {
    return /言语1000词(\d+)|高频实词(\d+)/.exec(file?.label ?? '');
}

/** 首页展示名的系列部分：言语1000词 / 高频实词。 */
function seriesName(match) {
    return match[1] ? '言语1000词' : '高频实词';
}

/** 首页展示名只保留系列、序号与老师，例如“言语1000词-1，野子”；识别不出时沿用原名称。 */
export function sourceTitle(file) {
    const match = sourceKey(file);
    return match ? `${seriesName(match)}-${match[1] ?? match[2]}，${file.teacher}` : file.label;
}

/**
 * 首页阅读顺序：言语1000词按 1–21 依次排列，高频实词 1–3 收在末尾。
 * 只影响展示与来源轮转，不改动原始记录顺序；识别不出系列的来源排在最后并保持原相对顺序。
 */
export const orderedSources = [...data.files].sort((left, right) => {
    const a = sourceKey(left);
    const b = sourceKey(right);
    const series = match => (match ? (match[1] ? 1 : 2) : 3);
    const serial = match => Number(match ? match[1] ?? match[2] : 0);
    return series(a) - series(b) || serial(a) - serial(b);
});

/** 按原始组/词条顺序，收集某一来源的全部词条。 */
export function entriesForSource(sourceId) {
    return data.groups.flatMap(group => group.entries
        .filter(entry => entry.fileId === sourceId)
        .map(entry => ({ entry, group })));
}

/** 情感标签沿用原文：优先识别褒义，再识别贬义。 */
export function toneInfo(usage = '') {
    const label = String(usage).match(/【([^】]+)】/)?.[1] || '中性词';
    return { label, tone: label.includes('褒') ? 'positive' : label.includes('贬') ? 'negative' : 'neutral' };
}

/** 来源轮转允许循环；不存在的来源返回 null，不制造无效阅读状态。 */
export function adjacentSource(files, sourceId, offset) {
    const index = files.findIndex(file => file.id === sourceId);
    if (index < 0 || files.length === 0) return null;
    return files[((index + offset) % files.length + files.length) % files.length].id;
}

/**
 * 将正文拆为安全的高亮片段，由 Vue 文本插值输出，不使用 v-html。
 * 先转义正则元字符，再按原文本切片，保留原始字形与大小写。
 */
export function highlightParts(text, query) {
    const source = String(text ?? '');
    const needle = String(query ?? '').trim();
    if (!needle) return [{ text: source, hit: false }];
    const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = source.matchAll(new RegExp(pattern, 'gi'));
    const parts = [];
    let position = 0;
    for (const match of matches) {
        if (match.index > position) parts.push({ text: source.slice(position, match.index), hit: false });
        parts.push({ text: match[0], hit: true });
        position = match.index + match[0].length;
    }
    if (position < source.length || parts.length === 0) parts.push({ text: source.slice(position), hit: false });
    return parts;
}
