<script setup>
import { computed, ref } from 'vue';
import { studyImage } from '@/lib/study-data';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
defineOptions({ inheritAttrs: false });
const props = defineProps({ text: { type: String, default: '' } });
const zoom = ref('');
let trigger;
function openImage(url, event) { trigger = event.currentTarget; zoom.value = url; }
function restoreFocus(event) { event.preventDefault(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }
const parts = computed(() => {
    const result = []; let cursor = 0;
    for (const match of props.text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
        if (match.index > cursor) result.push({ text: props.text.slice(cursor, match.index) });
        result.push({ image: studyImage(match[2]), alt: match[1] || '题目图片，点击放大' });
        cursor = match.index + match[0].length;
    }
    if (cursor < props.text.length) result.push({ text: props.text.slice(cursor) });
    return result;
});
</script>
<template>
    <div v-bind="$attrs" class="min-w-0 whitespace-pre-wrap break-words leading-8">
        <template v-for="(part, i) in parts" :key="i"><span v-if="part.text">{{ part.text }}</span><button v-else-if="part.image" type="button" class="my-2 inline-block max-w-full cursor-zoom-in align-middle" :aria-label="part.alt" @click.stop="openImage(part.image, $event)"><img :src="part.image" :alt="part.alt" loading="lazy" class="max-h-96 max-w-full object-contain dark:bg-white" /></button><span v-else class="text-destructive">图片缺失</span></template>
    </div>
    <Sheet :open="Boolean(zoom)" @update:open="open => { if (!open) zoom = ''; }"><SheetContent side="bottom" class="h-[85dvh] overflow-auto" @close-auto-focus="restoreFocus"><SheetHeader><SheetTitle>题目图片 · 可滚动查看</SheetTitle></SheetHeader><div class="overflow-auto p-5"><img :src="zoom" alt="放大的题目图片" class="mx-auto max-w-none bg-white" /></div></SheetContent></Sheet>
</template>
