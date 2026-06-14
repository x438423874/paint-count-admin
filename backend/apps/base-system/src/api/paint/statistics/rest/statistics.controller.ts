import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintStatisticsService } from '../../service/paint-statistics.service';
import { ApiRes } from '@lib/infra/rest/res.response';
import { FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';

@ApiTags('Paint - Statistics')
@Controller('paint/statistics')
export class PaintStatisticsController {
  constructor(private readonly statisticsService: PaintStatisticsService) {}

  @Get('monthly')
  @ApiOperation({ summary: '结算月幅数统计(按天汇总)' })
  async monthly(@Query('settlementMonth') settlementMonth?: string, @Query('shopId') shopId?: string) {
    const data = await this.statisticsService.getMonthlyStatistics(settlementMonth, shopId);
    return ApiRes.success(data);
  }

  @Get('category')
  @ApiOperation({ summary: '项目类别幅数分布' })
  async categoryBreakdown(@Query('settlementMonth') settlementMonth?: string, @Query('shopId') shopId?: string) {
    const data = await this.statisticsService.getCategoryBreakdown(settlementMonth, shopId);
    return ApiRes.success(data);
  }

  @Get('comparison')
  @ApiOperation({ summary: '门店对比统计' })
  async shopComparison(@Query('settlementMonth') settlementMonth?: string) {
    const data = await this.statisticsService.getShopComparison(settlementMonth);
    return ApiRes.success(data);
  }

  @Get('year-overview')
  @ApiOperation({ summary: '年度概览(按结算月)' })
  async yearOverview(@Query('year') year?: number, @Query('shopId') shopId?: string) {
    const data = await this.statisticsService.getYearOverview(year, shopId);
    return ApiRes.success(data);
  }

  @Get('export/csv')
  @ApiOperation({ summary: '导出月度统计CSV' })
  async exportCsv(
    @Query('settlementMonth') settlementMonth: string,
    @Query('shopId') shopId: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const data = await this.statisticsService.getExportData(settlementMonth, shopId);

    // 生成CSV，对包含逗号或引号的字段做转义
    const csvEscape = (val: any) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const headers = ['工单号', '门店', '门店编码', '工单日期', '结算月份', '车牌号', '车型', '客户名称', '总幅数', '是否审核', '审核时间', '审核人', '状态', '备注'];
    const rows = data.map(row => [
      row.工单号, row.门店, row.门店编码, row.工单日期, row.结算月份,
      row.车牌号, row.车型, row.客户名称, row.总幅数, row.是否审核,
      row.审核时间, row.审核人, row.状态, row.备注,
    ]);

    // BOM for Excel UTF-8
    const bom = '\uFEFF';
    const csvContent = bom + [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename=paint-statistics-${settlementMonth}.csv`);
    res.send(csvContent);
  }

  @Get('export/excel')
  @ApiOperation({ summary: '导出月度统计Excel(xlsx格式，含工单汇总和项目明细两个Sheet)' })
  async exportExcel(
    @Query('settlementMonth') settlementMonth: string,
    @Query('shopId') shopId: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const data = await this.statisticsService.getExportData(settlementMonth, shopId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '喷漆幅数统计系统';
    workbook.created = new Date();

    // ===== Sheet1: 工单汇总 =====
    const summarySheet = workbook.addWorksheet('工单汇总');
    const summaryHeaders = ['工单号', '门店', '门店编码', '工单日期', '结算月份', '车牌号', '车型', '客户名称', '总幅数', '是否审核', '审核时间', '审核人', '状态', '备注'];

    // 标题行
    const titleRow = summarySheet.addRow([`喷漆幅数统计 - ${settlementMonth}`]);
    summarySheet.mergeCells('A1:N1');
    titleRow.getCell(1).font = { size: 16, bold: true };
    titleRow.getCell(1).alignment = { horizontal: 'center' };
    titleRow.height = 30;

    // 表头
    const headerRow = summarySheet.addRow(summaryHeaders);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headerRow.height = 22;

    // 数据行
    let totalPaintCount = 0;
    for (const row of data) {
      totalPaintCount += row.总幅数;
      const dataRow = summarySheet.addRow([
        row.工单号, row.门店, row.门店编码, row.工单日期, row.结算月份,
        row.车牌号, row.车型, row.客户名称, row.总幅数, row.是否审核,
        row.审核时间, row.审核人, row.状态, row.备注,
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
        if (colNumber === 9) {
          cell.numFmt = '0.0';
        }
        cell.alignment = { vertical: 'middle' };
      });
    }

    // 合计行
    const totalRow = summarySheet.addRow([]);
    totalRow.getCell(8).value = '合计';
    totalRow.getCell(8).font = { bold: true };
    totalRow.getCell(8).alignment = { horizontal: 'right' };
    totalRow.getCell(9).value = totalPaintCount;
    totalRow.getCell(9).font = { bold: true, color: { argb: 'FFC00000' } };
    totalRow.getCell(9).numFmt = '0.0';
    totalRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'double' }, bottom: { style: 'double' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // 列宽自适应
    summarySheet.getColumn(1).width = 20;
    summarySheet.getColumn(2).width = 16;
    summarySheet.getColumn(3).width = 12;
    summarySheet.getColumn(4).width = 12;
    summarySheet.getColumn(5).width = 12;
    summarySheet.getColumn(6).width = 12;
    summarySheet.getColumn(7).width = 12;
    summarySheet.getColumn(8).width = 12;
    summarySheet.getColumn(9).width = 10;
    summarySheet.getColumn(10).width = 10;
    summarySheet.getColumn(11).width = 12;
    summarySheet.getColumn(12).width = 10;
    summarySheet.getColumn(13).width = 10;
    summarySheet.getColumn(14).width = 20;

    // ===== Sheet2: 项目明细 =====
    const detailSheet = workbook.addWorksheet('项目明细');
    const detailHeaders = ['工单号', '门店', '车牌号', '部位', '数量', '幅数', '是否新件', '特殊车漆', '车漆倍数'];

    const detailTitleRow = detailSheet.addRow([`项目明细 - ${settlementMonth}`]);
    detailSheet.mergeCells('A1:I1');
    detailTitleRow.getCell(1).font = { size: 16, bold: true };
    detailTitleRow.getCell(1).alignment = { horizontal: 'center' };
    detailTitleRow.height = 30;

    const detailHeaderRow = detailSheet.addRow(detailHeaders);
    detailHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    detailHeaderRow.height = 22;

    let detailTotalPaintCount = 0;
    for (const order of data) {
      for (const item of order.项目明细) {
        detailTotalPaintCount += item.幅数;
        const row = detailSheet.addRow([
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
      }
    }

    // 明细合计行
    const detailTotalRow = detailSheet.addRow([]);
    detailTotalRow.getCell(5).value = '合计';
    detailTotalRow.getCell(5).font = { bold: true };
    detailTotalRow.getCell(5).alignment = { horizontal: 'right' };
    detailTotalRow.getCell(6).value = detailTotalPaintCount;
    detailTotalRow.getCell(6).font = { bold: true, color: { argb: 'FFC00000' } };
    detailTotalRow.getCell(6).numFmt = '0.00';
    detailTotalRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'double' }, bottom: { style: 'double' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    detailSheet.getColumn(1).width = 20;
    detailSheet.getColumn(2).width = 16;
    detailSheet.getColumn(3).width = 12;
    detailSheet.getColumn(4).width = 14;
    detailSheet.getColumn(5).width = 8;
    detailSheet.getColumn(6).width = 10;
    detailSheet.getColumn(7).width = 10;
    detailSheet.getColumn(8).width = 14;
    detailSheet.getColumn(9).width = 10;

    // 生成buffer并返回
    const buffer = await workbook.xlsx.writeBuffer();
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename=paint-statistics-${settlementMonth}.xlsx`);
    res.send(buffer);
  }
}
