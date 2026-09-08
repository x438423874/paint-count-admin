import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.paintWorkOrder.findMany({
    where: {
      status: { notIn: ['SETTLED', 'ABNORMAL'] as any },
      settlements: { some: {} },
    },
    select: { id: true, orderNo: true, status: true },
  });

  console.log(`Found ${orders.length} orders with settlements but status not SETTLED/ABNORMAL`);

  for (const order of orders) {
    await prisma.paintWorkOrder.update({
      where: { id: order.id },
      data: { status: 'SETTLED' as any },
    });
    console.log(`Updated ${order.id} (${order.orderNo || 'no orderNo'}) from ${order.status} to SETTLED`);
  }

  console.log('Done');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
