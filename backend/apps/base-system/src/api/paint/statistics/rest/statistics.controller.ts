import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintStatisticsService } from '../../service/paint-statistics.service';
import { ApiRes } from '@lib/infra/rest/res.response';
import { FastifyReply } from 'fastify';

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
  @ApiOperation({ summary: '导出月度统计Excel(简单HTML表格格式)' })
  async exportExcel(
    @Query('settlementMonth') settlementMonth: string,
    @Query('shopId') shopId: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const data = await this.statisticsService.getExportData(settlementMonth, shopId);

    // 使用HTML表格格式生成xls（兼容Excel，无需额外依赖）
    const htmlEscape = (val: any) => String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const headers = ['工单号', '门店', '门店编码', '工单日期', '结算月份', '车牌号', '车型', '客户名称', '总幅数', '是否审核', '审核时间', '审核人', '状态', '备注'];
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">';
    html += '<tr>' + headers.map(h => `<th style="background:#4472C4;color:white;font-weight:bold">${h}</th>`).join('') + '</tr>';

    for (const row of data) {
      html += '<tr>';
      html += `<td>${htmlEscape(row.工单号)}</td><td>${htmlEscape(row.门店)}</td><td>${htmlEscape(row.门店编码)}</td><td>${htmlEscape(row.工单日期)}</td><td>${htmlEscape(row.结算月份)}</td>`;
      html += `<td>${htmlEscape(row.车牌号)}</td><td>${htmlEscape(row.车型)}</td><td>${htmlEscape(row.客户名称)}</td><td>${row.总幅数}</td><td>${htmlEscape(row.是否审核)}</td>`;
      html += `<td>${htmlEscape(row.审核时间)}</td><td>${htmlEscape(row.审核人)}</td><td>${htmlEscape(row.状态)}</td><td>${htmlEscape(row.备注)}</td>`;
      html += '</tr>';
    }
    html += '</table></body></html>';

    res.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename=paint-statistics-${settlementMonth}.xls`);
    res.send(html);
  }
}
