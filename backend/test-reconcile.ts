import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

interface ReconcileExcelRow {
  no: number | string;
  orderNo: string;
  plateNumber: string;
  paintCount: number;
  remark?: string;
}

async function test() {
  const shop = await prisma.paintShop.findFirst({ where: { code: 'FSXR' } });
  if (!shop) {
    console.log('未找到门店');
    process.exit(1);
  }

  // Parse Excel
  const workbook = XLSX.readFile('/Users/xiao/代码/paint-count-admin/工作簿1.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const excelRows: ReconcileExcelRow[] = [];
  for (let i = 1; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || !row[1]) continue;
    const orderNo = String(row[1]).trim();
    const plateNumber = String(row[2] || '').trim();
    const paintCount = Number(row[3]) || 0;
    if (orderNo.includes('合计') || orderNo.includes('总计')) continue;
    excelRows.push({ no: i + 1, orderNo, plateNumber, paintCount });
  }

  console.log(`Excel行数: ${excelRows.length}`);

  // Get system orders
  const systemOrders = await prisma.paintWorkOrder.findMany({
    where: {
      shopId: shop.id,
      settlementMonth: '2026-06',
      status: { notIn: ['DRAFT', 'PENDING'] }
    },
    select: {
      id: true,
      orderNo: true,
      plateNumber: true,
      totalPaintCount: true,
      status: true,
      remark: true,
    },
  });

  console.log(`系统工单数: ${systemOrders.length}`);

  // Build maps
  const excelMap = new Map<string, ReconcileExcelRow[]>();
  const excelPlateMap = new Map<string, ReconcileExcelRow[]>();
  for (const row of excelRows) {
    const key = row.orderNo;
    if (!excelMap.has(key)) excelMap.set(key, []);
    excelMap.get(key)!.push(row);
    const plateKey = row.plateNumber;
    if (plateKey) {
      if (!excelPlateMap.has(plateKey)) excelPlateMap.set(plateKey, []);
      excelPlateMap.get(plateKey)!.push(row);
    }
  }

  const systemMap = new Map<string, typeof systemOrders>();
  const systemPlateMap = new Map<string, typeof systemOrders>();
  for (const order of systemOrders) {
    const key = order.orderNo || '';
    if (!systemMap.has(key)) systemMap.set(key, []);
    systemMap.get(key)!.push(order);
    const plateKey = order.plateNumber || '';
    if (plateKey) {
      if (!systemPlateMap.has(plateKey)) systemPlateMap.set(plateKey, []);
      systemPlateMap.get(plateKey)!.push(order);
    }
  }

  // Check what's in systemMap for empty key
  const emptyKeyOrders = systemMap.get('');
  console.log(`\nsystemMap空键的工单数: ${emptyKeyOrders ? emptyKeyOrders.length : 0}`);

  // Simulate matching
  const matchedSystemKeys = new Set<string>();
  const matchedExcelKeys = new Set<string>();
  const matchedSystemPlateKeys = new Set<string>();
  const matchedExcelPlateKeys = new Set<string>();

  const items: any[] = [];

  for (const [orderNo, excelGroup] of excelMap.entries()) {
    let systemGroup = systemMap.get(orderNo);
    let matchedByPlate = false;

    if (!systemGroup || systemGroup.length === 0) {
      const excelPlate = excelGroup[0].plateNumber;
      if (excelPlate) {
        const plateSystemGroup = systemPlateMap.get(excelPlate);
        if (plateSystemGroup && plateSystemGroup.length > 0) {
          systemGroup = plateSystemGroup;
          matchedByPlate = true;
          console.log(`[车牌匹配] Excel工单号=${orderNo}, 车牌=${excelPlate} -> 匹配到系统${plateSystemGroup.length}条`);
        }
      }
    }

    if (!systemGroup || systemGroup.length === 0) {
      for (const row of excelGroup) {
        items.push({ type: 'missing_in_system', orderNo: row.orderNo, plateNumber: row.plateNumber });
      }
      continue;
    }

    const excelRow = excelGroup[0];
    const systemOrder = systemGroup[0];

    if (matchedByPlate) {
      const plateKey = excelRow.plateNumber;
      if (plateKey) {
        matchedSystemPlateKeys.add(plateKey);
        matchedExcelPlateKeys.add(plateKey);
      }
    } else {
      matchedSystemKeys.add(orderNo);
      matchedExcelKeys.add(orderNo);
    }

    items.push({ type: 'matched_or_diff', orderNo, plateNumber: excelRow.plateNumber, matchedByPlate });
  }

  // Process remaining system orders
  const processedSystemOrders = new Set<string>();
  for (const [orderNo, systemGroup] of systemMap.entries()) {
    if (matchedSystemKeys.has(orderNo)) continue;

    if (systemGroup.length > 1 && orderNo) {
      items.push({ type: 'duplicate', orderNo, plateNumber: systemGroup[0].plateNumber, source: 'system', count: systemGroup.length });
    }

    for (const systemOrder of systemGroup) {
      if (processedSystemOrders.has(systemOrder.id)) continue;
      const plateKey = systemOrder.plateNumber || '';
      if (matchedSystemPlateKeys.has(plateKey)) continue;
      processedSystemOrders.add(systemOrder.id);
      items.push({ type: 'extra_in_system', orderNo, plateNumber: plateKey, id: systemOrder.id });
    }
  }

  // Find 粤EDD0285 results
  console.log('\n=== 粤EDD0285 相关结果 ===');
  const edd0285Items = items.filter(i => i.plateNumber === '粤EDD0285');
  for (const item of edd0285Items) {
    console.log(JSON.stringify(item));
  }

  console.log('\n=== 所有extra_in_system结果 ===');
  const extras = items.filter(i => i.type === 'extra_in_system');
  for (const item of extras) {
    console.log(JSON.stringify(item));
  }

  console.log('\n=== 粤EDD0285在systemPlateMap中的记录 ===');
  const edd0285System = systemPlateMap.get('粤EDD0285');
  console.log(JSON.stringify(edd0285System, null, 2));

  console.log('\n=== matchedSystemPlateKeys ===');
  console.log([...matchedSystemPlateKeys]);

  await prisma.$disconnect();
}

test();
