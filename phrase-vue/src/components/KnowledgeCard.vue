<script setup>
import { computed } from 'vue';
import { cardForEntry } from '@/lib/knowledge';
const props = defineProps({ entry: { type: Object, required: true } });
const card = computed(() => cardForEntry(props.entry));
const fields = ['readings', 'senses', 'origin', 'citations', 'synonyms', 'antonyms', 'confusables'];
const labels = { readings: '读音', senses: '词典义项', origin: '出处', citations: '书证', synonyms: '近义词', antonyms: '反义词', confusables: '易混辨析' };
function itemText(item) { return item.pinyin || item.definition || (item.difference ? `${item.word}：${item.difference}` : item.word) || [item.text, item.source].filter(Boolean).join(' — '); }
</script>
<template>
    <details v-if="card" class="border-t px-5 py-4" data-testid="knowledge-card"><summary class="cursor-pointer text-sm font-medium">知识卡 · {{ card.word }} · 读音、释义与辨析</summary><div class="mt-4 space-y-5"><section v-for="field in fields" :key="field" class="space-y-2"><h4 class="text-xs text-muted-foreground">{{ labels[field] }}</h4><p v-if="card[field].text" class="whitespace-pre-wrap text-sm leading-7">{{ card[field].text }}</p><p v-for="(item, i) in card[field].items ?? []" :key="i" class="whitespace-pre-wrap text-sm leading-7">{{ itemText(item) }}</p><p v-if="!card[field].text && !card[field].items?.length" class="text-xs text-muted-foreground">暂无内容</p><p class="break-words text-[11px] leading-6 text-muted-foreground">{{ card[field].provenance?.source_name }} · {{ card[field].provenance?.kind === 'derived' ? '整理归纳' : '来源摘录' }} · {{ card[field].provenance?.status }}{{ card[field].provenance?.note ? ` · ${card[field].provenance.note}` : '' }}</p></section><p class="text-xs leading-6 text-muted-foreground">{{ card.verification.note }}</p></div></details>
</template>
