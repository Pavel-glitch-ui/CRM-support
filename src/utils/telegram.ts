import { Context } from 'telegraf';

const MAX_MESSAGE_LENGTH = 3800; // Безопасный запас для Telegram (лимит 4096)
const MAX_CAPTION_LENGTH = 900;  // Безопасный запас для caption (лимит 1024)

/**
 * Безопасное разделение длинного текста на части по абзацам
 */
export function splitTextIntoChunks(text: string, maxChunkLength = MAX_MESSAGE_LENGTH): string[] {
  if (!text || text.length <= maxChunkLength) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const p of paragraphs) {
    if ((currentChunk + '\n\n' + p).length > maxChunkLength) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Если сам абзац гигантский, делим по строкам
      if (p.length > maxChunkLength) {
        const lines = p.split('\n');
        for (const line of lines) {
          if ((currentChunk + '\n' + line).length > maxChunkLength) {
            if (currentChunk.trim().length > 0) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
            // Если даже одна строка длиннее лимита, режем по символам
            if (line.length > maxChunkLength) {
              let remaining = line;
              while (remaining.length > maxChunkLength) {
                chunks.push(remaining.slice(0, maxChunkLength));
                remaining = remaining.slice(maxChunkLength);
              }
              currentChunk = remaining;
            } else {
              currentChunk = line;
            }
          } else {
            currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
          }
        }
      } else {
        currentChunk = p;
      }
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${p}` : p;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Безопасная отправка текстового сообщения любой длины без ошибок 400
 */
export async function sendSafeText(
  ctx: Context,
  text: string,
  extra: any = { parse_mode: 'Markdown' }
): Promise<void> {
  const chunks = splitTextIntoChunks(text);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      await ctx.reply(chunk, extra);
    } catch (err: any) {
      // Если Telegram ругается на некорректный Markdown, пробуем отправить без разметки
      if (err.description?.includes('can\'t parse entities') || err.message?.includes('parse')) {
        await ctx.reply(chunk.replace(/[*_`\[\]]/g, ''));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Отправка полного отчета в виде текстового файла .txt с подписью и инлайн-клавиатурой
 */
export async function sendAuditTxtFile(
  ctx: Context,
  fullText: string,
  filenamePrefix = 'CRM_Audit_Report',
  caption = '📋 Полный отчет аудита сформирован и прикреплен в текстовом файле.',
  extra: any = {}
): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanPrefix = filenamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanPrefix}_${dateStr}.txt`;

  const fileBuffer = Buffer.from(fullText, 'utf-8');

  const safeCaption = caption.length > MAX_CAPTION_LENGTH
    ? caption.slice(0, MAX_CAPTION_LENGTH - 3) + '...'
    : caption;

  await ctx.replyWithDocument(
    {
      source: fileBuffer,
      filename,
    },
    {
      caption: safeCaption,
      parse_mode: 'Markdown',
      ...extra,
    }
  );
}
