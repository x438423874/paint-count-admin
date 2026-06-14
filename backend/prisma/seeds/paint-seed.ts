import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STANDARD_TEMPLATES = [
  {
    name: '喷涂板件工时计价表（盛通）',
    description: '佛山瑞华别克雪佛兰(盛通)使用的喷涂板件工时计价标准',
    version: '1.0',
  },
  {
    name: '油漆幅数统计标准（宏现）',
    description: '江门瑞华比亚迪(宏现)使用的油漆幅数统计标准',
    version: '1.0',
  },
];

const SHOPS = [
  { name: '佛山瑞华别克雪佛兰(盛通)', code: 'FSST', brand: '别克/雪佛兰', address: '佛山市', phone: '' },
  { name: '江门瑞华比亚迪(宏现)', code: 'JMHX', brand: '比亚迪', address: '江门市', phone: '' },
];

const CATEGORIES = [
  { name: '车门', code: 'door', sortOrder: 1 },
  { name: '车门里外', code: 'door_inner_outer', sortOrder: 2 },
  { name: '车门半喷', code: 'door_half', sortOrder: 3 },
  { name: '叶子板', code: 'fender', sortOrder: 4 },
  { name: '前头盖', code: 'hood', sortOrder: 5 },
  { name: '前头盖里外', code: 'hood_inner_outer', sortOrder: 6 },
  { name: '后盖', code: 'trunk', sortOrder: 7 },
  { name: '后盖里外', code: 'trunk_inner_outer', sortOrder: 8 },
  { name: '车顶(有天窗)', code: 'roof_sunroof', sortOrder: 9 },
  { name: '车顶(无天窗)', code: 'roof_no_sunroof', sortOrder: 10 },
  { name: '前后杠', code: 'bumper', sortOrder: 11 },
  { name: '前后杠(新)', code: 'bumper_new', sortOrder: 12 },
  { name: '前后杠半喷', code: 'bumper_half', sortOrder: 13 },
  { name: '下裙/包角', code: 'skirt', sortOrder: 14 },
  { name: '尾翼', code: 'spoiler', sortOrder: 15 },
  { name: 'A/B/C/车顶柱', code: 'pillar', sortOrder: 16 },
  { name: '倒车镜/轮眉/灯座', code: 'mirror_fender_lamp', sortOrder: 17 },
  { name: '减震座', code: 'strut_mount', sortOrder: 18 },
  { name: '防火墙', code: 'firewall', sortOrder: 19 },
  { name: '钢圈翻新', code: 'wheel_refurbish', sortOrder: 20 },
  { name: '哑光漆', code: 'matte_paint', sortOrder: 21 },
  { name: '门铰链/门拉手/油箱盖', code: 'door_hinge_handle', sortOrder: 22 },
  { name: '门框/大梁', code: 'door_frame_rail', sortOrder: 23 },
  { name: '中网', code: 'grille', sortOrder: 24 },
  { name: '后地板', code: 'rear_floor', sortOrder: 25 },
  { name: '备胎槽/后围板', code: 'spare_tire_panel', sortOrder: 26 },
  { name: '保险杠下段', code: 'bumper_lower', sortOrder: 27 },
  { name: '杠/门饰条', code: 'trim_strip', sortOrder: 28 },
  { name: '抛光（单独项）', code: 'polish', sortOrder: 29, isSpecial: true },
  { name: '轿车全车外表', code: 'full_car_exterior', sortOrder: 30, isSpecial: true },
  { name: '轿车全车内外', code: 'full_car_all', sortOrder: 31, isSpecial: true },
  { name: '商务车全车外表', code: 'mpv_exterior', sortOrder: 32, isSpecial: true },
  { name: '商务车全车内外', code: 'mpv_all', sortOrder: 33, isSpecial: true },
  { name: '车顶', code: 'roof', sortOrder: 34 },
  { name: '前后杠半喷(宏现)', code: 'bumper_half_hx', sortOrder: 35 },
  { name: '下裙', code: 'skirt_only', sortOrder: 36 },
  { name: '门踏板', code: 'door_step', sortOrder: 37 },
  { name: '倒车镜', code: 'mirror_only', sortOrder: 38 },
  { name: '挡泥板', code: 'mudguard', sortOrder: 39 },
  { name: '倒车雷达/套', code: 'radar', sortOrder: 40 },
  { name: '龙门架', code: 'gantry', sortOrder: 41 },
  { name: '后围板', code: 'rear_panel', sortOrder: 42 },
  { name: '前护杠', code: 'front_guard', sortOrder: 43 },
  { name: '前后杠下饰板', code: 'bumper_lower_trim', sortOrder: 44 },
  { name: '全车改色', code: 'full_color_change', sortOrder: 45, isSpecial: true },
];

