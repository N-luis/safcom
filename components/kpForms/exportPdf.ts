/**
 * The PDF: each Letter page of the document, captured from the page itself
 * (the same component the preview shows, at its true size) - one image per
 * page, edge to edge, no added margins. Loaded only when an official exports.
 */
export async function exportPagesToPdf(pages: HTMLElement[], fileName: string): Promise<void> {
  if (!pages.length) throw new Error('Nothing to export');
  // The fonts must be in before the pages are captured, or the PDF uses a fallback.
  await document.fonts.ready;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  const pdf = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait', compress: true });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false, useCORS: true, width: 816, height: 1056 });
    if (i > 0) pdf.addPage('letter', 'portrait');
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 8.5, 11, undefined, 'FAST');
  }
  pdf.save(fileName);
}
