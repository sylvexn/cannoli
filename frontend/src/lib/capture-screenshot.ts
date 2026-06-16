/**
 * Captures a screenshot of the current page using html2canvas.
 *
 * Known limitations:
 *  - WebGL/canvas regions render blank (tainted by browser security policy).
 *  - Cross-origin images may taint the canvas and cause a null return.
 */
export async function captureScreenshot(): Promise<File | null> {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      scale: 1,
      logging: false,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#000',
    });
    const blob = await new Promise<Blob | null>(res =>
      canvas.toBlob(res, 'image/png'),
    );
    if (!blob) return null;
    return new File([blob], 'screenshot.png', { type: 'image/png' });
  } catch {
    return null;
  }
}