const SPECIAL_PAINTS = [
  { name: '水晶珍珠漆', multiplier: 1.3, description: '水晶珍珠漆，幅数乘以1.3倍' },
  { name: '金属漆', multiplier: 1.1, description: '金属漆，幅数乘以1.1倍' },
  { name: '哑光漆', multiplier: 1.5, description: '哑光漆，幅数乘以1.5倍' },
  { name: '变色龙漆', multiplier: 2.0, description: '变色龙漆，幅数乘以2.0倍' },
];

const FSST_STANDARDS: Record<string, { coefficient: number; unit?: string }> = {
  door: { coefficient: 1.0 },
  door_inner_outer: { coefficient: 1.1 },
  door_half: { coefficient: 0.5 },
  fender: { coefficient: 0.8 },
  hood: { coefficient: 1.3 },
  hood_inner_outer: { coefficient: 1.4 },
  trunk: { coefficient: 1.1 },
  trunk_inner_outer: { coefficient: 1.2 },
  roof_sunroof: { coefficient: 1.3 },
  roof_no_sunroof: { coefficient: 1.6 },
  bumper: { coefficient: 1.2 },
  bumper_new: { coefficient: 1.3 },
  bumper_half: { coefficient: 0.6 },
  skirt: { coefficient: 0.5 },
  spoiler: { coefficient: 0.5 },
  pillar: { coefficient: 0.3 },
  mirror_fender_lamp: { coefficient: 0.2 },
  strut_mount: { coefficient: 0.3 },
  firewall: { coefficient: 0.5 },
  wheel_refurbish: { coefficient: 0.2 },
  matte_paint: { coefficient: 1.6 },
  door_hinge_handle: { coefficient: 0.1 },
  door_frame_rail: { coefficient: 0.3 },
  grille: { coefficient: 0.3 },
  rear_floor: { coefficient: 0.3 },
  spare_tire_panel: { coefficient: 0.3 },
  bumper_lower: { coefficient: 0.3 },
  trim_strip: { coefficient: 0.2 },
  polish: { coefficient: 0.1 },
  full_car_exterior: { coefficient: 13 },
  full_car_all: { coefficient: 16 },
  mpv_exterior: { coefficient: 15 },
  mpv_all: { coefficient: 18 },
};

const JMHX_STANDARDS: Record<string, { coefficient: number; unit?: string }> = {
  door: { coefficient: 1.0 },
  door_inner_outer: { coefficient: 1.3 },
  door_half: { coefficient: 0.6 },
  fender: { coefficient: 0.8 },
  hood: { coefficient: 1.4 },
  hood_inner_outer: { coefficient: 1.8 },
  trunk: { coefficient: 1.2 },
  trunk_inner_outer: { coefficient: 1.5 },
  roof: { coefficient: 1.5 },
  bumper: { coefficient: 1.2 },
  bumper_half_hx: { coefficient: 0.8 },
  skirt_only: { coefficient: 0.5 },
  spoiler: { coefficient: 0.5 },
  door_step: { coefficient: 0.5 },
  mirror_only: { coefficient: 0.3 },
  mudguard: { coefficient: 0.3 },
  radar: { coefficient: 0.3 },
  gantry: { coefficient: 0.3 },
  grille: { coefficient: 0.3 },
  rear_panel: { coefficient: 0.6 },
  front_guard: { coefficient: 0.5 },
  bumper_lower_trim: { coefficient: 0.3 },
  polish: { coefficient: 10, unit: '元' },
  full_car_exterior: { coefficient: 13 },
  full_car_all: { coefficient: 15 },
  full_color_change: { coefficient: 18 },
};

