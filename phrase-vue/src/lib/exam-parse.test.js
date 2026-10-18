import { describe, expect, it } from 'vitest';
import { cleanText, parsePaper } from './exam-parse.js';

function paper(body, meta = {}) {
    const front = Object.entries({
        类型: '真题', 试卷: '测试卷', 地区: '山西', 年份: '2024', 模块: '言语理解与表达', 题数: '1', ...meta,
    }).map(([key, value]) => `${key}: "${value}"`).join('\n');
    return `---\n${front}\n---\n\n# 测试卷\n\n${body}`;
}

const option = (letter, text, correct = false) => `- **${letter}**. ${text}${correct ? '　✅' : ''}`;

describe('cleanText', () => {
    it('转换块级标签并解码实体', () => {
        expect(cleanText('<p>第一段&amp;内容</p><p>第二段&nbsp;&lt;b&gt;</p>'))
            .toBe('第一段&内容\n第二段 <b>');
    });

    it('保留连续空白作为填空标记', () => {
        expect(cleanText('一个\u00a0\u00a0\u00a0\u00a0过程')).toBe('一个\u3000\u3000过程');
    });

    it('丢弃图片标签', () => {
        expect(cleanText('文字<img src="x.png" />接续')).toBe('文字接续');
    });
});

describe('parsePaper', () => {
    it('解析标准单选题', () => {
        const { paper: meta, questions, skipped } = parsePaper(paper(`## 第 1 题　<sub>qid 1001 · 逻辑填空</sub>

这是一个足够长的测试题干，用于验证解析。

${option('A', '甲')}
${option('B', '乙')}
${option('C', '丙', true)}
${option('D', '丁')}

**答案**：C

**官方解析**

解析第一段。
解析第二段。
`));
        expect(meta.year).toBe(2024);
        expect(skipped.invalid).toBe(0);
        expect(questions).toHaveLength(1);
        expect(questions[0]).toMatchObject({
            qid: '1001', type: '逻辑填空', options: ['甲', '乙', '丙', '丁'], answer: [2],
        });
        expect(questions[0].analysis).toContain('解析第二段');
    });

    it('缺少答案行时用 ✅ 兜底', () => {
        const { questions } = parsePaper(paper(`## 第 1 题　<sub>qid 1002 · 片段阅读</sub>

题干长度足够用于测试。

${option('A', '甲', true)}
${option('B', '乙')}
`));
        expect(questions[0].answer).toEqual([0]);
    });

    it('支持多选答案', () => {
        const { questions } = parsePaper(paper(`## 第 1 题　<sub>qid 1003 · 语句表达</sub>

题干长度足够用于测试。

${option('A', '甲')}
${option('B', '乙')}
${option('C', '丙')}

**答案**：A、C
`));
        expect(questions[0].answer).toEqual([0, 2]);
    });

    it('支持选项数量不为四', () => {
        const { questions } = parsePaper(paper(`## 第 1 题　<sub>qid 1004 · 语句表达</sub>

题干长度足够用于测试。

${option('A', '甲')}
${option('B', '乙')}
${option('C', '丙')}

**答案**：B
`));
        expect(questions[0].options).toHaveLength(3);
    });

    it('共享材料正文', () => {
        const { materials, questions } = parsePaper(paper(`## 材料 1

材料正文足够长，供两道小题共用。

### 第 1 题　<sub>qid 1005 · 片段阅读</sub>

第一道小题的题干长度足够。

${option('A', '甲', true)}
${option('B', '乙')}

**答案**：A

---

### 第 2 题　<sub>qid 1006 · 片段阅读</sub>

第二道小题的题干长度足够。

${option('A', '甲')}
${option('B', '乙', true)}

**答案**：B
`));
        expect(Object.keys(materials)).toEqual(['m1']);
        expect(materials.m1).toContain('材料正文');
        expect(questions.map(item => item.material)).toEqual(['m1', 'm1']);
    });

    it('跳过含图题干，但保留仅解析含图的题', () => {
        const imageStem = parsePaper(paper(`## 第 1 题　<sub>qid 1007 · 语句表达</sub>

题干需要看图 <img src="a.png" /> 才能作答。

${option('A', '甲')}
${option('B', '乙')}

**答案**：A
`));
        expect(imageStem.questions).toHaveLength(0);
        expect(imageStem.skipped.image).toBe(1);

        const imageAnalysis = parsePaper(paper(`## 第 1 题　<sub>qid 1008 · 片段阅读</sub>

题干本身不依赖图片即可作答。

${option('A', '甲', true)}
${option('B', '乙')}

**答案**：A

**官方解析**

解析中含公式 <img src="f.png" /> 但不影响题目。
`));
        expect(imageAnalysis.questions).toHaveLength(1);
        expect(imageAnalysis.questions[0].analysis).not.toContain('<img');
    });

    it('答案字母越界时丢弃', () => {
        const { questions, skipped } = parsePaper(paper(`## 第 1 题　<sub>qid 1009 · 语句表达</sub>

题干长度足够用于测试。

${option('A', '甲')}
${option('B', '乙')}

**答案**：D
`));
        expect(questions).toHaveLength(0);
        expect(skipped.invalid).toBe(1);
    });

    it('同一文件内 qid 去重', () => {
        const block = number => `## 第 ${number} 题　<sub>qid 1010 · 逻辑填空</sub>

重复题目的题干长度足够。

${option('A', '甲', true)}
${option('B', '乙')}

**答案**：A
`;
        const { questions, skipped } = parsePaper(paper(block(1) + block(2)));
        expect(questions).toHaveLength(1);
        expect(skipped.duplicate).toBe(1);
    });

    it('模块不符时返回空题目', () => {
        const { questions } = parsePaper(paper(`## 第 1 题　<sub>qid 1011 · 逻辑填空</sub>

题干长度足够用于测试。

${option('A', '甲', true)}
${option('B', '乙')}

**答案**：A
`), { module: '判断推理' });
        expect(questions).toHaveLength(0);
    });
});
