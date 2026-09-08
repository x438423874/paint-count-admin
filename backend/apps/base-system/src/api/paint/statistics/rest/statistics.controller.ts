import { Controller, Get, Query, Res, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import ExcelJS from 'exceljs';
import { FastifyReply } from 'fastify';

import { AuthZGuard, UsePermissions } from '@lib/infra/casbin';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';

import type { OrderAccessScope } from '../../service/paint-calculation';
import { PaintPdfExportService } from '../../service/paint-pdf-export.service';
import { PaintStatisticsService, ExportOrderRow } from '../../service/paint-statistics.service';
import { UserShopService } from '../../service/user-shop.service';






/** 工单汇总表头（与 ExportOrderRow 字段顺序一致） */
const SUMMARY_HEADERS = [
  '工单号', '门店', '门店编码', '工单日期', '结算月份', '车牌号', '车型', '客户名称',
  '总幅数', '计入统计幅数', '是否返工', '是否调整单', '是否审核', '审核时间', '审核人', '状态', '备注',
] as const;

const SUMMARY_WIDTHS = [20, 16, 12, 12, 12, 12, 12, 12, 10, 14, 10, 12, 10, 12, 10, 10, 20];

/** 项目明细表头 */
const DETAIL_HEADERS = ['工单号', '门店', '车牌号', '部位', '数量', '幅数', '是否新件', '特殊车漆', '车漆倍数'] as const;
const DETAIL_WIDTHS = [20, 16, 12, 14, 8, 10, 10, 14, 10];

@ApiTags('Paint - Statistics')
@Controller('paint/statistics')
@Throttle({ default: { limit: 60, ttl: 60000 } }) // 统计查询：每分钟 60 次
export class PaintStatisticsController {
  constructor(
    private readonly statisticsService: PaintStatisticsService,
    private readonly userShopService: UserShopService,
    private readonly pdfExportService: PaintPdfExportService,
  ) {}

  @Get('latest-month')
  @ApiOperation({ summary: '获取有数据的最新结算月份' })
  async latestMonth(@Request() req: AuthenticatedRequest) {
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getLatestSettlementMonth(orderScope);
    return ApiRes.success(data);
  }

  /**
   * 统计看板聚合接口
   *
   * 一次返回月度统计、KPI 概览、门店对比、类别分布、年度趋势，
   * 避免前端并发 5 个请求、后端重复跑 3 次完整月度聚合。
   */
  @Get('dashboard')
  @ApiOperation({ summary: '统计看板聚合数据（月度+KPI+门店对比+类别分布+年度趋势）' })
  async dashboard(
    @Request() req: AuthenticatedRequest,
    @Query('settlementMonth') settlementMonth?: string,
    @Query('shopId') shopId?: string,
    @Query('year') year?: number,
  ) {
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getDashboard(settlementMonth, shopId, orderScope, year);
    return ApiRes.success(data);
  }

  @Get('monthly')
  @ApiOperation({ summary: '结算月幅数统计(按天汇总)' })
  async monthly(
    @Request() req: AuthenticatedRequest,
    @Query('settlementMonth') settlementMonth?: string,
    @Query('shopId') shopId?: string,
  ) {
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getMonthlyStatistics(settlementMonth, shopId, orderScope);
    return ApiRes.success(data);
  }

  @Get('overview')
  @ApiOperation({ summary: '月度概览 KPI' })
  async overview(
    @Request() req: AuthenticatedRequest,
    @Query('settlementMonth') settlementMonth?: string,
    @Query('shopId') shopId?: string,
  ) {
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getOverview(settlementMonth, shopId, orderScope);
    return ApiRes.success(data);
  }

  @Get('category')
  @ApiOperation({ summary: '项目类别幅数分布' })
  async categoryBreakdown(
    @Request() req: AuthenticatedRequest,
    @Query('settlementMonth') settlementMonth?: string,
    @Query('shopId') shopId?: string,
  ) {
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getCategoryBreakdown(settlementMonth, shopId, orderScope);
    return ApiRes.success(data);
  }

  @Get('comparison')
  @ApiOperation({ summary: '门店对比统计' })
  async shopComparison(@Request() req: AuthenticatedRequest, @Query('settlementMonth') settlementMonth?: string) {
    // 门店对比：非超管/财务仅返回自己绑定的门店数据
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getShopComparison(settlementMonth, orderScope);
    return ApiRes.success(data);
  }

  @Get('year-overview')
  @ApiOperation({ summary: '年度概览(按结算月)' })
  async yearOverview(
    @Request() req: AuthenticatedRequest,
    @Query('year') year?: number,
    @Query('shopId') shopId?: string,
  ) {
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getYearOverview(year, shopId, orderScope);
    return ApiRes.success(data);
  }

  // ==================== 导出 ====================

  /**
   * 导出权限校验：指定门店时要求该结算月份在用户任期内（超管/财务自动通过）
   */
  private async assertExportAccess(userId: string, settlementMonth: string, shopId?: string): Promise<void> {
    if (shopId) {
      await this.userShopService.assertShopMonthAccess(userId, shopId, settlementMonth);
    }
  }

  @Get('export/csv')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 每分钟5次：导出文件较大
  @ApiOperation({ summary: '导出月度统计CSV' })
  async exportCsv(
    @Query('settlementMonth') settlementMonth: string,
    @Query('shopId') shopId: string | undefined,
    @Res() res: FastifyReply,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.assertExportAccess(req.user.uid, settlementMonth, shopId);
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);
    const data = await this.statisticsService.getExportData(settlementMonth, shopId, orderScope);

    // 生成CSV，对包含逗号或引号的字段做转义
    const csvEscape = (val: any) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = data.map(row => [
      row.工单号, row.门店, row.门店编码, row.工单日期, row.结算月份,
      row.车牌号, row.车型, row.客户名称, row.总幅数, row.计入统计幅数,
      row.是否返工, row.是否调整单, row.是否审核,
      row.审核时间, row.审核人, row.状态, row.备注,
    ]);

    // BOM for Excel UTF-8
    const bom = '\uFEFF';
    const csvContent =
      bom + [SUMMARY_HEADERS.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename=paint-statistics-${settlementMonth}.csv`);
    res.send(csvContent);
  }

  @UseGuards(AuthZGuard)
  @UsePermissions({ resource: 'paint:statistics', action: 'export' })
  @Get('export/excel')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 每分钟5次：导出文件较大
  @ApiOperation({ summary: '导出月度统计Excel(xlsx格式，含工单汇总和项目明细两个Sheet)' })
  async exportExcel(
    @Query('settlementMonth') settlementMonth: string,
    @Query('shopId') shopId: string | undefined,
    @Res() res: FastifyReply,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.assertExportAccess(req.user.uid, settlementMonth, shopId);
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);

    // hijack 后由 ExcelJS 流式写入器直接接管响应流，
    // 避免 workbook.xlsx.writeBuffer() 把整个工作簿缓冲在内存里
    res.hijack();
    res.raw.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=paint-statistics-${settlementMonth}.xlsx`,
      'Cache-Control': 'no-cache',
    });

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res.raw, useStyles: true });
    workbook.creator = '喷漆幅数统计系统';
    workbook.created = new Date();

    await this.writeSummarySheet(workbook, settlementMonth, shopId, orderScope);
    await this.writeDetailSheet(workbook, settlementMonth, shopId, orderScope);

    await workbook.commit();
    if (!res.raw.writableEnded) res.raw.end();
  }

  /** Sheet1：工单汇总（流式写入） */
  private async writeSummarySheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    settlementMonth: string,
    shopId: string | undefined,
    orderScope: OrderAccessScope,
  ) {
    const sheet = workbook.addWorksheet('工单汇总');
    SUMMARY_WIDTHS.forEach((w, idx) => {
      sheet.getColumn(idx + 1).width = w;
    });

    const titleRow = sheet.addRow([`喷漆幅数统计 - ${settlementMonth}`]);
    titleRow.getCell(1).font = { size: 16, bold: true };
    titleRow.getCell(1).alignment = { horizontal: 'center' };
    titleRow.height = 30;
    titleRow.commit();

    const headerRow = sheet.addRow([...SUMMARY_HEADERS]);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headerRow.height = 22;
    headerRow.commit();

    let countedTotal = 0;
    for await (const batch of this.statisticsService.iterateExportData(settlementMonth, shopId, orderScope)) {
      for (const row of batch) {
        countedTotal += row.计入统计幅数;
        const dataRow = sheet.addRow([
          row.工单号, row.门店, row.门店编码, row.工单日期, row.结算月份,
          row.车牌号, row.车型, row.客户名称, row.总幅数, row.计入统计幅数,
          row.是否返工, row.是否调整单, row.是否审核,
          row.审核时间, row.审核人, row.状态, row.备注,
        ]);
        dataRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' },
          };
          if (colNumber === 9 || colNumber === 10) {
            cell.numFmt = '0.0';
          }
          cell.alignment = { vertical: 'middle' };
        });
        dataRow.commit();
      }
    }

    // 合计行：以「计入统计幅数」为准，保证与看板 KPI 完全一致
    const totalRow = sheet.addRow([]);
    totalRow.getCell(8).value = '合计(统计口径)';
    totalRow.getCell(8).font = { bold: true };
    totalRow.getCell(8).alignment = { horizontal: 'right' };
    totalRow.getCell(10).value = Number(countedTotal.toFixed(2));
    totalRow.getCell(10).font = { bold: true, color: { argb: 'FFC00000' } };
    totalRow.getCell(10).numFmt = '0.0';
    totalRow.eachCell(cell => {
      cell.border = {
        top: { style: 'double' }, bottom: { style: 'double' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    totalRow.commit();

    sheet.commit();
  }

  /** Sheet2：项目明细（流式写入） */
  private async writeDetailSheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    settlementMonth: string,
    shopId: string | undefined,
    orderScope: OrderAccessScope,
  ) {
    const sheet = workbook.addWorksheet('项目明细');
    DETAIL_WIDTHS.forEach((w, idx) => {
      sheet.getColumn(idx + 1).width = w;
    });

    const titleRow = sheet.addRow([`项目明细 - ${settlementMonth}`]);
    titleRow.getCell(1).font = { size: 16, bold: true };
    titleRow.getCell(1).alignment = { horizontal: 'center' };
    titleRow.height = 30;
    titleRow.commit();

    const headerRow = sheet.addRow([...DETAIL_HEADERS]);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headerRow.height = 22;
    headerRow.commit();

    let detailTotal = 0;
    for await (const batch of this.statisticsService.iterateExportData(settlementMonth, shopId, orderScope)) {
      for (const order of batch as ExportOrderRow[]) {
        // 返工单不计入统计口径，其明细也不应计入明细合计
        if (order.是否返工 === '是') continue;
        for (const item of order.项目明细) {
          detailTotal += item.幅数;
          const row = sheet.addRow([
            order.工单号, order.门店, order.车牌号,
            item.部位, item.数量, item.幅数,
            item.是否新件, item.特殊车漆, item.车漆倍数,
          ]);
          row.eachCell((cell, colNumber) => {
            cell.border = {
              top: { style: 'thin' }, bottom: { style: 'thin' },
              left: { style: 'thin' }, right: { style: 'thin' },
            };
            if (colNumber === 6) {
              cell.numFmt = '0.00';
            }
          });
          row.commit();
        }
      }
    }

    const detailTotalRow = sheet.addRow([]);
    detailTotalRow.getCell(5).value = '合计';
    detailTotalRow.getCell(5).font = { bold: true };
    detailTotalRow.getCell(5).alignment = { horizontal: 'right' };
    detailTotalRow.getCell(6).value = Number(detailTotal.toFixed(2));
    detailTotalRow.getCell(6).font = { bold: true, color: { argb: 'FFC00000' } };
    detailTotalRow.getCell(6).numFmt = '0.00';
    detailTotalRow.eachCell(cell => {
      cell.border = {
        top: { style: 'double' }, bottom: { style: 'double' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    detailTotalRow.commit();

    sheet.commit();
  }

  @Get('export/pdf')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 每分钟5次：PDF生成较重
  @ApiOperation({ summary: '导出月度统计PDF（A4横版，含汇总和明细表格）' })
  async exportPdf(
    @Query('settlementMonth') settlementMonth: string,
    @Query('shopId') shopId: string | undefined,
    @Res() res: FastifyReply,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.assertExportAccess(req.user.uid, settlementMonth, shopId);
    const orderScope = await this.userShopService.getOrderAccessScope(req.user.uid);

    const buffer = await this.pdfExportService.exportMonthlyPdf(
      settlementMonth,
      shopId,
      orderScope,
    );

    res.header('Content-Type', 'application/pdf');
    res.header('Content-Disposition', `attachment; filename="paint-statistics-${settlementMonth}.pdf"`);
    res.send(buffer);
  }
}
