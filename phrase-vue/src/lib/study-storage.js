let database;
/** 打开本地档案数据库；拒绝、阻塞或超时会由界面降级到内存并提示。 */
function open() {
    return database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('xingce-learning', 1);
        const timer = setTimeout(() => reject(new Error('打开本地数据库超时')), 3000);
        request.onupgradeneeded = () => request.result.createObjectStore('archive');
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); reject(new Error('本地数据库被其他页面阻塞')); };
        request.onsuccess = () => { clearTimeout(timer); request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
}
/** 读取完整档案快照。@returns {Promise<object|undefined>} 无档案时undefined；数据库不可用或I/O失败拒绝。 */
export async function readStudy() {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('archive', 'readonly');
        const req = tx.objectStore('archive').get('main');
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('本地档案读取失败'));
    });
}
/** 原子写入档案。@param {object} state 已校验的可克隆快照 @returns {Promise<void>} 事务成功后完成；打开、克隆、配额或事务失败拒绝，保留上次成功档案。 */
export async function writeStudy(state) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('archive', 'readwrite');
        tx.objectStore('archive').put(state, 'main');
        tx.oncomplete = resolve;
        // 显式abort的事务在请求error事件触发时，tx.error仍可能为null。
        tx.onerror = event => reject(tx.error ?? event.target?.error ?? new Error('本地档案写入失败'));
        tx.onabort = () => reject(tx.error ?? new Error('存储事务取消'));
    });
}
