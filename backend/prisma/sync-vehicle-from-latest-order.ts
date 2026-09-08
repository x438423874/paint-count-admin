import { PrismaClient } from '@prisma/client';

/**
 * 按「最近一张工单为准」的口径，把车辆主数据（paint_vehicle）的车辆信息对齐到工单。
 *
 * 背景：
 * PaintVehicleService.upsertByPlateWithTx 长期采用「智能合并」策略
 * （carModel/brand 只有新值更长才覆盖；vin/customerName/phone/contactPerson 只有原值为空才填充），
 * 导致在工单上修正过的车辆信息回写不到车辆管理，存量数据持续偏离。
 * 写入路径已修复（用户显式编辑的字段强制覆盖），本脚本负责修复存量数据。
 *
 * 口径（与 PaintVehicleService.queryVehicleStatsFromOrders 保持一致）：
 * - 只取 status <> 'VOID' 的工单
 * - 「最近一张」= order_date DESC, created_at DESC, id DESC 的第一张
 * - 工单字段为空/纯空白时不覆盖车辆已有值（与写入路径约定一致，避免把主数据清空）
 * - 不同步 plateNumber：车牌变更属于「工单换挂车辆」，由工单编辑流程处理，不在本脚本范围
 *
 * 脏数据防护（默认开启，--unsafe 关闭）：
 * 工单上存在「车型填成品牌」「品牌填成车型/门店简称」这类脏数据，
 * 直接覆盖会把「宋PLUS DM-i智驾版」退化成「比亚迪」，因此这类覆盖默认跳过并单独列出。
 *
 * 用法（在 backend 目录执行）：
 *   pnpm ts-node prisma/sync-vehicle-from-latest-order.ts                   # 预览，不写库
 *   pnpm ts-node prisma/sync-vehicle-from-latest-order.ts --apply           # 写入（自动建备份表）
 *   pnpm ts-node prisma/sync-vehicle-from-latest-order.ts --fill-only       # 只补齐空字段，不覆盖已有值
 *   pnpm ts-node prisma/sync-vehicle-from-latest-order.ts --plate=粤EFK5189 # 只处理指定车牌
 *   pnpm ts-node prisma/sync-vehicle-from-latest-order.ts --unsafe          # 关闭脏数据防护
 */
const prisma = new PrismaClient();

/** 需要对齐的车辆信息字段 */
const FIELDS = ['vin', 'carModel', 'brand', 'customerName', 'phone', 'contactPerson'] as const;
type VehicleField = (typeof FIELDS)[number];

const FIELD_LABELS: Record<VehicleField, string> = {
  vin: '车架号',
  carModel: '车型',
  brand: '品牌',
  customerName: '客户名称',
  phone: '电话',
  contactPerson: '联系人',
};

/** 预览时最多打印的变更/可疑条数，避免刷屏 */
const MAX_PRINT = 50;

interface LatestOrderRow {
  vehicleId: string;
  orderId: string;
}

interface PendingChange {
  vehicleId: string;
  plateNumber: string;
  orderNo: string | null;
  data: Partial<Record<VehicleField, string>>;
  details: string[];
  suspicious: string[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.some(a => a === '--help' || a === '-h')) {
    console.log('用法: ts-node prisma/sync-vehicle-from-latest-order.ts [--apply] [--fill-only] [--plate=车牌号] [--unsafe]');
    process.exit(0);
  }
  const plateArg = args.find(a => a.startsWith('--plate='));
  return {
    apply: args.includes('--apply'),
    fillOnly: args.includes('--fill-only'),
    unsafe: args.includes('--unsafe'),
    plate: plateArg ? plateArg.slice('--plate='.length).trim().toUpperCase() : null,
  };
}

/** 每台车最近一张非作废工单 */
async function findLatestOrderIds(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<LatestOrderRow[]>`
    SELECT vehicle_id AS vehicleId, id AS orderId
    FROM (
      SELECT
        o.vehicle_id,
        o.id,
        ROW_NUMBER() OVER (
          PARTITION BY o.vehicle_id
          ORDER BY o.order_date DESC, o.created_at DESC, o.id DESC
        ) AS rn
      FROM paint_work_order o
      WHERE o.vehicle_id IS NOT NULL AND o.status <> 'VOID'
    ) ranked
    WHERE ranked.rn = 1
  `;
  return new Map(rows.map(r => [r.vehicleId, r.orderId]));
}

/** 门店简称（如「佛山瑞华别克雪佛兰(盛通)」-> 盛通），用于识别被误填进品牌/车型的门店名 */
async function findShopAliases(): Promise<Set<string>> {
  const shops = await prisma.paintShop.findMany({ select: { name: true } });
  const aliases = new Set<string>();
  for (const shop of shops) {
    const matched = /[（(]([^）)]+)[）)]/.exec(shop.name || '');
    if (matched?.[1]?.trim()) aliases.add(matched[1].trim());
  }
  return aliases;
}

async function backupVehicleTable(): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const table = `paint_vehicle_bak_${stamp}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE \`${table}\` LIKE paint_vehicle`);
  await prisma.$executeRawUnsafe(`INSERT INTO \`${table}\` SELECT * FROM paint_vehicle`);
  return table;
}

