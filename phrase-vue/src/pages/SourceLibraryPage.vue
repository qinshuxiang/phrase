<script setup>
import { computed, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, BookOpen, Files, Layers, Users, ChevronLeft, ChevronRight } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import WordDetails from '@/components/WordDetails.vue';
import { library, entriesForSource, fileById, adjacentSource, orderedSources, sourceTitle } from '@/lib/library';

const props = defineProps({ reset: { type: Number, default: 0 } });
const sourceId = ref(null);
const index = ref(0);
const source = computed(() => fileById[sourceId.value]);
const items = computed(() => entriesForSource(sourceId.value));
const current = computed(() => items.value[index.value]);
const maxWords = Math.max(1, ...library.files.map(file => file.words));
const stats = [
    { label: '笔记文件', value: library.stats.files, unit: '份', icon: Files, caption: '沿着来源，回到课堂' },
    { label: '主题词组', value: library.stats.groups, unit: '组', icon: Layers, caption: '在相近语义之间辨析' },
    { label: '词条总数', value: library.stats.words, unit: '条', icon: BookOpen, caption: '每个词，都有具体语境' },
    { label: '授课老师', value: library.stats.teachers, unit: '位', icon: Users, caption: [...new Set(library.files.map(file => file.teacher))].join(' / ') },
];
watch(() => props.reset, () => { sourceId.value = null; index.value = 0; });
function openSource(id) { sourceId.value = id; index.value = 0; }
function switchSource(offset) { openSource(adjacentSource(orderedSources, sourceId.value, offset)); }
</script>

<template>
    <div v-if="source" class="space-y-6" data-testid="source-reader">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" class="-ml-2" @click="sourceId = null"><ArrowLeft />返回全部来源</Button>
            <Badge variant="outline">{{ source.date }} · {{ source.teacher }}</Badge>
        </div>
        <div class="flex flex-wrap items-end justify-between gap-4">
            <div class="space-y-2"><p class="eyebrow">来源阅读 / SOURCE</p><h2 class="page-title">{{ sourceTitle(source) }}</h2></div>
            <p class="text-sm text-muted-foreground" aria-live="polite" data-testid="source-position">第 {{ items.length ? index + 1 : 0 }} / {{ items.length }} 个</p>
        </div>
        <Card v-if="current" class="overflow-hidden py-0" data-testid="source-word">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-6">
                <h3 class="text-2xl font-semibold tracking-tight">{{ current.entry.word }}</h3>
                <Badge variant="secondary">{{ current.group.title }}</Badge>
            </div>
            <WordDetails :entry="current.entry" />
        </Card>
        <Card v-else><CardContent class="py-12 text-center text-muted-foreground">该来源暂无词条。</CardContent></Card>
        <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <div class="flex gap-2">
                <Button variant="outline" size="sm" :disabled="library.files.length < 2" @click="switchSource(-1)"><ChevronLeft />上一个来源</Button>
                <Button variant="outline" size="sm" :disabled="library.files.length < 2" @click="switchSource(1)">下一个来源<ChevronRight /></Button>
            </div>
            <div class="flex gap-2">
                <Button variant="outline" size="sm" :disabled="index === 0 || !current" @click="index--"><ArrowLeft />上一个</Button>
                <Button size="sm" :disabled="index >= items.length - 1 || !current" @click="index++">下一个<ArrowRight /></Button>
            </div>
        </div>
    </div>
    <div v-else class="space-y-8" data-testid="dashboard">
        <div class="flex flex-wrap items-end justify-between gap-5">
            <div class="space-y-3"><p class="eyebrow">学习档案 / OVERVIEW</p><h2 class="page-title">词汇总览</h2><p class="text-sm leading-6 text-muted-foreground">从一份笔记开始，把词语放回语境。</p></div>
            <Badge variant="outline" class="gap-2 py-1.5"><span class="size-1.5 bg-emerald-600 dark:bg-emerald-400" />全部内容已收录</Badge>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card v-for="stat in stats" :key="stat.label" class="gap-0 py-0">
                <CardContent class="p-5">
                    <div class="flex items-center justify-between text-xs text-muted-foreground"><span>{{ stat.label }}</span><component :is="stat.icon" class="size-4" :stroke-width="1.5" /></div>
                    <p class="my-5 flex items-baseline gap-2"><span class="text-4xl font-medium tracking-tighter" data-testid="stat-value">{{ stat.value }}</span><span class="text-xs text-muted-foreground">{{ stat.unit }}</span></p>
                    <p class="border-t pt-3 text-[11px] leading-5 text-muted-foreground">{{ stat.caption }}</p>
                </CardContent>
            </Card>
        </div>
        <section class="space-y-4" aria-labelledby="sources-title">
            <div class="flex items-center justify-between"><div class="flex items-center gap-3"><h3 id="sources-title" class="text-base font-semibold">笔记来源</h3><Badge variant="secondary">{{ library.files.length }}</Badge></div><span class="text-xs text-muted-foreground">选择一份笔记，开始逐词阅读</span></div>
            <div class="overflow-hidden border bg-card">
                <Table>
                    <TableHeader><TableRow class="bg-muted/40"><TableHead class="w-14 pl-5">序号</TableHead><TableHead>笔记名称</TableHead><TableHead class="hidden sm:table-cell">老师 / 日期</TableHead><TableHead class="w-28">词条</TableHead><TableHead class="w-12"><span class="sr-only">阅读</span></TableHead></TableRow></TableHeader>
                    <TableBody>
                        <TableRow v-for="(file, position) in orderedSources" :key="file.id" class="group">
                            <TableCell class="pl-5 text-xs text-muted-foreground">{{ String(position + 1).padStart(2, '0') }}</TableCell>
                            <TableCell><Button variant="link" class="h-auto justify-start whitespace-normal p-0 text-left text-sm font-medium" :data-testid="`source-${file.id}`" @click="openSource(file.id)">{{ sourceTitle(file) }}</Button><p class="mt-1 text-xs text-muted-foreground sm:hidden">{{ file.teacher }} · {{ file.date }}</p></TableCell>
                            <TableCell class="hidden py-4 text-xs sm:table-cell"><p>{{ file.teacher }}</p><p class="mt-1 text-muted-foreground">{{ file.date }}</p></TableCell>
                            <TableCell><div class="space-y-2"><span class="text-xs">{{ file.words }} 词</span><Progress :model-value="file.words / maxWords * 100" class="h-1" :aria-label="`${sourceTitle(file)}的词条数量占最大来源的比例`" /></div></TableCell>
                            <TableCell><Button variant="ghost" size="icon-sm" :aria-label="`阅读${sourceTitle(file)}`" @click="openSource(file.id)"><ArrowRight class="size-4" /></Button></TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </section>
        <p class="border-t pt-4 text-xs leading-6 text-muted-foreground">原笔记与视频校订稿按分组和来源收录。同名词在不同课程中的记录分别保留；视频校订稿的例句均标明为自拟。</p>
    </div>
</template>
