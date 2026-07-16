/**
 * 导入佛山瑞华比亚迪(讯锐) 5月喷漆台账数据
 *
 * 执行方式:
 *   cd backend && npx ts-node -r tsconfig-paths/register prisma/seeds/import-ruihua-may.ts
 *
 * 功能:
 *   1. 创建门店"佛山瑞华比亚迪(讯锐)"
 *   2. 关联现有的"喷涂板件工时计价表（盛通）"标准模板（系数完全一致）
 *   3. 复制幅数标准到门店
 *   4. 配置Excel模板列映射
 *   5. 导入5月工单数据
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

const SHOP = {
  name: '佛山瑞华比亚迪(讯锐)',
  code: 'FSXR',
  brand: '比亚迪',
  address: '佛山市',
  phone: '',
};

/** Excel列 → 系统项目类别名映射（组合名称取第一个，系数相同） */
const EXCEL_COLUMN_MAP: { col: string; categoryName: string }[] = [
  { col: 'G', categoryName: '车门' },
  { col: 'H', categoryName: '车门里外' },
  { col: 'I', categoryName: '车门半喷' },
  { col: 'J', categoryName: '叶子板' },
  { col: 'K', categoryName: '机盖' },         // Excel"前头盖"，数据库为"机盖"
  { col: 'L', categoryName: '机盖里外' },      // Excel"前头盖里外"，数据库为"机盖里外"
  { col: 'M', categoryName: '后盖' },
  { col: 'N', categoryName: '后盖里外' },
  { col: 'O', categoryName: '车顶(有天窗)' },
  { col: 'P', categoryName: '车顶(无天窗)' },
  { col: 'Q', categoryName: '前后杠' },
  { col: 'R', categoryName: '前后杠(新)' },
  { col: 'S', categoryName: '前后杠半喷' },
  { col: 'T', categoryName: '下裙' },           // Excel"下裙/包角"，系数相同0.5
  { col: 'U', categoryName: '尾翼' },
  { col: 'V', categoryName: 'A/B/C/车顶柱' },
  { col: 'W', categoryName: '倒车镜' },         // Excel"倒车镜/轮眉/灯座"，系数相同0.2
  { col: 'X', categoryName: '减震座' },
  { col: 'Y', categoryName: '防火墙' },
  { col: 'Z', categoryName: '钢圈翻新' },
  { col: 'AA', categoryName: '哑光漆' },
  { col: 'AB', categoryName: '门铰链' },        // Excel"门铰链/门拉手/油箱盖"，系数相同0.1
  { col: 'AC', categoryName: '门框' },           // Excel"门框/大梁"，系数相同0.3
  { col: 'AD', categoryName: '中网' },
  { col: 'AE', categoryName: '后地板' },
  { col: 'AF', categoryName: '备胎槽' },         // Excel"备胎槽/后围板"，系数相同0.3
  { col: 'AG', categoryName: '保险杠下段' },
  { col: 'AH', categoryName: '杠饰条' },         // Excel"杠/门饰条"，系数相同0.2
  { col: 'AI', categoryName: '抛光（单独项）' },
  { col: 'AJ', categoryName: '轿车全车外表' },
  { col: 'AK', categoryName: '轿车全车内外' },
  { col: 'AL', categoryName: '商务车全车外表' },
  { col: 'AM', categoryName: '商务车全车内外' },
];

const EXCEL_TEMPLATE_CONFIG = {
  dataStartRow: 4,  // 0-based: 第5行开始（行索引4）
  headerRow: 2,      // 0-based: 第3行是表头
  coefficientRow: 3, // 0-based: 第4行是系数行
  fields: {
    date: 'B',
    carModel: 'C',
    plateNumber: 'D',
    orderNo: 'E',
    paintCount: 'F',
    remark: 'AN',     // 备注列
  },
  items: EXCEL_COLUMN_MAP,
};

function parseDate(val: unknown): string {
  if (!val) return new Date().toISOString().split('T')[0];
  const dateStr = String(val).trim();
  // 格式: 26.5.2 → 2026-05-02
  const match = dateStr.match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})$/);
  if (match) {
    let year = parseInt(match[1]);
    if (year < 100) year += 2000;
    return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  // Excel日期数字
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return new Date().toISOString().split('T')[0];
}