async function seed() {
  console.log('🎨 开始初始化喷漆幅数统计系统...');

  // 1. 创建标准模板
  for (const tpl of STANDARD_TEMPLATES) {
    const existing = await prisma.paintStandardTemplate.findFirst({ where: { name: tpl.name } });
    if (!existing) {
      await prisma.paintStandardTemplate.create({ data: tpl });
      console.log(`  ✅ 标准模板已创建: ${tpl.name}`);
    } else {
      console.log(`  ⏭️  标准模板已存在: ${tpl.name}`);
    }
  }

  // 2. 创建门店（关联标准模板）
  const fsstTemplate = await prisma.paintStandardTemplate.findFirst({ where: { name: '喷涂板件工时计价表（盛通）' } });
  const jmhxTemplate = await prisma.paintStandardTemplate.findFirst({ where: { name: '油漆幅数统计标准（宏现）' } });

  for (const shop of SHOPS) {
    const existing = await prisma.paintShop.findUnique({ where: { code: shop.code } });
    const templateId = shop.code === 'FSST' ? fsstTemplate?.id : jmhxTemplate?.id;
    if (!existing) {
      await prisma.paintShop.create({ data: { ...shop, standardTemplateId: templateId || undefined } });
      console.log(`  ✅ 店铺已创建: ${shop.name}`);
    } else {
      // 更新关联的标准模板
      if (templateId && !existing.standardTemplateId) {
        await prisma.paintShop.update({ where: { code: shop.code }, data: { standardTemplateId: templateId } });
      }
      console.log(`  ⏭️  店铺已存在: ${shop.name}`);
    }
  }

  // 3. 创建项目类别
  for (const cat of CATEGORIES) {
    const existing = await prisma.paintItemCategory.findUnique({ where: { code: cat.code } });
    if (!existing) {
      await prisma.paintItemCategory.create({ data: cat });
    }
  }
  console.log(`  ✅ 喷漆项目类别已初始化 (${CATEGORIES.length}项)`);

  // 4. 创建特殊车漆
  for (const sp of SPECIAL_PAINTS) {
    const existing = await prisma.paintSpecialPaint.findFirst({ where: { name: sp.name } });
    if (!existing) {
      await prisma.paintSpecialPaint.create({ data: sp });
    }
  }
  console.log(`  ✅ 特殊车漆已初始化 (${SPECIAL_PAINTS.length}项)`);

  // 5. 为标准模板设置项目
  if (fsstTemplate) {
    let count = 0;
    for (const [code, std] of Object.entries(FSST_STANDARDS)) {
      const cat = await prisma.paintItemCategory.findUnique({ where: { code } });
      if (cat) {
        await prisma.paintStandardTemplateItem.upsert({
          where: { templateId_categoryId: { templateId: fsstTemplate.id, categoryId: cat.id } },
          update: { coefficient: std.coefficient, unit: std.unit || '幅' },
          create: { templateId: fsstTemplate.id, categoryId: cat.id, coefficient: std.coefficient, unit: std.unit || '幅' },
        });
        count++;
      }
    }
    console.log(`  ✅ 盛通标准模板项目已设置 (${count}项)`);
  }

  if (jmhxTemplate) {
    let count = 0;
    for (const [code, std] of Object.entries(JMHX_STANDARDS)) {
      const cat = await prisma.paintItemCategory.findUnique({ where: { code } });
      if (cat) {
        await prisma.paintStandardTemplateItem.upsert({
          where: { templateId_categoryId: { templateId: jmhxTemplate.id, categoryId: cat.id } },
          update: { coefficient: std.coefficient, unit: std.unit || '幅' },
          create: { templateId: jmhxTemplate.id, categoryId: cat.id, coefficient: std.coefficient, unit: std.unit || '幅' },
        });
        count++;
      }
    }
    console.log(`  ✅ 宏现标准模板项目已设置 (${count}项)`);
  }

  // 6. 为门店复制标准（从模板）
  const fsstShop = await prisma.paintShop.findUnique({ where: { code: 'FSST' } });
  const jmhxShop = await prisma.paintShop.findUnique({ where: { code: 'JMHX' } });

  if (fsstShop) {
    let count = 0;
    for (const [code, std] of Object.entries(FSST_STANDARDS)) {
      const cat = await prisma.paintItemCategory.findUnique({ where: { code } });
      if (cat) {
        await prisma.paintStandard.upsert({
          where: { shopId_categoryId: { shopId: fsstShop.id, categoryId: cat.id } },
          update: { coefficient: std.coefficient, unit: std.unit || '幅' },
          create: { shopId: fsstShop.id, categoryId: cat.id, coefficient: std.coefficient, unit: std.unit || '幅' },
        });
        count++;
      }
    }
    console.log(`  ✅ 佛山盛通幅数标准已设置 (${count}项)`);
  }

  if (jmhxShop) {
    let count = 0;
    for (const [code, std] of Object.entries(JMHX_STANDARDS)) {
      const cat = await prisma.paintItemCategory.findUnique({ where: { code } });
      if (cat) {
        await prisma.paintStandard.upsert({
          where: { shopId_categoryId: { shopId: jmhxShop.id, categoryId: cat.id } },
          update: { coefficient: std.coefficient, unit: std.unit || '幅' },
          create: { shopId: jmhxShop.id, categoryId: cat.id, coefficient: std.coefficient, unit: std.unit || '幅' },
        });
        count++;
      }
    }
    console.log(`  ✅ 江门宏现幅数标准已设置 (${count}项)`);
  }

  console.log('🎨 喷漆幅数统计系统初始化完成!');
}

seed()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
