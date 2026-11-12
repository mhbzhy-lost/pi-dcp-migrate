// 由 scripts/build-audit.ts 生成；请修改 TypeScript 源码后重新构建。
// 审计 v1 契约；运行时依赖仅限 Node，不能把审计内容回填给模型。
export const AUDIT_FORMAT_VERSION = 1;
export const AUDIT_DEFAULT_MAX_BYTES = 268435456;
export const AUDIT_STATUS_MAX_BYTES = 65536;
export function observeAudit(observer, event, body) {
    if (!observer?.active)
        return;
    try {
        observer.capture(event, body());
    }
    catch (error) {
        try {
            observer.pause("serialization", error);
        }
        catch { /* 旁路错误不能干预压缩。 */ }
    }
}
