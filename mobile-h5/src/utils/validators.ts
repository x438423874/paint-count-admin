/**
 * 表单校验正则统一维护
 *
 * 原先 work-order(create, detail) / vehicle(edit) 各自复制一份，
 * 修改口径时容易漏改。此处统一，全端共用。
 */

// 车牌号正则：支持普通7位（省份+字母+5位）、新能源8位、旧6位（字母+5位字母数字）、临牌（后缀"临"）
// 省份含：31省市+使领+军警武警+军区(海空北沈兰济南广成武翼)
const PLATE_PROVINCE = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领军警海空北沈兰济南广成武翼'

export const plateNumberRegex = new RegExp(`^(([${PLATE_PROVINCE}][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳])|[A-Z][A-HJ-NP-Z0-9]{5})(?:临)?$`)

export const phoneRegex = /^1[3-9]\d{9}$/

export const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/
