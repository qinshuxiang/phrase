<script setup>
import { LayoutDashboard, BookOpen, ClipboardCheck, Library, ArrowUpRight, ListChecks, History, Bookmark } from '@lucide/vue';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, useSidebar } from '@/components/ui/sidebar';
import { library } from '@/lib/library';

defineProps({ view: { type: String, required: true } });
const emit = defineEmits(['navigate']);
const { setOpenMobile } = useSidebar();
const links = [
    { id: 'dashboard', label: '学习首页', icon: LayoutDashboard, number: '01' },
    { id: 'practice', label: '专项练习', icon: ListChecks, number: '02' },
    { id: 'papers', label: '真题套卷', icon: ClipboardCheck, number: '03' },
    { id: 'review', label: '错题与笔记', icon: Bookmark, number: '04' },
    { id: 'knowledge', label: '言语知识库', icon: BookOpen, number: '05' },
    { id: 'records', label: '学习记录', icon: History, number: '06' },
];
function navigate(id) { emit('navigate', id); setOpenMobile(false); }
</script>

<template>
    <Sidebar collapsible="offcanvas" class="border-r">
        <SidebarHeader class="h-16 justify-center border-b px-5">
            <div class="flex items-center gap-3"><div class="flex size-8 items-center justify-center bg-foreground text-base font-semibold text-background">行</div><div><p class="text-sm font-semibold tracking-tight">行测学习</p><p class="mt-0.5 text-[10px] tracking-[0.12em] text-muted-foreground">PRACTICE & REVIEW</p></div></div>
        </SidebarHeader>
        <SidebarContent class="px-2 py-5">
            <SidebarGroup>
                <SidebarGroupLabel class="mb-2 text-[10px] tracking-[0.15em]">我的学习库</SidebarGroupLabel>
                <SidebarGroupContent>
                    <SidebarMenu class="gap-1.5">
                        <SidebarMenuItem v-for="item in links" :key="item.id">
                            <SidebarMenuButton :is-active="view === item.id" :aria-current="view === item.id ? 'page' : undefined" :data-testid="`nav-${item.id}`" class="h-10 px-3 text-xs" @click="navigate(item.id)"><component :is="item.icon" class="size-4" :stroke-width="1.5" /><span>{{ item.label }}</span><span class="ml-auto text-[10px] opacity-45">{{ item.number }}</span></SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        </SidebarContent>
        <SidebarFooter class="gap-4 p-5">
            <div class="border bg-background/50 p-3.5"><div class="mb-3 flex items-center gap-2 text-xs font-medium"><Library class="size-4" />本地资料库<ArrowUpRight class="ml-auto size-3 text-muted-foreground" /></div><p class="text-[11px] leading-6 text-muted-foreground">{{ library.stats.words }} 条词汇记录<br />{{ library.stats.groups }} 个主题词组</p></div>
            <SidebarSeparator class="mx-0" />
            <div class="space-y-1 text-[10px] leading-5 text-muted-foreground"><p class="flex items-center gap-2"><span class="size-1.5 bg-emerald-600 dark:bg-emerald-400" />内容随应用收录</p><p>资料生成 {{ library.generated_at.slice(0, 10) }}</p></div>
        </SidebarFooter>
    </Sidebar>
</template>