async function main() {
  const { apply, fillOnly, unsafe, plate } = parseArgs();

  if (plate) console.log(`仅处理车牌：${plate}\n`);
  console.log(`模式：${fillOnly ? '只补齐空字段' : '以最近一张工单为准'}；脏数据防护：${unsafe ? '关闭' : '开启'}\n`);

  const [vehicles, latestOrderIds, shopAliases] = await Promise.all([
    prisma.paintVehicle.findMany({
      where: plate ? { plateNumber: plate } : {},
      select: {
        id: true,
        plateNumber: true,
        vin: true,
        carModel: true,
        brand: true,
        customerName: true,
        phone: true,
        contactPerson: true,
      },
      orderBy: { plateNumber: 'asc' },
    }),
    findLatestOrderIds(),
    findShopAliases(),
  ]);

  const orderIds = [...new Set(vehicles.map(v => latestOrderIds.get(v.id)).filter((id): id is string => Boolean(id)))];
  const orders = await prisma.paintWorkOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderNo: true,
      vin: true,
      carModel: true,
      brand: true,
      customerName: true,
      phone: true,
      contactPerson: true,
    },
  });
  const orderMap = new Map(orders.map(o => [o.id, o]));

  const changes: PendingChange[] = [];
  const suspiciousOnly: PendingChange[] = [];
  let noLatestOrder = 0;

  for (const vehicle of vehicles) {
    const latestOrderId = latestOrderIds.get(vehicle.id);
    if (!latestOrderId) {
      noLatestOrder += 1;
      continue;
    }
    const latest = orderMap.get(latestOrderId);
    if (!latest) continue;

    const data: Partial<Record<VehicleField, string>> = {};
    const details: string[] = [];
    const suspicious: string[] = [];

    const currentOf = (field: VehicleField) => (vehicle[field] ?? '').trim();
    const latestOf = (field: VehicleField) => (latest[field] ?? '').trim();

    for (const field of FIELDS) {
      const label = FIELD_LABELS[field];
      const newValue = latestOf(field);
      if (!newValue) continue; // 工单该字段为空，不覆盖主数据

      const currentValue = currentOf(field);
      if (currentValue === newValue) continue;
      if (fillOnly && currentValue) continue; // 只补齐模式：已有值不覆盖

      // 脏数据防护：工单上车型/品牌互相填反，或填成了门店简称
      if (!unsafe) {
        // 门店简称与填空/覆盖无关，一律不可信（品牌/车型都不可能是「盛通」这类门店简称）
        if ((field === 'brand' || field === 'carModel') && shopAliases.has(newValue)) {
          suspicious.push(`${label}: ${currentValue || '(空)'} -X-> ${newValue}（新值是门店简称，疑似误填）`);
          continue;
        }
        // 填反只在覆盖已有值时判断：填空时没有参照，无法判断哪个字段是对的
        if (currentValue) {
          if (field === 'carModel' && (newValue === latestOf('brand') || newValue === currentOf('brand'))) {
            suspicious.push(`${label}: ${currentValue} -X-> ${newValue}（新值与品牌相同，疑似填反）`);
            continue;
          }
          if (field === 'brand' && (newValue === latestOf('carModel') || newValue === currentOf('carModel'))) {
            suspicious.push(`${label}: ${currentValue} -X-> ${newValue}（新值与车型相同，疑似填反）`);
            continue;
          }
        }
      }

      data[field] = newValue;
      details.push(`${label}: ${currentValue || '(空)'} -> ${newValue}`);
    }

    if (details.length === 0 && suspicious.length === 0) continue;
    const change: PendingChange = { vehicleId: vehicle.id, plateNumber: vehicle.plateNumber, orderNo: latest.orderNo, data, details, suspicious };
    if (details.length > 0) changes.push(change);
    else suspiciousOnly.push(change);
  }

  const tally = (list: PendingChange[]) => {
    const counter = new Map<VehicleField, number>();
    for (const change of list) {
      for (const field of Object.keys(change.data) as VehicleField[]) {
        counter.set(field, (counter.get(field) ?? 0) + 1);
      }
    }
    return counter;
  };

  const fieldTally = tally(changes);
  const suspiciousCount = suspiciousOnly.reduce((sum, c) => sum + c.suspicious.length, 0);

  console.log(`检查车辆：${vehicles.length} 台（其中 ${noLatestOrder} 台没有可对齐的非作废工单）`);
  console.log(`将更新：${changes.length} 台`);
  for (const [field, count] of fieldTally) {
    console.log(`  - ${FIELD_LABELS[field]}：${count} 台`);
  }
  console.log(`脏数据防护跳过：${suspiciousCount} 处（涉及 ${suspiciousOnly.length} 台）`);

  if (changes.length > 0) {
    console.log('\n更新明细：');
    for (const change of changes.slice(0, MAX_PRINT)) {
      console.log(`  ${change.plateNumber}（来源工单 ${change.orderNo || '无工单号'}）：${change.details.join('；')}`);
    }
    if (changes.length > MAX_PRINT) console.log(`  ... 其余 ${changes.length - MAX_PRINT} 台省略`);
  }

  if (suspiciousOnly.length > 0) {
    console.log('\n可疑脏数据（已跳过，需人工确认）：');
    for (const change of suspiciousOnly.slice(0, MAX_PRINT)) {
      console.log(`  ${change.plateNumber}（来源工单 ${change.orderNo || '无工单号'}）：${change.suspicious.join('；')}`);
    }
    if (suspiciousOnly.length > MAX_PRINT) console.log(`  ... 其余 ${suspiciousOnly.length - MAX_PRINT} 台省略`);
  }

  if (!apply) {
    console.log('\n以上为预览结果，未写入数据库。确认无误后追加 --apply 执行。');
    return;
  }

  if (changes.length === 0) {
    console.log('\n无需写入。');
    return;
  }

  const backupTable = await backupVehicleTable();
  console.log(`\n已备份 paint_vehicle 到 ${backupTable}`);

  for (const change of changes) {
    await prisma.paintVehicle.update({ where: { id: change.vehicleId }, data: change.data });
  }
  console.log(`已更新 ${changes.length} 台车辆的车辆信息`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
