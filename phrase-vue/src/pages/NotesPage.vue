<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import { Search, X, BookOpen } from '@lucide/vue';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import HighlightedText from '@/components/HighlightedText.vue';
import WordDetails from '@/components/WordDetails.vue';
import { library, searchGroups, toneInfo } from '@/lib/library';

const query = ref('');
const trimmed = computed(() => query.value.trim());
const groups = computed(() => searchGroups(query.value));
const total = computed(() => groups.value.reduce((sum, group) => sum + group.entries.length, 0));
const openGroups = ref([]);
const openWords = ref({});
// 使用同一套官方 multiple Accordion，普通阅读手动约束为单开，检索时展开所有命中。
watch(trimmed, value => {
    openGroups.value = value ? groups.value.map(group => group.id) : [];
    openWords.value = Object.fromEntries(groups.value.map(group => [group.id, value ? group.entries.map(entry => `${entry.fileId}:${entry.word}`) : []]));
});
function updateGroups(values) {
    openGroups.value = trimmed.value ? values : values.filter(value => !openGroups.value.includes(value)).slice(-1);
}
function updateWords(groupId, values) {
    const previous = openWords.value[groupId] ?? [];
    openWords.value[groupId] = trimmed.value ? values : values.filter(value => !previous.includes(value)).slice(-1);
}
async function clear() {
    query.value = '';
    await nextTick();
    document.getElementById('notes-search')?.focus();
}
</script>

<template>
    <div class="space-y-6" data-testid="notes-page">
        <div class="space-y-3"><p class="eyebrow">词语辨析 / VOCABULARY</p><h2 class="page-title">成语积累</h2><p class="text-sm leading-6 text-muted-foreground">在相近的词义之间，找到恰当的表达。</p></div>
        <div class="sticky top-16 z-10 -mx-1 space-y-3 bg-background/95 px-1 py-3 backdrop-blur-sm">
            <div class="flex gap-2">
                <div class="relative max-w-2xl flex-1"><Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="notes-search" v-model="query" type="search" class="h-10 pl-9 text-sm" aria-label="搜索词条" placeholder="搜索词条、释义、例句、老师或来源…" autocomplete="off" /></div>
                <Button v-if="query" variant="outline" class="h-10" aria-label="清除词条搜索" @click="clear"><X /><span class="hidden sm:inline">清除</span></Button>
            </div>
            <p class="text-xs text-muted-foreground" aria-live="polite" data-testid="notes-count">{{ trimmed ? `找到 ${total} 个词条 · ${groups.length} 个词组` : `共 ${library.stats.words} 个词条 · ${library.stats.groups} 个词组` }}</p>
        </div>
        <Card v-if="!groups.length"><CardContent class="flex flex-col items-center gap-3 py-16 text-center"><Search class="size-7 text-muted-foreground" /><h3 class="font-medium">未找到匹配的词条</h3><p class="max-w-lg break-all text-sm text-muted-foreground">“{{ trimmed }}”没有匹配结果，试试更短的词语或来源名称。</p><Button variant="outline" class="mt-2" @click="clear">清除搜索</Button></CardContent></Card>
        <Accordion v-else type="multiple" :model-value="openGroups" class="space-y-3" @update:model-value="updateGroups">
            <AccordionItem v-for="group in groups" :key="group.id" :value="group.id" class="border bg-card px-0 last:border-b" data-testid="note-group">
                <AccordionTrigger class="px-5 py-5 text-left hover:no-underline"><span class="flex min-w-0 flex-1 items-center gap-3"><BookOpen class="size-4 shrink-0 text-muted-foreground" /><span class="text-sm font-medium leading-6"><HighlightedText :text="group.title" :query="trimmed" /></span><Badge variant="secondary" class="ml-auto mr-3 shrink-0">{{ group.entries.length }} 词</Badge></span></AccordionTrigger>
                <AccordionContent class="pb-0">
                    <Accordion type="multiple" :model-value="openWords[group.id] ?? []" class="border-t" @update:model-value="value => updateWords(group.id, value)">
                        <AccordionItem v-for="entry in group.entries" :key="`${entry.fileId}:${entry.word}`" :value="`${entry.fileId}:${entry.word}`" class="border-b-0 border-t first:border-t-0" data-testid="word-entry">
                            <AccordionTrigger class="px-5 py-4 text-left hover:no-underline"><span class="min-w-0 flex-1 space-y-1"><span class="flex flex-wrap items-center gap-2"><span class="text-base font-semibold"><HighlightedText :text="entry.word" :query="trimmed" /></span><Badge variant="outline" :class="`tone-${toneInfo(entry.fields['日常用法']).tone}`">{{ toneInfo(entry.fields['日常用法']).label }}</Badge></span><span class="block pr-4 text-xs font-normal leading-6 text-muted-foreground"><HighlightedText :text="entry.fields['释义']" :query="trimmed" /></span></span></AccordionTrigger>
                            <AccordionContent class="border-t bg-muted/10 pb-0"><WordDetails :entry="entry" :query="trimmed" /></AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    </div>
</template>
