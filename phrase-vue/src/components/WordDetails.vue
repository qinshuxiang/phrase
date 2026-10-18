<script setup>
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import HighlightedText from '@/components/HighlightedText.vue';
import KnowledgeCard from '@/components/KnowledgeCard.vue';
import { fieldOrder, fileById, toneInfo } from '@/lib/library';

const props = defineProps({ entry: { type: Object, required: true }, query: { type: String, default: '' } });
const source = computed(() => fileById[props.entry.fileId]);
const tone = computed(() => toneInfo(props.entry.fields['日常用法']));
</script>

<template>
    <div class="flex items-center gap-2 border-b px-5 py-3">
        <Badge variant="outline" :class="`tone-${tone.tone}`">{{ tone.label }}</Badge>
        <span class="text-xs text-muted-foreground">{{ source?.date }} · {{ source?.teacher }}</span>
    </div>
    <dl class="divide-y">
        <div v-for="field in fieldOrder" :key="field" class="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 px-5 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <dt class="pt-0.5 text-xs text-muted-foreground">{{ field }}</dt>
            <dd class="min-w-0 whitespace-pre-line text-sm leading-7"><HighlightedText :text="entry.fields[field]" :query="query" /></dd>
        </div>
        <div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 px-5 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <dt class="pt-0.5 text-xs text-muted-foreground">笔记来源</dt>
            <dd class="min-w-0 text-xs leading-6 text-muted-foreground"><HighlightedText :text="[source?.label, source?.date, source?.teacher].filter(Boolean).join(' · ')" :query="query" /></dd>
        </div>
    </dl>
    <KnowledgeCard :entry="entry" />
</template>
