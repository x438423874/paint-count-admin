import { IQueryResult } from '@nestjs/cqrs';

export class PaginationParams {
  constructor(
    public readonly current: number,
    public readonly size: number,
  ) {}
}

export class PaginationResult<T> implements IQueryResult {
  constructor(
    public readonly current: number,
    public readonly size: number,
    public readonly total: number,
    public readonly records: T[],
    public readonly totalPaintCount?: number,
  ) {}
}

export interface PageArgs {
  current: number;
  size: number;
  skip: number;
  take: number;
}

/** 由 current/size 统一换算 Prisma 分页参数（未传时默认第 1 页、每页 defaultSize 条） */
export function pageArgs(current?: number, size?: number, defaultSize = 10): PageArgs {
  const c = current ?? 1;
  const s = size ?? defaultSize;
  return { current: c, size: s, skip: (c - 1) * s, take: s };
}
