const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.sysUser.findMany({
    select: { id: true, username: true, roleId: true },
    take: 20
  });
  console.log('Users:');
  console.log(JSON.stringify(users, null, 2));

  const roles = await prisma.sysRole.findMany({
    select: { id: true, roleName: true, roleCode: true },
    take: 20
  });
  console.log('\nRoles:');
  console.log(JSON.stringify(roles, null, 2));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
