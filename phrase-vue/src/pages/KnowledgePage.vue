<script setup>
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import SourceLibraryPage from './SourceLibraryPage.vue';
import NotesPage from './NotesPage.vue';
import { library } from '@/lib/library';
import { knowledgeStats } from '@/lib/knowledge';
const tab = ref('sources');
const reset = ref(0);
</script>
<template>
    <div class="space-y-6"><div><p class="eyebrow">言语理解与表达 / KNOWLEDGE</p><h2 class="page-title mt-2">言语知识库</h2><p class="mt-3 text-sm text-muted-foreground">{{ library.stats.words }}条词汇记录 · {{ knowledgeStats.cards }}张知识卡 · 保留原笔记、视频校订与来源。新增词条尚无知识卡时仍保留原笔记。其他模块可在题目下记录自己的方法。</p></div><div class="flex gap-2"><Button :variant="tab === 'sources' ? 'default' : 'outline'" data-testid="knowledge-sources" @click="tab === 'sources' ? reset++ : tab = 'sources'">按来源阅读</Button><Button :variant="tab === 'notes' ? 'default' : 'outline'" data-testid="knowledge-search" @click="tab = 'notes'">分组与全文搜索</Button></div><KeepAlive><SourceLibraryPage v-if="tab === 'sources'" :reset="reset" /><NotesPage v-else /></KeepAlive></div>
</template>
