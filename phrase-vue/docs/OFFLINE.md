# 行测学习离线单文件

成品为 `offline/行测学习-离线版.html`。复制这一个文件，用现代Chrome双击打开即可首次断网学习，不需要Node.js、服务器或同级图片目录。

```bash
npm run build:offline
npm run test:offline
```

内嵌主库46套6,020题、独立言语题源6,577题、986张引用图片、当前1,037条词汇、859张知识卡及本地字体。分片按需解压，图片按需生成Blob地址。构建上限64MiB，精确体积与SHA-256记录在 `evidence/offline-build.json`。HTML旁 `.sha256`仅用于校验，不是运行依赖。

学习记录保存在浏览器IndexedDB，文件本身不会随作答改写。更换浏览器、HTML路径或清理网站数据前，在「学习记录」导出；导出含未完成草稿。存储不可用时页面明确提示临时记录，仍可当次练习和导出。恢复备份必须完成原子事务，失败不会覆盖原档案。

测试将唯一HTML复制到临时中文路径，导航前设置浏览器断网，在桌面和移动视口测试首次加载、题库及图片、草稿刷新、套卷计时、收藏笔记、备份恢复及原词汇阅读。结果在 `evidence/offline-e2e-results.json`、`evidence/offline-isolation.json`。移动视口不代表手机实机；未验证旧浏览器、Safari或UOS。

常规HTTP版本未实现PWA缓存，断网首次打开的保证仅针对此单HTML。现代Chrome需支持DecompressionStream、IndexedDB和ES模块。
