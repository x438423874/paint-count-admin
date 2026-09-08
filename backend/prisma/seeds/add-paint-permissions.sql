-- paint:seal / paint:vehicle / paint:pending-image 权限点策略
-- 背景：这三个资源的接口此前无任何权限校验（任何登录角色可封单/删图/改车辆主数据）。
-- 模型为 domain 版（apps/base-system/src/resources/model.conf）：
--   p = sub, obj, act, dom, eft → 列顺序 v0=角色 v1=资源 v2=动作 v3=domain v4=eft
-- 本文件补齐 Casbin 策略行；可重复执行（幂等）。

INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4)
SELECT 'p', t.role, t.resource, t.action, 'built-in', 'allow'
FROM (
  -- 封单：写操作影响全店统计口径，限管理角色；read 供封单页/对账页查看（H5 不使用）
  SELECT 'ROLE_SUPER' AS role, 'paint:seal' AS resource, 'seal' AS action
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:seal', 'seal'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:seal', 'seal'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:seal', 'unseal'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:seal', 'unseal'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:seal', 'unseal'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:seal', 'read'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:seal', 'read'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:seal', 'read'
  UNION ALL SELECT 'ROLE_FINANCE', 'paint:seal', 'read'
  -- 车辆主数据：写操作限管理角色（录单时的自动 upsert 走服务内部，不经过控制器权限）
  UNION ALL SELECT 'ROLE_SUPER', 'paint:vehicle', 'create'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:vehicle', 'create'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:vehicle', 'create'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:vehicle', 'update'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:vehicle', 'update'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:vehicle', 'update'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:vehicle', 'delete'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:vehicle', 'delete'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:vehicle', 'delete'
  -- 图片池：读接口维持登录+门店校验；写操作分权限点
  -- upload/match/auto-match/correct/retry/create-order 属录入流程（含店员）
  -- assign（人工指派到工单）与 delete 属纠正/破坏性操作（限管理角色）
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'upload'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'upload'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'upload'
  UNION ALL SELECT 'ROLE_SHOP_STAFF', 'paint:pending-image', 'upload'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'match'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'match'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'match'
  UNION ALL SELECT 'ROLE_SHOP_STAFF', 'paint:pending-image', 'match'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'assign'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'assign'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'assign'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'create-order'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'create-order'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'create-order'
  UNION ALL SELECT 'ROLE_SHOP_STAFF', 'paint:pending-image', 'create-order'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'correct'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'correct'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'correct'
  UNION ALL SELECT 'ROLE_SHOP_STAFF', 'paint:pending-image', 'correct'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'retry'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'retry'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'retry'
  UNION ALL SELECT 'ROLE_SHOP_STAFF', 'paint:pending-image', 'retry'
  UNION ALL SELECT 'ROLE_SUPER', 'paint:pending-image', 'delete'
  UNION ALL SELECT 'ROLE_ADMIN', 'paint:pending-image', 'delete'
  UNION ALL SELECT 'ROLE_SHOP_ADMIN', 'paint:pending-image', 'delete'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM casbin_rule c
  WHERE c.ptype = 'p' AND c.v0 = t.role AND c.v1 = t.resource AND c.v2 = t.action
);
