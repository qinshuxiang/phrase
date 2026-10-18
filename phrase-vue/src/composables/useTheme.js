import { ref, watch } from 'vue';

const storedTheme = () => {
    try { return localStorage.getItem('vocab-theme'); } catch { return null; }
};

const stored = storedTheme();
const dark = ref(stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches));

/** 保持与原页面相同的主题存储键；存储被禁用时仍能切换当前页面。 */
watch(dark, value => {
    document.documentElement.classList.toggle('dark', value);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value ? '#111111' : '#fafafa');
    try { localStorage.setItem('vocab-theme', value ? 'dark' : 'light'); } catch { /* 无持久存储时保留当前状态。 */ }
}, { immediate: true });

export function useTheme() {
    return { dark, toggleTheme: () => { dark.value = !dark.value; } };
}
