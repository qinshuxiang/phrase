import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HighlightedText from '@/components/HighlightedText.vue';
import { library, searchGroups, entriesForSource, adjacentSource, highlightParts, toneInfo, orderedSources, sourceTitle } from './library';

describe('原始内容与检索语义', () => {
    it('保留全部内容与重复来源，不按词名去重', () => {
        const entries = library.groups.flatMap(group => group.entries);
        expect(entries).toHaveLength(library.stats.words);
        expect(new Set(entries.map(entry => entry.word)).size).toBeLessThan(entries.length);
        expect(Object.keys(library)).toEqual(['generated_at', 'stats', 'files', 'groups']);
        expect(library.stats).toEqual({ files: 24, groups: library.groups.length, words: entries.length, teachers: 4 });
        expect(entries.filter(entry => !entry.fileId.startsWith('video-'))).toHaveLength(515);
    });
    it('全文搜索覆盖释义和关联词，结果按记录计数', () => {
        const hits = searchGroups(' 顾此失彼 ');
        expect(hits).toHaveLength(2);
        expect(hits.flatMap(group => group.entries).map(entry => entry.word)).toEqual(['捉襟见肘', '顾此失彼', '左支右绌', '厚此薄彼', '顾此失彼']);
    });
    it('空白查询返回全部分组，正则元字符按字面检索', () => {
        expect(searchGroups('  ')).toBe(library.groups);
        expect(searchGroups('.*')).toHaveLength(0);
        expect(searchGroups('不存在的词条 987654321')).toHaveLength(0);
    });
    it('老师、日期和来源名称均可检索', () => {
        const file = library.files[0];
        for (const query of [file.teacher, file.date, file.label]) {
            const hits = searchGroups(query).flatMap(group => group.entries);
            expect(hits.filter(entry => entry.fileId === file.id)).toHaveLength(file.words);
        }
    });
    it('所有来源阅读数量一致，无效来源为空', () => {
        for (const file of library.files) expect(entriesForSource(file.id)).toHaveLength(file.words);
        expect(entriesForSource('missing')).toEqual([]);
    });
    it('11讲校订内容可按来源检索，跨讲同名词各自保留', () => {
        const files = library.files.filter(file => file.id.startsWith('video-'));
        expect(files).toHaveLength(11);
        expect(files.reduce((sum, file) => sum + file.words, 0)).toBe(library.groups
            .filter(group => group.id.startsWith('video-'))
            .reduce((sum, group) => sum + group.entries.length, 0));
        expect(new Set(files.map(file => file.teacher))).toEqual(new Set(['杨杨', '葛蓉']));
        for (const file of files) {
            const entries = entriesForSource(file.id).map(item => item.entry);
            expect(searchGroups(file.label).flatMap(group => group.entries)).toEqual(entries);
            expect(new Set(entries.map(entry => entry.word)).size).toBe(entries.length);
            expect(entries.every(entry => entry.fields['例句'].startsWith('【自拟例句】'))).toBe(true);
        }
        const repeated = searchGroups('登堂入室').flatMap(group => group.entries).filter(entry => entry.word === '登堂入室');
        expect(repeated.map(entry => entry.fileId)).toEqual(['video-18', 'video-21']);
    });
    it('易错词保留关键语义，不把速记误当成词义限制', () => {
        const word = (source, name) => entriesForSource(source).find(item => item.entry.word === name).entry.fields;
        expect(word('video-18', '鬼斧神工')['适用语境']).toContain('既可形容人工艺术');
        expect(word('video-19', '不绝如缕')['释义']).toContain('若断若续');
        expect(word('video-20', '文不加点')['记忆技巧']).toContain('不是标点');
        expect(word('video-20', '踌躇满志')['适用语境']).toContain('不限定即将成功');
        expect(word('video-21', '弱肉强食')['适用语境']).toContain('社会、国际关系');
        expect(word('video-21', '不刊之论')['记忆技巧']).toContain('削除、修改');
    });
    it('首页按系列与序号排列，名称只保留系列、序号与老师', () => {
        const titles = orderedSources.map(sourceTitle);
        const speech = titles.filter(title => title.startsWith('言语1000词-'));
        expect(speech.map(title => Number(title.match(/-(\d+)，/)[1]))).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
        expect(titles.slice(21)).toEqual(['高频实词-1，葛蓉', '高频实词-2，葛蓉', '高频实词-3，葛蓉']);
        expect(orderedSources.slice(21).map(file => file.id)).toEqual(['video-实词1', 'video-实词2', 'video-实词3']);
        expect(titles).toHaveLength(library.files.length);
        expect(sourceTitle(library.files[0])).toBe('言语1000词-1，野子');
    });
    it('来源可以首尾循环，不存在的来源保持空结果', () => {
        expect(adjacentSource(library.files, library.files[0].id, -1)).toBe(library.files.at(-1).id);
        expect(adjacentSource(library.files, library.files.at(-1).id, 1)).toBe(library.files[0].id);
        expect(adjacentSource([], 'missing', 1)).toBe(null);
        expect(adjacentSource(library.files, 'missing', 1)).toBe(null);
    });
    it('褒贬标签保留原始文案和优先级', () => {
        expect(toneInfo('【褒义词】')).toEqual({ label: '褒义词', tone: 'positive' });
        expect(toneInfo('【贬义词】').tone).toBe('negative');
        expect(toneInfo('').label).toBe('中性词');
    });
});

describe('安全文本高亮', () => {
    it('正则符号和重复命中均是原文字面片段', () => {
        expect(highlightParts('a.*B.*', '.*').filter(part => part.hit).map(part => part.text)).toEqual(['.*', '.*']);
        expect(highlightParts('ABC abc', 'abc').filter(part => part.hit).map(part => part.text)).toEqual(['ABC', 'abc']);
    });
    it('中文、空值与无匹配时仍保留完整原文', () => {
        expect(highlightParts(null, '')).toEqual([{ text: '', hit: false }]);
        expect(highlightParts('顾此失彼', '失彼').map(part => part.text).join('')).toBe('顾此失彼');
        expect(highlightParts('原始文本', '其他')).toEqual([{ text: '原始文本', hit: false }]);
    });
    it('HTML 字符作为文本显示，不产生可执行节点', () => {
        const wrapper = mount(HighlightedText, { props: { text: '<img src=x onerror=alert(1)> & 词语', query: '<img' } });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('mark').text()).toBe('<img');
        expect(wrapper.text()).toContain('onerror=alert(1)>');
    });
});
