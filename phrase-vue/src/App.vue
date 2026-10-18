<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Moon, Sun } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import AppSidebar from '@/components/AppSidebar.vue';
import StudyPage from '@/pages/StudyPage.vue';
import KnowledgePage from '@/pages/KnowledgePage.vue';
import { useTheme } from '@/composables/useTheme';
import { study, initStudy, resumeStudy, finishStudy } from '@/lib/study-store';

const { dark, toggleTheme } = useTheme();
const titles = { dashboard: '学习首页', practice: '专项练习', papers: '真题套卷', review: '错题与笔记', knowledge: '言语知识库', records: '学习记录' };
function route() { const id = location.hash.replace(/^#\/?/, ''); return titles[id] ? id : 'dashboard'; }
const view = ref(route());
const title = computed(() => titles[view.value]);
function navigate(next) { if (titles[next]) { view.value = next; location.hash = `/${next}`; } }
function hashChange() { view.value = route(); }
function focusContent() { document.getElementById('main-content')?.focus(); }
let timer, failedDeadline;
onMounted(async () => {
    window.addEventListener('hashchange', hashChange);
    await initStudy();
    if (study.data.active) try { await resumeStudy(); } catch (error) { study.error = error.message; }
    timer = setInterval(async () => {
        const session = study.data.active;
        if (!study.busy && session?.deadline && Date.now() >= session.deadline && failedDeadline !== session.id) {
            try { await finishStudy(); } catch (error) { failedDeadline = session.id; study.error = `自动交卷未完成：${error.message}，请重新载入草稿。`; }
        }
    }, 1000);
});
onUnmounted(() => { clearInterval(timer); window.removeEventListener('hashchange', hashChange); });
</script>
<template>
    <a href="#main-content" class="skip-link" @click.prevent="focusContent">跳到主要内容</a>
    <SidebarProvider :default-open="true" :style="{ '--sidebar-width': '16rem' }">
        <AppSidebar :view="view" @navigate="navigate" />
        <SidebarInset class="min-w-0">
            <header class="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur-sm sm:px-7"><SidebarTrigger aria-label="切换导航菜单" class="-ml-1" /><Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-4" /><h1 class="text-xs font-medium">{{ title }}</h1><div class="ml-auto flex items-center gap-4"><span class="hidden text-[10px] text-muted-foreground sm:inline">练习 · 复习 · 积累</span><Button variant="outline" size="icon-sm" :aria-label="dark ? '切换为浅色' : '切换为深色'" @click="toggleTheme"><Sun v-if="dark" class="size-4" /><Moon v-else class="size-4" /></Button></div></header>
            <main id="main-content" class="mx-auto w-full max-w-[1440px] flex-1 p-5 pb-12 sm:p-8 lg:p-10" tabindex="-1">
                <p v-if="study.storageWarning" role="alert" class="mb-5 border border-amber-600 p-4 text-sm leading-7">{{ study.storageWarning }}</p>
                <p v-if="study.error" role="alert" class="mb-5 border border-destructive p-4 text-sm">{{ study.error }}</p>
                <p v-if="!study.ready" role="status">正在读取本地学习记录…</p>
                <KeepAlive v-else><KnowledgePage v-if="view === 'knowledge'" /><StudyPage v-else :view="view" @navigate="navigate" /></KeepAlive>
            </main>
            <footer class="mx-5 flex flex-wrap justify-between gap-2 border-t py-5 text-[10px] leading-5 text-muted-foreground sm:mx-8 lg:mx-10"><span>行测学习 / 本地个人学习库</span><span>山西为主 · 国考补充 · 六大模块</span></footer>
        </SidebarInset>
    </SidebarProvider>
</template>
