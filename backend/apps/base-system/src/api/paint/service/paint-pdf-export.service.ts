import { Injectable } from '@nestjs/common';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import { PaintStatisticsService } from './paint-statistics.service';

// 注册字体（兼容不同版本的 pdfmake vfs_fonts 导出格式）
(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs || pdfFonts;

interface ExportRow {
  工单号: string;
  门店: string;
  门店编码: string;
  工单日期: string;
  结算月份: string;
  车牌号: string;
  车型: string;
  客户名称: string;
  总幅数: number;
  是否审核: string;
  审核时间: string;
  审核人: string;
  状态: string;
  备注: string;
}

@Injectable()
export class PaintPdfExportService {
  constructor(private readonly statisticsService: PaintStatisticsService) {}

  /**
   * 导出月度统计 PDF
   *
   * PDF 结构：
   * 1. 标题：喷漆幅数统计 - YYYY-MM
   * 2. 汇总信息：工单数、总幅数、已审核/待审核
   * 3. 明细表格：工单号、日期、车牌、车型、幅数、审核状态
   *
   * 注意：PDF 表格列数有限，只展示关键列；完整数据请使用 Excel 导出
   */
  async exportMonthlyPdf(
    settlementMonth: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<Buffer> {
    const data = await this.statisticsService.getExportData(
      settlementMonth,
      shopId,
      accessibleShopIds,
    );

    // 汇总统计
    const totalOrders = data.length;
    const totalPaintCount = data.reduce((sum, r) => sum + (r.总幅数 || 0), 0);
    const auditedCount = data.filter(r => r.是否审核 === '是').length;
    const pendingCount = totalOrders - auditedCount;

    // 构造表格行（只展示关键列，避免 PDF 过宽）
    const tableBody: any[][] = [
      // 表头
      [
        { text: '工单号', style: 'tableHeader' },
        { text: '日期', style: 'tableHeader' },
        { text: '车牌号', style: 'tableHeader' },
        { text: '车型', style: 'tableHeader' },
        { text: '幅数', style: 'tableHeader', alignment: 'right' },
        { text: '审核', style: 'tableHeader' },
      ],
    ];

    for (const row of data) {
      tableBody.push([
        row.工单号 || '-',
        row.工单日期 || '-',
        row.车牌号 || '-',
        row.车型 || '-',
        { text: row.总幅数.toFixed(2), alignment: 'right' },
        row.是否审核,
      ]);
    }

    // 合计行
    tableBody.push([
      { text: '合计', colSpan: 4, style: 'tableFooter' },
      '',
      '',
      '',
      { text: totalPaintCount.toFixed(2), alignment: 'right', style: 'tableFooter' },
      { text: `${auditedCount}/${totalOrders}`, style: 'tableFooter' },
    ]);

    const docDefinition = {
      pageSize: 'A4' as const,
      pageOrientation: 'landscape' as const,
      pageMargins: [30, 40, 30, 40],
      defaultStyle: {
        fontSize: 9,
      },
      content: [
        // 标题
        {
          text: `Paint Count Statistics - ${settlementMonth}`,
          style: 'title',
          alignment: 'center',
        },
        {
          text: `Generated: ${new Date().toISOString().split('T')[0]}`,
          style: 'subtitle',
          alignment: 'center',
        },
        // 汇总信息
        {
          style: 'summary',
          table: {
            widths: ['auto', 'auto', 'auto', 'auto'],
            body: [
              [
                { text: 'Total Orders', style: 'summaryLabel' },
                { text: String(totalOrders), style: 'summaryValue' },
                { text: 'Total Paint Count', style: 'summaryLabel' },
                { text: totalPaintCount.toFixed(2), style: 'summaryValue' },
              ],
              [
                { text: 'Audited', style: 'summaryLabel' },
                { text: String(auditedCount), style: 'summaryValue' },
                { text: 'Pending', style: 'summaryLabel' },
                { text: String(pendingCount), style: 'summaryValue' },
              ],
            ],
          },
          layout: 'noBorders',
          margin: [0, 10, 0, 20],
        },
        // 明细表格
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', '*', '*', 'auto', 'auto'],
            body: tableBody,
          },
          layout: {
            fillColor: (rowIndex: number) => {
              if (rowIndex === 0) return '#4472C4';
              if (rowIndex === tableBody.length - 1) return '#E2EFDA';
              return rowIndex % 2 === 0 ? '#F2F2F2' : null;
            },
            hLineColor: () => '#D0D0D0',
            vLineColor: () => '#D0D0D0',
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
          },
        },
        // 页脚说明
        {
          text: '\nNote: For complete data with Chinese characters, please use Excel export.',
          style: 'note',
          alignment: 'center',
        },
      ],
      styles: {
        title: {
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 5],
        },
        subtitle: {
          fontSize: 10,
          color: '#666666',
          margin: [0, 0, 0, 15],
        },
        summaryLabel: {
          fontSize: 10,
          color: '#666666',
          margin: [0, 2, 10, 2],
        },
        summaryValue: {
          fontSize: 11,
          bold: true,
          margin: [0, 2, 20, 2],
        },
        tableHeader: {
          bold: true,
          fontSize: 10,
          color: 'white',
          alignment: 'center',
        },
        tableFooter: {
          bold: true,
          fontSize: 10,
          fillColor: '#E2EFDA',
        },
        note: {
          fontSize: 8,
          color: '#999999',
          italics: true,
        },
      },
    };

    // 生成 PDF
    return new Promise((resolve, reject) => {
      const pdfDoc = (pdfMake as any).createPdf(docDefinition);
      pdfDoc.getBuffer((buffer: Buffer) => {
        if (buffer) resolve(buffer);
        else reject(new Error('PDF generation failed'));
      });
    });
  }
}
