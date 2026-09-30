/**
 * 客户信息脱敏工具（按权限点 paint:work-order:view-customer 控制是否下发明文）。
 */
export function maskCustomerName(name?: string | null): string | null {
  if (!name) return name ?? null;
  if (name.length <= 1) return name;
  return name[0] + '*'.repeat(name.length - 1);
}

export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\s/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
  return '****';
}

/** VIN 脱敏：保留后 6 位（维修行业识别惯例），其余打码 */
export function maskVin(vin?: string | null): string | null {
  if (!vin) return vin ?? null;
  const v = vin.trim();
  if (v.length <= 6) return v;
  return `******${v.slice(-6)}`;
}
