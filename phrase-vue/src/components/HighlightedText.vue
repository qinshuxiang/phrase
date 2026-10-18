<script setup>
import { computed } from 'vue';
import { highlightParts } from '@/lib/library';

const props = defineProps({ text: { type: [String, Number], default: '' }, query: { type: String, default: '' } });
const parts = computed(() => highlightParts(props.text, props.query));
</script>

<template>
    <template v-for="(part, index) in parts" :key="index"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
</template>
