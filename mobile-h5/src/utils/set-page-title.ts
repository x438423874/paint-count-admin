export default function setPageTitle(name?: string | symbol): void {
  const nameMap: Record<string, string> = {
    Home: '喷漆幅数管理',
    WorkOrder: '工单列表',
    WorkOrderDetail: '工单详情',
    WorkOrderCreate: '创建工单',
    Statistics: '数据统计',
    Profile: '我的',
    Login: '登录',
  }
  const title = nameMap[name as string] || '喷漆幅数管理'
  window.document.title = name ? `${title} - 喷漆幅数管理` : '喷漆幅数管理'
}
