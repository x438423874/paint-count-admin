import { showDialog } from 'vant'

export interface ConfirmOptions {
  title: string
  message: string
  /** 危险操作（删除等）：确认按钮标红，默认 false */
  danger?: boolean
  confirmButtonText?: string
}

/**
 * 统一确认弹窗
 *
 * 项目原先混用两种调用：
 * - `showDialog(...)`：vant 默认 **无取消按钮**
 * - `showConfirmDialog(...)`：默认有取消按钮
 *
 * 导致「确认删除 / 确认审核」这类弹窗有的可取消、有的不可取消。
 * 此处统一为带取消按钮，并集中维护跨页面复用的文案。
 *
 * @returns 确认时 resolve，取消/关闭时 reject（调用方用 .then/.catch 或 try/catch）
 */
export function confirmAction(options: ConfirmOptions): Promise<void> {
  return showDialog({
    title: options.title,
    message: options.message,
    showCancelButton: true,
    ...(options.confirmButtonText ? { confirmButtonText: options.confirmButtonText } : {}),
    ...(options.danger ? { confirmButtonColor: '#ee0a24' } : {}),
  }).then(() => undefined)
}

/**
 * 删除车辆确认
 * 该文案原先在「车辆列表页」与「车辆编辑页」逐字重复，改一处容易漏另一处。
 */
export function confirmDeleteVehicle(): Promise<void> {
  return confirmAction({
    title: '确认删除',
    message: '删除车辆不会删除关联工单，仅解除关联。确认删除？',
    danger: true,
  })
}
