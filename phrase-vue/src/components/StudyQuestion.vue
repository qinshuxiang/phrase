<script setup>
import { computed, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import QuestionText from './QuestionText.vue';
import { study, persist } from '@/lib/study-store';
const props = defineProps({ question: { type: Object, required: true }, choice: { type: Array, default: () => [] }, revealed: Boolean, locked: Boolean, showSubmit: { type: Boolean, default: true } });
const emit = defineEmits(['choose', 'submit']);
const q = computed(() => props.question);
const note = ref(''); const noteStatus = ref('');
watch(() => props.question.id, id => { note.value = study.data.notes[id] ?? ''; noteStatus.value = ''; }, { immediate: true });
const favorite = computed(() => study.data.favorites.includes(q.value.id));
async function toggleFavorite() {
    study.data.favorites = favorite.value ? study.data.favorites.filter(id => id !== q.value.id) : [...study.data.favorites, q.value.id]; await persist();
}
async function saveNote() {
    if (note.value.trim()) study.data.notes[q.value.id] = note.value; else delete study.data.notes[q.value.id];
    await persist(); noteStatus.value = study.storageWarning ? '已留在当前页面，请导出备份' : '笔记已保存';
}
const correct = computed(() => props.choice.length && q.value.answer.length === props.choice.length && q.value.answer.every(i => props.choice.includes(i)));
</script>
<template>
    <div class="space-y-4" data-testid="study-question">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="outline">{{ q.module }}</Badge><span data-testid="question-source">{{ q.paper }}{{ q.number ? ` · 第${q.number}题` : '' }}</span><Badge v-if="q.provenance.status !== 'verified'" variant="secondary">{{ q.provenance.status === 'missing' ? '缺答案' : '待核验' }}</Badge></div>
        <Card v-if="q.materialText"><CardContent class="p-5"><h3 class="mb-3 text-xs text-muted-foreground">共用材料</h3><QuestionText :text="q.materialText" data-testid="question-material" /></CardContent></Card>
        <Card><CardContent class="space-y-5 p-5 sm:p-7">
            <QuestionText :text="q.stem" class="text-base" data-testid="question-stem" />
            <div class="space-y-3"><div v-for="(option, i) in q.options" :key="i" class="flex min-w-0 items-start gap-3 border p-3" :class="[choice.includes(i) ? 'border-foreground bg-muted/50' : '', revealed && q.provenance.status === 'verified' && q.answer.includes(i) ? 'border-emerald-600' : '']"><Button :data-testid="`option-${i}`" variant="outline" :aria-label="`选择${String.fromCharCode(65 + i)}`" :aria-pressed="choice.includes(i)" :disabled="locked" class="shrink-0" @click="emit('choose', i)">{{ String.fromCharCode(65 + i) }}</Button><QuestionText :text="option" class="flex-1 text-sm" /></div></div>
            <Button v-if="showSubmit && !locked && !revealed" data-testid="submit-answer" :disabled="!choice.length" @click="emit('submit')">提交本题</Button>
        </CardContent></Card>
        <Card v-if="revealed" data-testid="question-feedback"><CardContent class="space-y-3 p-5">
            <h3 class="font-medium">{{ q.provenance.status !== 'verified' ? '本题不参与自动判分' : !choice.length ? '本题未答' : correct ? '回答正确' : '回答错误' }}</h3>
            <p>你的选择：{{ choice.length ? choice.map(i => String.fromCharCode(65 + i)).join('、') : '未答' }} · {{ q.provenance.status === 'verified' ? '正确答案' : '参考答案' }}：{{ q.answer.length ? q.answer.map(i => String.fromCharCode(65 + i)).join('、') : '暂无' }}</p>
            <p class="text-xs text-muted-foreground">来源：{{ q.provenance.name }} · {{ q.provenance.reason }}</p>
            <QuestionText :text="q.analysis || '暂无解析'" class="text-sm" />
        </CardContent></Card>
        <div class="flex flex-wrap gap-2"><Button variant="outline" data-testid="favorite" @click="toggleFavorite">{{ favorite ? '取消收藏' : '收藏本题' }}</Button></div>
        <div class="space-y-2"><label for="question-note" class="text-xs text-muted-foreground">个人笔记（纯文本）</label><textarea id="question-note" v-model="note" maxlength="100000" class="min-h-24 w-full border bg-background p-3 text-sm" placeholder="记录解题思路或易错点" @change="saveNote" /><div class="flex items-center gap-3"><Button variant="outline" size="sm" @click="saveNote">保存笔记</Button><span role="status" class="text-xs text-muted-foreground">{{ noteStatus }}</span></div></div>
    </div>
</template>
