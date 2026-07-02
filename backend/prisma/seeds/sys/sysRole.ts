import { Prisma } from '@prisma/client';

import { prisma } from '../helper';

export const initSysRole = async () => {
  const data: Prisma.SysRoleCreateInput[] = [
    {
      id: '1',
      code: 'ROLE_SUPER',
      name: '超级管理员',
      description: '超级管理员，可访问所有门店数据',
      pid: '0',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
    {
      id: '2',
      code: 'ROLE_ADMIN',
      name: '管理员',
      description: '管理员',
      pid: '1',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
    {
      id: '3',
      code: 'ROLE_USER',
      name: '用户',
      description: '用户',
      pid: '1',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
    {
      id: '10',
      code: 'ROLE_SHOP_ADMIN',
      name: '门店管理员',
      description: '门店管理员，可管理本门店全部工单（含审核/删除）',
      pid: '1',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
    {
      id: '11',
      code: 'ROLE_SHOP_STAFF',
      name: '门店员工',
      description: '门店员工，可创建/查看/编辑本门店工单，不能审核和删除',
      pid: '1',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
    {
      id: '12',
      code: 'ROLE_FINANCE',
      name: '财务',
      description: '财务，可查看全部门店工单和统计并导出，不能编辑',
      pid: '1',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
    {
      id: '13',
      code: 'ROLE_VIEWER',
      name: '只读用户',
      description: '只读用户，可查看指定门店数据，不能编辑',
      pid: '1',
      status: 'ENABLED',
      createdBy: '-1',
      updatedAt: null,
      updatedBy: null,
    },
  ];

  return prisma.sysRole.createMany({ data });
};
