/**
 * Download data as CSV file
 */
export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (raw: string) => {
    // A leading = + - @ makes Excel read the cell as a formula: "+966…" turns into
    // 9.67E+11, and a crafted value could run. An invisible left-to-right mark
    // keeps it plain text (and keeps phone numbers reading left to right).
    const v = /^[=+\-@]/.test(raw) ? `‎${raw}` : raw;
    if (/[",\n]/.test(v)) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];

  // The BOM tells Excel the file is UTF-8; without it Arabic opens as gibberish.
  const blob = new Blob(['﻿', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
