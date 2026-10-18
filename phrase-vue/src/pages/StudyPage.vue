<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StudyQuestion from '@/components/StudyQuestion.vue';
import { drawPaper } from '@/lib/exam';
import { MODULES, studyStats } from '@/lib/study-model';
import { loadStudyIndex, loadPaper, loadExtension, loadExtensionIndex, resolveQuestions } from '@/lib/study-data';
import { study, persist, startStudy, resumeStudy, finishStudy, chooseAnswer, submitAnswer, exportStudy, restoreStudy } from '@/lib/study-store';

const props = defineProps({ view: { type: String, required: true } });
const emit = defineEmits(['navigate']);
const catalog = ref(null), error = ref(''), notice = ref('');
const module = ref(''), year = ref(''), size = ref(20), order = ref('random'), source = ref('main'), minutes = ref(120);
const reviewTab = ref('wrong'), reviewStatus = ref('pending'), reviewCategory = ref(''), reviewSearch = ref('');
const inspected = ref(null), abandonPending = ref(false), restorePending = ref(null), fileInput = ref(null);
const resultCursor = ref(0), now = ref(Date.now());
const target = computed(() => study.data.target);
const stat = computed(() => studyStats(study.data, target.value));
const recentAccuracy = computed(() => {
    const list = study.data.records.slice(0, 10).flatMap(r => r.outcomes).filter(o => o.category === target.value && o.answered && o.gradable);
    return list.length ? list.filter(o => o.correct).length / list.length : null;
});
const paperTypes = computed(() => [...new Set((catalog.value?.papers ?? []).filter(p => p.category === target.value).map(p => p.examType))]);
const papers = computed(() => (catalog.value?.papers ?? []).filter(p => p.category === target.value
    && (!study.data.examType || p.examType === study.data.examType) && (!year.value || p.year === Number(year.value))));
const years = computed(() => [...new Set((catalog.value?.papers ?? []).filter(p => p.category === target.value).map(p => p.year))].sort((a, b) => b - a));
const routeFor = session => session.mode === 'paper' ? 'papers' : session.mode === 'review' ? 'review' : 'practice';
const active = computed(() => study.data.active);
const running = computed(() => active.value && props.view === routeFor(active.value));
const result = computed(() => !active.value && study.lastRecord && props.view === routeFor(study.lastRecord) ? study.lastRecord : null);
const current = computed(() => running.value ? study.questions[active.value.cursor] : null);
const resultQuestion = computed(() => result.value ? study.questions[resultCursor.value] : null);
const seconds = computed(() => Math.max(0, Math.ceil(((active.value?.deadline ?? now.value) - now.value) / 1000)));
const pendingWrong = computed(() => Object.values(study.data.wrong).filter(w => !w.mastered && w.category === target.value).length);
const reviewIds = computed(() => {
    const ids = reviewTab.value === 'wrong' ? Object.keys(study.data.wrong) : reviewTab.value === 'favorites' ? study.data.favorites : Object.keys(study.data.notes);
    return ids.filter(id => {
        const q = reviewQuestions.value.find(q => q.id === id);
        const w = study.data.wrong[id];
        return q && (!module.value || q.module === module.value) && (!reviewCategory.value || (id.startsWith('legacy:') ? '言语扩展' : q.category) === reviewCategory.value)
            && (reviewTab.value !== 'wrong' || reviewStatus.value === 'all' || (reviewStatus.value === 'mastered' ? w.mastered : !w.mastered))
            && (!reviewSearch.value.trim() || `${q.stem}\n${study.data.notes[id] ?? ''}`.includes(reviewSearch.value.trim()));
    });
});
const reviewQuestions = ref([]);
const percent = value => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
const duration = value => `${Math.floor(value / 60000)}分${Math.floor(value / 1000) % 60}秒`;
const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
const names = { dashboard: '学习首页', practice: '专项练习', papers: '真题套卷', review: '错题与笔记', records: '学习记录' };

