function escapeField(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  // Neutraliza injeção de fórmula (Excel/Sheets interpretam =,+,-,@ no início
  // da célula como fórmula — manchete/legenda são texto de IA/usuário).
  if (/^[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * CSV RFC-4180 com BOM UTF-8 (Excel pt-BR abre com acentuação correta
 * sem importação manual).
 */
export function toCsv(
  headers: string[],
  rows: (string | number | null)[][]
): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeField).join(",")
  );
  return "﻿" + lines.join("\r\n") + "\r\n";
}