async function importRuihuaMay() {
  console.log('🚀 开始导入佛山瑞华比亚迪(讯锐) 5月喷漆台账...\n');

  // 1. 查找或创建门店
  let shop = await prisma.paintShop.findUnique({ where: { code: SHOP.code } });
  if (!shop) {
    shop = await prisma.paintShop.create({ data: SHOP });
    console.log(`  ✅ 门店已创建: ${shop.name}`);
  } else {
    console.log(`  ⏭️  门店已存在: ${shop.name}`);
  }

  // 2. 关联盛通标准模板（系数完全一致）
  const fsstTemplate = await prisma.paintStandardTemplate.findFirst({
    where: { OR: [
      { name: { contains: '盛通' } },
      { name: '喷涂板件工时计价表（盛通）' },
    ] },
  });
  if (!fsstTemplate) {
    throw new Error('未找到盛通标准模板，请先执行 paint-seed');
  }

  if (shop.standardTemplateId !== fsstTemplate.id) {
    shop = await prisma.paintShop.update({
      where: { id: shop.id },
      data: { standardTemplateId: fsstTemplate.id },
    });
    console.log(`  ✅ 已关联标准模板: ${fsstTemplate.name}`);
  } else {
    console.log(`  ⏭️  标准模板已关联`);
  }

  // 3. 读取Excel系数行（row 4, 0-based row 3）
  const excelPath = path.resolve(__dirname, '../../../佛山瑞华比亚迪喷漆维修台账5月.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // 获取所有类别（按名称查找，优先全局类别）
  const allCategories = await prisma.paintItemCategory.findMany({
    where: { shopId: null },
    orderBy: { sortOrder: 'asc' },
  });
  const categoryMap = new Map<string, typeof allCategories[0]>();
  for (const cat of allCategories) {
    if (!categoryMap.has(cat.name)) {
      categoryMap.set(cat.name, cat);
    }
  }

  // 为每个Excel列对应的类别创建/更新幅数标准（直接使用Excel系数）
  let stdCount = 0;
  for (const mapping of EXCEL_COLUMN_MAP) {
    const category = categoryMap.get(mapping.categoryName);
    if (!category) {
      console.log(`  ⚠️  类别"${mapping.categoryName}"不存在，跳过`);
      continue;
    }

    // 从Excel系数行读取系数
    const colIndex = XLSX.utils.decode_col(mapping.col);
    const coeffCell = ws[XLSX.utils.encode_cell({ r: 3, c: colIndex })]; // row 4 = 0-based 3
    const coefficient = coeffCell ? Number(coeffCell.v) : 1;

    await prisma.paintStandard.upsert({
      where: { shopId_categoryId: { shopId: shop.id, categoryId: category.id } },
      update: { coefficient, unit: '幅' },
      create: {
        shopId: shop.id,
        categoryId: category.id,
        coefficient,
        unit: '幅',
      },
    });
    stdCount++;
  }

  // 同时从模板复制其他类别的标准（确保完整性）
  const templateItems = await prisma.paintStandardTemplateItem.findMany({
    where: { templateId: fsstTemplate.id },
  });
  for (const item of templateItems) {
    const existing = await prisma.paintStandard.findUnique({
      where: { shopId_categoryId: { shopId: shop.id, categoryId: item.categoryId } },
    });
    if (!existing) {
      await prisma.paintStandard.create({
        data: {
          shopId: shop.id,
          categoryId: item.categoryId,
          coefficient: item.coefficient,
          newPartAddition: item.newPartAddition,
          unit: item.unit,
        },
      });
      stdCount++;
    }
  }
  console.log(`  ✅ 幅数标准已设置 (${stdCount}项)`);

  // 4. 配置Excel模板列映射
  await prisma.paintShop.update({
    where: { id: shop.id },
    data: { excelTemplateConfig: JSON.stringify(EXCEL_TEMPLATE_CONFIG) },
  });
  console.log(`  ✅ Excel模板配置已保存`);

  // 5. 导入工单数据（Excel已在步骤3读取）
  console.log(`\n  📂 开始导入工单数据...`);

  // 获取门店标准（用于计算paintCount）
  const standards = await prisma.paintStandard.findMany({ where: { shopId: shop.id } });
  const stdMap = new Map(standards.map(s => [s.categoryId, s]));

  // 清理旧数据（如果已有导入的工单，全部删除后重新导入）
  const oldOrders = await prisma.paintWorkOrder.findMany({
    where: { shopId: shop.id },
    select: { id: true },
  });
  if (oldOrders.length > 0) {
    await prisma.paintWorkOrderItem.deleteMany({
      where: { orderId: { in: oldOrders.map(o => o.id) } },
    });
    await prisma.paintWorkOrder.deleteMany({ where: { shopId: shop.id } });
    console.log(`  🗑️  已清理旧数据 (${oldOrders.length}条工单)`);
  }

  let success = 0;
  let skipped = 0;
  const errors: string[] = [];

  // 数据从第5行开始（0-based row 4）
  for (let r = EXCEL_TEMPLATE_CONFIG.dataStartRow; r <= range.e.r; r++) {
    const orderNoCell = ws[`E${r + 1}`];
    const plateCell = ws[`D${r + 1}`];
    const dateCell = ws[`B${r + 1}`];

    // 跳过空行和合计行
    if (!orderNoCell?.v && !plateCell?.v && !dateCell?.v) continue;
    const orderNoRaw = orderNoCell ? String(orderNoCell.v).trim() : '';
    if (orderNoRaw === '' && !plateCell?.v) continue;
    // 跳过"合计"行
    if (String(orderNoCell?.v || '').includes('合计') || String(dateCell?.v || '').includes('合计')) continue;
    if (!orderNoRaw) continue;

    // 检查是否已存在
    const existing = await prisma.paintWorkOrder.findFirst({
      where: { orderNo: orderNoRaw, shopId: shop.id },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const carModelCell = ws[`C${r + 1}`];
    const remarkCell = ws[`AN${r + 1}`];
    const orderDate = parseDate(dateCell?.v);
    const plateNumber = plateCell ? String(plateCell.v).trim() : '';
    const carModel = carModelCell ? String(carModelCell.v).trim() : '比亚迪';
    const remark = remarkCell ? String(remarkCell.v).trim() : '';

    // settlementMonth: 从日期提取 YYYY-MM
    const settlementMonth = orderDate.substring(0, 7);

    // 解析项目明细
    const items: {
      categoryId: string;
      quantity: number;
      newPartQuantity: number;
      paintCount: number;
    }[] = [];

    for (const mapping of EXCEL_COLUMN_MAP) {
      const colIndex = XLSX.utils.decode_col(mapping.col);
      const cell = ws[XLSX.utils.encode_cell({ r, c: colIndex })];
      if (!cell?.v) continue;  // 空值或0跳过

      const category = categoryMap.get(mapping.categoryName);
      if (!category) {
        errors.push(`行${r + 1}: 项目"${mapping.categoryName}"在系统中不存在`);
        continue;
      }

      const cellVal = Number(cell.v) || 0;
      const std = stdMap.get(category.id);
      const coefficient = std ? Number(std.coefficient) : 1;
      // Excel单元格值即为幅数（coefficient × quantity），反推quantity
      const quantity = Math.max(1, Math.round(cellVal / coefficient));
      // 直接使用Excel中的幅数值，避免浮点累积误差
      const paintCount = cellVal;

      items.push({
        categoryId: category.id,
        quantity,
        newPartQuantity: 0,
        paintCount,
      });
    }

    // 计算总幅数
    const totalPaintCount = items.reduce((sum, i) => sum + i.paintCount, 0);

    // 创建工单
    await prisma.paintWorkOrder.create({
      data: {
        orderNo: orderNoRaw,
        shopId: shop.id,
        orderDate: new Date(orderDate),
        settlementMonth,
        carModel,
        plateNumber,
        status: 'COMPLETED' as any,
        isAudited: true,
        auditedAt: new Date(),
        totalPaintCount,
        remark: remark || undefined,
        items: {
          create: items.map(i => ({
            categoryId: i.categoryId,
            quantity: i.quantity,
            newPartQuantity: i.newPartQuantity,
            paintCount: i.paintCount,
          })),
        },
      },
    });

    success++;
    if (success % 20 === 0) {
      console.log(`    📝 已导入 ${success} 条...`);
    }
  }

  console.log(`\n  📊 导入结果:`);
  console.log(`    ✅ 成功: ${success} 条`);
  console.log(`    ⏭️  跳过(已存在): ${skipped} 条`);
  if (errors.length > 0) {
    console.log(`    ⚠️  错误: ${errors.length} 条`);
    errors.slice(0, 10).forEach(e => console.log(`      - ${e}`));
  }

  // 6. 验证数据
  const totalOrders = await prisma.paintWorkOrder.count({ where: { shopId: shop.id } });
  const totalItems = await prisma.paintWorkOrderItem.count({
    where: { order: { shopId: shop.id } },
  });
  const sumPaintCount = await prisma.paintWorkOrder.aggregate({
    where: { shopId: shop.id },
    _sum: { totalPaintCount: true },
  });

  console.log(`\n  📋 数据验证:`);
  console.log(`    门店工单总数: ${totalOrders}`);
  console.log(`    工单明细总数: ${totalItems}`);
  console.log(`    总幅数合计: ${sumPaintCount._sum.totalPaintCount || 0}`);

  console.log('\n🎉 导入完成!');
}

importRuihuaMay()
  .catch(e => { console.error('导入失败:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