async function action(fn) {
    if (study.busy) return;
    study.busy = true; error.value = ''; notice.value = '';
    try { await fn(); } catch (e) { error.value = e?.message || String(e ?? '操作失败，请重试'); } finally { study.busy = false; }
}
async function bootstrap() {
    await action(async () => { catalog.value = await loadStudyIndex(); if (props.view === 'review') await refreshReview(); });
}
async function refreshReview() {
    const ids = [...new Set([...Object.keys(study.data.wrong), ...study.data.favorites, ...Object.keys(study.data.notes)])];
    reviewQuestions.value = ids.length ? await resolveQuestions(ids) : [];
}
function setTarget(value) { study.data.target = value; study.data.examType = ''; year.value = ''; persist(); }
function requireNoDraft() {
    if (!active.value) return true;
    notice.value = '已有未完成练习。请继续，或明确放弃后再开始。'; return false;
}
async function practice() {
    if (!requireNoDraft()) return;
    await action(async () => {
        let pool;
        if (source.value === 'extension') {
            const index = await loadExtensionIndex();
            pool = await loadExtension(year.value ? [Number(year.value)] : index.years.slice(-3).map(y => y.year));
        } else pool = (await Promise.all(papers.value.map(p => loadPaper(p.id)))).flat().filter(q => !module.value || q.module === module.value);
        const seed = new URLSearchParams(location.search).get('seed') || Date.now();
        const questions = order.value === 'random' ? drawPaper(pool, { count: Number(size.value), seed }).questions : pool.slice(0, Number(size.value));
        await startStudy(questions, { title: source.value === 'extension' ? '言语扩展练习' : `${target.value} · ${module.value || '六模块综合'}` });
        emit('navigate', 'practice');
    });
}
async function startPaper(paper) {
    if (!requireNoDraft()) return;
    if (!Number.isFinite(Number(minutes.value)) || minutes.value < 1 || minutes.value > 480) { error.value = '训练时长请输入1–480分钟'; return; }
    await action(async () => { await startStudy(await loadPaper(paper.id), { mode: 'paper', title: paper.title, minutes: Number(minutes.value) }); emit('navigate', 'papers'); });
}
async function resume() { await action(async () => { await resumeStudy(); emit('navigate', routeFor(active.value ?? study.lastRecord)); }); }
async function finish() { await action(async () => { await finishStudy(); resultCursor.value = 0; await refreshReview(); }); }
async function move(cursor) { active.value.cursor = cursor; await persist(); }
async function retry(ids) {
    if (!requireNoDraft()) return;
    await action(async () => { await startStudy(await resolveQuestions(ids), { mode: 'review', title: '错题与收藏复习' }); inspected.value = null; emit('navigate', 'review'); });
}
async function master(id) { study.data.wrong[id].mastered = !study.data.wrong[id].mastered; await persist(); }
async function openRecord(record) {
    if (active.value) { notice.value = '请先完成或放弃当前练习，再查看历史答题详情。'; return; }
    await action(async () => { study.questions = await resolveQuestions(record.questionIds); study.lastRecord = record; resultCursor.value = 0; emit('navigate', routeFor(record)); });
}
async function download() {
    await action(async () => {
        const blob = new Blob([JSON.stringify(await exportStudy(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `行测学习备份-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}
async function selectBackup(event) {
    await action(async () => {
        const file = event.target.files[0]; if (!file) return;
        if (file.size > 64 * 1024 * 1024) throw new Error('备份超过64MiB');
        restorePending.value = JSON.parse(await file.text());
    }); event.target.value = '';
}
async function confirmRestore() {
    await action(async () => { await restoreStudy(restorePending.value); restorePending.value = null; await refreshReview(); notice.value = '备份已恢复，包含未完成练习。'; });
}
watch(() => props.view, async value => { inspected.value = null; error.value = ''; notice.value = ''; if (value === 'review') await action(refreshReview); });
watch(() => study.lastRecord?.id, () => { resultCursor.value = 0; });
onMounted(bootstrap);
// 计时显示由本页维护；全局自动交卷在App中执行，切换页面不会暂停考试。
let timer;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => clearInterval(timer));
</script>

<template>
    <div class="space-y-6" data-testid="study-page" :aria-busy="study.busy">
        <div class="flex flex-wrap items-end justify-between gap-4"><div class="space-y-2"><p class="eyebrow">行测学习 / STUDY</p><h2 class="page-title">{{ names[view] }}</h2></div><div class="flex flex-wrap gap-2"><label class="text-xs">备考目标 <select :value="target" data-testid="target" class="ml-2 border bg-background p-2" @change="setTarget($event.target.value)"><option>山西</option><option>国考</option></select></label><label v-if="target === '国考'" class="text-xs">卷种 <select v-model="study.data.examType" class="ml-2 border bg-background p-2" aria-label="国考卷种" @change="persist"><option value="">全部卷种</option><option v-for="type in paperTypes" :key="type">{{ type }}</option></select></label></div></div>
        <p v-if="error" role="alert" class="border border-destructive p-4 text-sm text-destructive">{{ error }} <Button v-if="!catalog" variant="outline" @click="bootstrap">重新加载</Button></p>
        <p v-if="notice" role="status" class="border p-4 text-sm">{{ notice }}</p>
        <p v-if="study.busy" role="status" class="text-sm text-muted-foreground">正在处理，请稍候…</p>

        <template v-if="running">
            <div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="font-medium">{{ active.title }}</h3><p class="mt-2 text-xs text-muted-foreground" data-testid="session-progress">第 {{ active.cursor + 1 }} / {{ active.questionIds.length }} 题</p></div><div class="flex flex-wrap items-center gap-2"><Badge v-if="active.mode === 'paper'" data-testid="timer">剩余 {{ Math.floor(seconds / 60) }}:{{ String(seconds % 60).padStart(2, '0') }}</Badge><Button variant="outline" :disabled="study.busy" data-testid="finish-session" @click="finish">交卷并查看结果</Button></div></div>
            <template v-if="current">
                <StudyQuestion :key="current.id" :question="current" :choice="active.answers[current.id] ?? []" :revealed="active.mode !== 'paper' && Boolean(active.submitted[current.id])" :locked="active.mode !== 'paper' && Boolean(active.submitted[current.id])" :show-submit="active.mode !== 'paper'" @choose="i => chooseAnswer(current.id, i)" @submit="submitAnswer(current.id)" />
                <div class="flex flex-wrap justify-between gap-2"><Button variant="outline" :disabled="active.cursor === 0" @click="move(active.cursor - 1)">上一题</Button><Button variant="outline" @click="active.flags[current.id] = !active.flags[current.id]; persist()">{{ active.flags[current.id] ? '取消待检查' : '标记待检查' }}</Button><Button v-if="active.cursor + 1 < active.questionIds.length" data-testid="next-question" @click="move(active.cursor + 1)">{{ active.answers[current.id]?.length ? '下一题' : '跳过本题' }}</Button><Button v-else :disabled="study.busy" @click="finish">交卷</Button></div>
            </template>
            <Button v-else :disabled="study.busy" @click="resume">载入并继续作答</Button>
            <details class="border p-4" :open="active.mode === 'paper'"><summary class="cursor-pointer text-sm">答题卡 · 已选答案 {{ Object.values(active.answers).filter(a => a.length).length }} / {{ active.questionIds.length }}</summary><div class="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10"><Button v-for="(id, i) in active.questionIds" :key="id" size="sm" :variant="active.cursor === i ? 'default' : 'outline'" :aria-label="`转到第${i + 1}题`" :aria-current="active.cursor === i ? 'step' : undefined" @click="move(i)">{{ i + 1 }}{{ active.flags[id] ? '★' : active.answers[id]?.length ? '✓' : '' }}</Button></div></details>
        </template>

        <template v-else-if="result">
            <Card data-testid="session-result"><CardContent class="space-y-4 p-6"><h3 class="text-xl font-semibold">{{ result.title }} · 练习结果</h3><div class="grid grid-cols-2 gap-4 sm:grid-cols-4"><p>总题数 <strong>{{ result.total }}</strong></p><p>可判分 <strong>{{ result.gradable }}</strong></p><p>答对 <strong>{{ result.correct }}</strong></p><p>正确率 <strong>{{ percent(result.accuracy) }}</strong></p></div><p class="text-sm text-muted-foreground">已答 {{ result.answered }} · 未答 {{ result.total - result.answered }} · 待核验或缺答案 {{ result.total - result.gradable }} · 用时 {{ duration(result.duration) }}。正确率以全部可判分题为分母，未答计入分母；不是官方分数。</p><Button @click="study.lastRecord = null">返回{{ names[view] }}</Button></CardContent></Card>
            <div class="flex items-center justify-between gap-3"><Button variant="outline" :disabled="resultCursor === 0" @click="resultCursor--">上一题</Button><span class="text-sm">{{ resultCursor + 1 }} / {{ result.total }}</span><Button variant="outline" :disabled="resultCursor + 1 >= result.total" @click="resultCursor++">下一题</Button></div>
            <StudyQuestion v-if="resultQuestion" :key="resultQuestion.id" :question="resultQuestion" :choice="result.answers[resultQuestion.id] ?? []" revealed locked />
        </template>

        <template v-else>
            <Card v-if="active"><CardContent class="flex flex-wrap items-center gap-3 p-5"><div class="mr-auto"><p class="font-medium">未完成：{{ active.title }}</p><p class="mt-1 text-xs text-muted-foreground">已自动保存 · 第 {{ active.cursor + 1 }} 题</p></div><Button :disabled="study.busy" data-testid="resume" @click="resume">继续练习</Button><Button variant="outline" @click="abandonPending = true">放弃草稿</Button><div v-if="abandonPending" class="w-full border-t pt-3 text-sm">放弃后不产生练习成绩。<Button variant="destructive" class="ml-2" @click="study.data.active = null; study.questions = []; abandonPending = false; persist()">确认放弃</Button><Button variant="ghost" @click="abandonPending = false">取消</Button></div></CardContent></Card>

            <template v-if="view === 'dashboard'">
                <p class="text-sm text-muted-foreground">以真题练习带动积累，从六个模块看见自己的进步。</p>
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card v-for="item in [{ label: '已练不同题数', value: stat.studied }, { label: '待复习错题', value: pendingWrong }, { label: '近期正确率', value: percent(recentAccuracy) }, { label: '累计练习用时', value: duration(stat.duration) }]" :key="item.label"><CardContent class="p-5"><p class="text-xs text-muted-foreground">{{ item.label }}</p><p class="mt-4 text-2xl font-medium">{{ item.value }}</p></CardContent></Card></div>
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Card v-for="item in stat.modules" :key="item.module"><CardContent class="space-y-4 p-5"><h3 class="font-medium">{{ item.module }}</h3><p class="text-xs text-muted-foreground">已练 {{ item.studied }} 题 · 正确率 {{ percent(item.attempts ? item.correct / item.attempts : null) }}</p><Button variant="outline" @click="module = item.module; source = 'main'; emit('navigate', 'practice')">进入专项</Button></CardContent></Card></div>
                <div class="flex flex-wrap gap-3"><Button @click="emit('navigate', 'papers')">选择真题套卷</Button><Button variant="outline" @click="emit('navigate', 'review')">复习错题</Button><Button variant="outline" @click="emit('navigate', 'knowledge')">言语知识库</Button></div>
                <p v-if="catalog" class="text-xs leading-6 text-muted-foreground">主库 {{ catalog.stats.papers }} 套 / {{ catalog.stats.questions }} 题；已核验 {{ catalog.stats.verified }}，待核验 {{ catalog.stats.pending }}，缺答案 {{ catalog.stats.missing }}。待核验题保留参考答案，不参与自动判分。另有 {{ catalog.pendingPdfs.length }} 份旧山西PDF待整理。</p>
            </template>

            <template v-if="view === 'practice' || view === 'papers'">
                <Card><CardContent class="flex flex-wrap items-end gap-4 p-5">
                    <label v-if="view === 'practice'" class="grid gap-2 text-xs">题源<select v-model="source" aria-label="题源" class="border bg-background p-2" @change="year = ''; module = ''"><option value="main">国考与山西主题库</option><option value="extension">独立言语扩展题源</option></select></label>
                    <label v-if="view === 'practice' && source === 'main'" class="grid gap-2 text-xs">模块<select v-model="module" aria-label="练习模块" class="border bg-background p-2"><option value="">全部模块</option><option v-for="m in MODULES" :key="m">{{ m }}</option></select></label>
                    <label class="grid gap-2 text-xs">年份<select v-model="year" aria-label="年份" class="border bg-background p-2"><option value="">{{ source === 'extension' && view === 'practice' ? '最近三年' : '全部年份' }}</option><option v-for="y in source === 'extension' && view === 'practice' ? Array.from({ length: 11 }, (_, i) => 2026 - i) : years" :key="y">{{ y }}</option></select></label>
                    <template v-if="view === 'practice'"><label class="grid gap-2 text-xs">题量<select v-model="size" aria-label="练习题量" class="border bg-background p-2"><option v-for="n in [10, 20, 30, 50]" :key="n" :value="n">{{ n }}</option></select></label><label class="grid gap-2 text-xs">顺序<select v-model="order" aria-label="出题顺序" class="border bg-background p-2"><option value="random">随机抽题</option><option value="ordered">按原卷顺序</option></select></label><Button data-testid="start-practice" :disabled="study.busy || !catalog" @click="practice">开始练习</Button></template>
                    <label v-else class="grid gap-2 text-xs">训练时长（分钟，非官方时限）<input v-model.number="minutes" aria-label="训练时长" type="number" min="1" max="480" class="w-36 border bg-background p-2" /></label>
                </CardContent></Card>
                <p v-if="view === 'practice' && source === 'extension'" class="text-xs text-muted-foreground">原言语题源跨地区独立练习，不混入主库。统计按题目实际地区记录。</p>
                <div v-if="view === 'papers'" class="grid gap-4 lg:grid-cols-2"><Card v-for="p in papers" :key="p.id"><CardContent class="space-y-4 p-5"><h3 class="text-sm leading-7">{{ p.title }}</h3><p class="text-xs text-muted-foreground">{{ p.questionCount }}题 · 可判分 {{ p.verified }}题 · {{ p.examType }}</p><div class="flex flex-wrap gap-2"><Badge v-for="m in p.modules" :key="m.name" variant="outline">{{ m.name }} {{ m.count }}</Badge></div><Button :data-testid="`paper-${p.id}`" :disabled="study.busy" @click="startPaper(p)">开始套卷</Button></CardContent></Card><p v-if="!papers.length">当前筛选没有试卷。</p></div>
            </template>

            <template v-if="view === 'review'">
                <div class="flex flex-wrap gap-2"><Button v-for="tab in [{ id: 'wrong', label: '错题本' }, { id: 'favorites', label: '收藏题' }, { id: 'notes', label: '个人笔记' }]" :key="tab.id" :variant="reviewTab === tab.id ? 'default' : 'outline'" :data-testid="`review-${tab.id}`" @click="reviewTab = tab.id; inspected = null">{{ tab.label }}</Button></div>
                <div class="flex flex-wrap gap-3"><select v-model="module" aria-label="复习模块" class="border bg-background p-2 text-sm"><option value="">全部模块</option><option v-for="m in MODULES" :key="m">{{ m }}</option></select><select v-model="reviewCategory" aria-label="复习来源" class="border bg-background p-2 text-sm"><option value="">全部来源</option><option>山西</option><option>国考</option><option>言语扩展</option></select><select v-if="reviewTab === 'wrong'" v-model="reviewStatus" aria-label="掌握状态" class="border bg-background p-2 text-sm"><option value="pending">待复习</option><option value="mastered">已掌握</option><option value="all">全部状态</option></select><input v-model="reviewSearch" aria-label="搜索题目与笔记" placeholder="搜索题干或笔记" class="min-w-0 border bg-background p-2 text-sm" /></div>
                <Button :disabled="!reviewIds.length || study.busy" @click="retry(reviewIds)">重做当前筛选（{{ reviewIds.length }}题）</Button>
                <template v-if="inspected"><Button variant="outline" @click="inspected = null">返回列表</Button><StudyQuestion :question="inspected" revealed locked /><Button v-if="study.data.wrong[inspected.id]" variant="outline" @click="master(inspected.id)">{{ study.data.wrong[inspected.id].mastered ? '移回待复习' : '标记已掌握' }}</Button><Button @click="retry([inspected.id])">重做本题</Button></template>
                <div v-else class="space-y-3"><p v-if="!reviewIds.length" class="py-8 text-sm text-muted-foreground">当前筛选暂无题目。练习中答错、收藏或保存笔记后会出现在这里。</p><Card v-for="id in reviewIds" :key="id" :data-testid="`review-item-${id}`"><CardContent class="p-4"><Button variant="ghost" class="h-auto w-full justify-start whitespace-normal text-left" @click="inspected = reviewQuestions.find(q => q.id === id)">{{ reviewQuestions.find(q => q.id === id)?.stem.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]').slice(0, 120) }}</Button><p class="mt-2 text-xs text-muted-foreground">{{ reviewQuestions.find(q => q.id === id)?.module }} · {{ study.data.wrong[id] ? `累计答错${study.data.wrong[id].count}次 · ${study.data.wrong[id].mastered ? '已掌握' : '待复习'}` : '已收藏或有笔记' }}</p><p v-if="study.data.notes[id]" class="mt-3 whitespace-pre-wrap break-words text-sm">{{ study.data.notes[id] }}</p></CardContent></Card></div>
            </template>

            <template v-if="view === 'records'">
                <div class="flex flex-wrap gap-3"><Button data-testid="export-backup" @click="download">导出学习记录</Button><Button variant="outline" @click="fileInput.click()">恢复备份</Button><input ref="fileInput" data-testid="backup-input" type="file" accept=".json,application/json" class="hidden" @change="selectBackup" /></div>
                <p class="text-xs leading-6 text-muted-foreground">备份包含成绩、错题、收藏、笔记和未完成练习。更换离线文件路径或浏览器后，请恢复备份。</p>
                <Card v-if="restorePending"><CardContent class="space-y-3 p-5"><p>恢复将替换当前学习记录。建议先导出当前档案；文件经结构与题目引用校验后才会写入。</p><Button :disabled="study.busy" data-testid="confirm-restore" @click="confirmRestore">校验并恢复</Button><Button variant="ghost" @click="restorePending = null">取消</Button></CardContent></Card>
                <div class="grid gap-3 sm:grid-cols-2"><Card v-for="m in stat.modules" :key="m.module"><CardContent class="p-4 text-sm">{{ m.module }} · 已练{{ m.studied }}题 · 有效作答{{ m.attempts }}次 · 正确率{{ percent(m.attempts ? m.correct / m.attempts : null) }}</CardContent></Card></div>
                <h3 class="font-medium">练习历史（{{ study.data.records.length }}）</h3><p v-if="!study.data.records.length" class="text-sm text-muted-foreground">完成练习后查看成绩与逐题回顾。</p><Card v-for="record in study.data.records" :key="record.id"><CardContent class="flex flex-wrap items-center gap-3 p-5"><div class="mr-auto min-w-0"><p class="break-words text-sm">{{ record.title }}</p><p class="mt-2 text-xs text-muted-foreground">{{ date(record.finishedAt) }} · {{ record.total }}题 · 可判分{{ record.gradable }}题 · {{ percent(record.accuracy) }} · {{ duration(record.duration) }}</p></div><Button variant="outline" @click="openRecord(record)">逐题回顾</Button></CardContent></Card>
                <details v-if="study.data.legacyHistory.length" class="border p-4"><summary>旧版汇总成绩 {{ study.data.legacyHistory.length }}条（不计入新模块统计）</summary><p v-for="record in study.data.legacyHistory" :key="record.id" class="mt-3 text-sm">{{ record.at }} · {{ record.size }}题 · {{ percent(record.accuracy) }}</p></details>
                <details v-if="catalog" class="border p-4"><summary>资料整理清单 · {{ catalog.pendingPdfs.length }}份PDF待入库</summary><p v-for="pdf in catalog.pendingPdfs" :key="pdf" class="mt-2 break-words text-xs">{{ pdf }}</p></details>
            </template>
        </template>
    </div>
</template>
