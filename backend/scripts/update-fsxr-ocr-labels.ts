import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const fsxrLabels = {
    orderNo: ['工单号', '作业单号', '单号', '工单编号', '编号', '订单号', '维修单号', '派工单'],
    plateNumber: ['车牌号', '车牌', '号牌', '车牌号码'],
    customerName: ['车主姓名', '客户名称', '客户姓名', '客户', '姓名', '车主', '送修人'],
    phone: ['手机号', '送修人手机', '联系电话', '电话', '手机', '联系方式', '联系手机', '联系人'],
    carModel: ['车型', '车名车型', '车辆型号', '车型型号', '车辆类型', '厂牌车名', '车系'],
    date: ['开单日期', '接车时间', '接车日期', '开单时间', '进厂日期', '进厂时间', '打印日期', '打印时间'],
  }

  await prisma.paintShop.update({
    where: { id: 'cmr0sa6c20000qr1k4xb9hags' },
    data: { ocrFieldLabels: JSON.stringify(fsxrLabels) },
  })

  console.log('佛山讯锐 OCR 字段别名已更新')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
