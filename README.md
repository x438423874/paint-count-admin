# 车漆管家（paint-count-admin）

汽车喷漆维修的**幅数统计与结算管理系统**：门店上传工单照片 → OCR/手动录入工单部位与幅数 → 按结算月汇总统计、对账、导出，支持门店数据权限（在岗期）与封单管控。

## 仓库结构

| 目录 | 说明 | 技术栈 |
| --- | --- | --- |
| `backend/` | 后端 API（NestJS 11 + Fastify + Prisma/MySQL + Redis + Casbin 权限） | pnpm |
| `frontend/` | 管理后台 Web（Vue3 + Vite + Naive UI，基于 SoybeanAdmin） | pnpm |
| `mobile-h5/` | 门店移动端 H5（Vue3 + Vant 4，基于 vue3-vant-mobile） | pnpm |

## 核心业务模块

- **工单管理**：手动/Excel 导入/OCR（MiniMax LLM）建单，审核、合并、作废、结算
- **图片池**：先传图后建单，OCR 自动匹配工单，人工修正/指派
- **幅数统计**：按结算月/门店的多维统计、门店对比、年度趋势，带 Redis 缓存
- **对账**：Excel 台账与系统工单比对，输出差异明细
- **封单管理**：按门店+月份锁定，防止已封账数据被修改
- **车辆/客户主数据**：按车牌全局唯一，工单自动回写
- **权限体系**：JWT 认证 + Casbin RBAC（权限点如 `paint:work-order:audit`）+ 门店数据权限（用户绑定门店的在岗期，超管/财务不受限）

## 本地开发

```bash
# 0. 准备：MySQL 8 与 Redis（Redis 默认使用 db 5），Node 20+
#    backend/.env 不入库，需自行准备（含 DATABASE_URL / JWT_SECRET / LLM_OCR_API_KEY 等）

# 1. 后端（端口 6100，见 backend/.env 的 APP_PORT）
cd backend
pnpm install
npx prisma migrate deploy   # 或 prisma migrate dev
npx prisma generate
pnpm prisma:seed            # 种子数据（菜单/角色等）
pnpm start:dev

# 2. 管理后台（默认 6200，代理到后端）
cd frontend && pnpm i && pnpm dev

# 3. 移动端 H5
cd mobile-h5 && pnpm i && pnpm dev
```

内置账号见 `backend/prisma/seeds/sys/sysUser.ts`（种子密码 123456，仅限本地）。

## 部署注意

- `backend/ecosystem.config.js`（pm2）：**单实例 fork**。定时任务与 winston 日志轮转不支持多进程并发，扩容前需先给定时任务加分布式锁
- `backend/.env` 永不入库（历史曾泄露过密钥，相关密钥必须轮换）；生产密钥走部署环境注入
- `backend/uploads/` 存放工单照片（含客户隐私），已通过鉴权接口受控访问，目录本身严禁入仓/对外暴露
- `docker-compose.yml` 与 `frontend/nginx.conf` 为模板遗留/半成品，使用前需按实际拓扑核对（库类型是 MySQL）

## 目录速查（backend）

- `apps/base-system/src/api/paint/` 喷漆业务（工单/统计/图片池/封单/车辆…）
- `apps/base-system/src/api/iam`、`lib/bounded-contexts/` 认证与权限（DDD 分层）
- `libs/infra/` 基础设施（守卫/拦截器/装饰器/Casbin/fastify 适配）
- `prisma/seeds/` 菜单/角色/权限点种子；`prisma/migrations/` 迁移（注意：与库历史有漂移，勿直接 `migrate dev` 重置，参照既有迁移的手动 DDL + `migrate resolve` 方式）
