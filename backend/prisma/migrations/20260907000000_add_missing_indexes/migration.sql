-- 补充高频查询缺失索引（纯增量 DDL，不涉及任何数据变更）
-- sys_user.domain: 租户/域按 domain 查询
CREATE INDEX `sys_user_domain_idx` ON `sys_user`(`domain`);

-- casbin_rule: enforcer 权限校验按 ptype/v0 过滤
CREATE INDEX `casbin_rule_ptype_v0_idx` ON `casbin_rule`(`ptype`, `v0`);
