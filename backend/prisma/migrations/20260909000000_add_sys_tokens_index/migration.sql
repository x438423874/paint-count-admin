-- sys_tokens 清理查询索引（pruneUsedTokens 按 status+createdAt 过滤；纯增量 DDL，不涉及数据变更）
CREATE INDEX `sys_tokens_status_created_at_idx` ON `sys_tokens`(`status`, `created_at`);
