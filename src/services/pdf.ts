import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { BusinessMetrics } from '../types';

/**
 * Поиск шрифтов с поддержкой кириллицы
 */
function getFontPaths() {
  const customRegular = path.resolve(process.cwd(), 'assets/fonts/Arial.ttf');
  const customBold = path.resolve(process.cwd(), 'assets/fonts/Arial-Bold.ttf');

  if (fs.existsSync(customRegular) && fs.existsSync(customBold)) {
    return { regular: customRegular, bold: customBold };
  }

  // Запасной системный путь для Windows
  const winRegular = 'C:/Windows/Fonts/arial.ttf';
  const winBold = 'C:/Windows/Fonts/arialbd.ttf';
  if (fs.existsSync(winRegular) && fs.existsSync(winBold)) {
    return { regular: winRegular, bold: winBold };
  }

  return null;
}

/**
 * Генерация брендированного PDF-отчета аудита бизнеса (A4)
 */
export async function generateAuditPdf(
  metrics: BusinessMetrics,
  reportText: string,
  niche?: string | null
): Promise<Buffer> {
  const cleanNiche = niche || 'Не указана';
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
        info: {
          Title: `Аудит отдела продаж CRM — ${metrics.portalOrDomain}`,
          Author: 'AI Business Analyst Bot',
          Subject: `Бизнес-аудит и анализ воронки для ${cleanNiche}`,
        },
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Настройка шрифтов с кириллицей
      const fonts = getFontPaths();
      if (fonts) {
        doc.registerFont('CustomRegular', fonts.regular);
        doc.registerFont('CustomBold', fonts.bold);
        doc.font('CustomRegular');
      }

      const primaryColor = '#1e3a8a';   // Deep Blue
      const secondaryColor = '#0284c7'; // Light Blue
      const darkColor = '#0f172a';      // Slate Dark
      const lightBg = '#f8fafc';        // Slate Light
      const greenColor = '#16a34a';     // Success Green
      const redColor = '#dc2626';       // Danger Red

      const fontBold = fonts ? 'CustomBold' : 'Helvetica-Bold';
      const fontRegular = fonts ? 'CustomRegular' : 'Helvetica';

      // ==========================================
      // 1. ШАПКА ДОКУМЕНТА (HEADER)
      // ==========================================
      doc.rect(40, 40, 515, 65).fill(primaryColor);

      doc.fillColor('#ffffff').font(fontBold).fontSize(16)
        .text('ОТЧЕТ ИИ-АУДИТА ОТДЕЛА ПРОДАЖ И ВОРОНКИ CRM', 55, 55, { width: 485 });

      const dateStr = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

      doc.fillColor('#cbd5e1').font(fontRegular).fontSize(9)
        .text(`Портал: ${metrics.portalOrDomain} (${metrics.crmType === 'bitrix24' ? 'Битрикс24' : 'amoCRM'})  |  Ниша: ${cleanNiche}  |  Дата: ${dateStr}`, 55, 80);

      doc.moveDown(3);

      // ==========================================
      // 2. БЛОК HEALTH CHECK & КЛЮЧЕВЫЕ МЕТРИКИ
      // ==========================================
      const startY = 120;
      doc.rect(40, startY, 515, 75).fill(lightBg);
      doc.rect(40, startY, 515, 75).stroke('#cbd5e1');

      const winRate = metrics.summary.winRatePercent;
      const score = winRate > 30 ? '8.5 / 10' : winRate > 15 ? '6.5 / 10' : '4.0 / 10';
      const scoreColor = winRate > 30 ? greenColor : winRate > 15 ? secondaryColor : redColor;

      // Score Box
      doc.fillColor(primaryColor).font(fontBold).fontSize(11).text('ЭФФЕКТИВНОСТЬ ВОРОНКИ:', 55, startY + 12);
      doc.fillColor(scoreColor).font(fontBold).fontSize(18).text(score, 55, startY + 28);

      // 3 Колонки метрик
      const col1 = 260;
      const col2 = 310;
      const col3 = 480;

      doc.fillColor(darkColor).font(fontRegular).fontSize(9).text('Выручка факт:', col1, startY + 15);
      doc.fillColor(greenColor).font(fontBold).fontSize(11).text(`${metrics.summary.totalRevenue.toLocaleString('ru-RU')} ₽`, col1, startY + 28);
      doc.fillColor(darkColor).font(fontRegular).fontSize(8).text(`Сделок: ${metrics.summary.wonDeals} из ${metrics.summary.totalDeals}`, col1, startY + 45);

      doc.fillColor(darkColor).font(fontRegular).fontSize(9).text('Пайплайн в работе:', col2, startY + 15);
      doc.fillColor(secondaryColor).font(fontBold).fontSize(11).text(`${metrics.summary.pipelineValue.toLocaleString('ru-RU')} ₽`, col2, startY + 28);
      doc.fillColor(darkColor).font(fontRegular).fontSize(8).text(`В работе: ${metrics.summary.inProgressDeals} сделок`, col2, startY + 45);

      doc.fillColor(darkColor).font(fontRegular).fontSize(9).text('Зависшие сделки:', col3, startY + 15);
      doc.fillColor(redColor).font(fontBold).fontSize(11).text(`${metrics.summary.stuckDealsCount} шт.`, col3, startY + 28);
      doc.fillColor(darkColor).font(fontRegular).fontSize(8).text(`Просрочек: ${metrics.tasks.overduePercent}%`, col3, startY + 45);

      // ==========================================
      // 3. ТАБЛИЦА МЕНЕДЖЕРОВ
      // ==========================================
      let currentY = startY + 95;
      doc.fillColor(primaryColor).font(fontBold).fontSize(12).text('📊 СВОДНЫЙ РЕЙТИНГ МЕНЕДЖЕРОВ ПО ПРОДАЖАМ', 40, currentY);
      currentY += 18;

      // Table Header
      doc.rect(40, currentY, 515, 20).fill('#e2e8f0');
      doc.fillColor(darkColor).font(fontBold).fontSize(8);
      doc.text('Менеджер', 45, currentY + 6);
      doc.text('Сделок', 180, currentY + 6);
      doc.text('Выиграно', 230, currentY + 6);
      doc.text('Win Rate', 290, currentY + 6);
      doc.text('Выручка', 350, currentY + 6);
      doc.text('Просрочки', 450, currentY + 6);
      currentY += 20;

      // Table Rows
      const topManagers = metrics.managers.slice(0, 4);
      for (const m of topManagers) {
        doc.rect(40, currentY, 515, 18).stroke('#f1f5f9');
        doc.fillColor(darkColor).font(fontRegular).fontSize(8);
        doc.text(m.name.slice(0, 24), 45, currentY + 5);
        doc.text(String(m.dealsCount), 180, currentY + 5);
        doc.text(String(m.wonDealsCount), 230, currentY + 5);
        doc.text(`${m.winRatePercent}%`, 290, currentY + 5);
        doc.text(`${m.totalRevenue.toLocaleString('ru-RU')} ₽`, 350, currentY + 5);
        doc.fillColor(m.overdueTasksCount > 0 ? redColor : greenColor).text(`${m.overdueTasksCount} шт.`, 450, currentY + 5);
        currentY += 18;
      }

      currentY += 15;

      // ==========================================
      // 4. ТЕКСТ СТРАТЕГИЧЕСКОГО ИИ-АУДИТА
      // ==========================================
      doc.fillColor(primaryColor).font(fontBold).fontSize(12).text('🧠 СТРАТЕГИЧЕСКИЙ РАЗБОР И РЕКОМЕНДАЦИИ ИИ', 40, currentY);
      currentY += 18;

      // Очистка markdown спецсимволов для аккуратного рендера в PDF
      const cleanBody = reportText
        .replace(/^[#*_\-`]{1,4}\s*/gm, '')
        .replace(/[*_`]/g, '')
        .trim();

      const paragraphs = cleanBody.split('\n\n');

      doc.font(fontRegular).fontSize(9).fillColor(darkColor);

      for (const p of paragraphs) {
        const trimmed = p.trim();
        if (!trimmed) continue;

        // Если это заголовок раздела
        if (/^\d+\.|\bHEALTH CHECK\b|\bРАЗБОР ВОРОНКИ\b|\bФИНАНСОВ\b|\bКРИТИЧЕСК\b|\bОЦЕНКА КОМАНДЫ\b|\bQUICK WINS\b/i.test(trimmed)) {
          if (doc.y > 720) {
            doc.addPage();
          }
          doc.moveDown(0.5);
          doc.font(fontBold).fontSize(10).fillColor(primaryColor).text(trimmed);
          doc.font(fontRegular).fontSize(9).fillColor(darkColor);
        } else {
          if (doc.y > 740) {
            doc.addPage();
          }
          doc.text(trimmed, {
            align: 'justify',
            lineGap: 2,
          });
          doc.moveDown(0.4);
        }
      }

      // ==========================================
      // 5. НУМЕРАЦИЯ СТРАНИЦ
      // ==========================================
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc.fillColor('#94a3b8').font(fontRegular).fontSize(8)
          .text(`Сгенерировано AI CRM Analyst  |  Страница ${i + 1} из ${totalPages}`, 40, 800, {
            align: 'center',
            width: 515,
          });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
