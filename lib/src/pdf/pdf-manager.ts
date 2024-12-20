import { Platform, TFile, loadPdfJs } from 'obsidian'
import {
  CANT_EXTRACT_ON_MOBILE,
  FAILED_TO_EXTRACT,
  pdfProcessQueue,
} from '../globals'
import { getCachePath, readCache, writeCache } from '../cache'

class PDFManager {
  public async getPdfText(file: TFile): Promise<string> {
    try {
      return await pdfProcessQueue.add(() => this.#getPdfText(file)) ?? ''
    } catch (e) {
      console.warn(
        `Text Extractor - Error while extracting text from ${file.basename}`
      )
      console.warn(e)
      return ''
    }
  }

  async #getPdfText(file: TFile): Promise<string> {
    // Get the text from the cache if it exists
    const cache = await readCache(file)
    if (cache) {
      return cache.text ?? FAILED_TO_EXTRACT
    }

    if (Platform.isMobileApp) {
      return CANT_EXTRACT_ON_MOBILE
    }

    // The PDF is not cached, extract it
    const cachePath = getCachePath(file)
    const data = new Uint8Array(await app.vault.readBinary(file))

    // Load the PDF.js library
    const pdfjs = await loadPdfJs()
    const loadingTask = pdfjs.getDocument({ data })
    const pdf = await loadingTask.promise
    const pagePromises = [];
    // Get text from each page of the PDF
    for (let j = 1; j <= pdf.numPages; j++) {
      const page = pdf.getPage(j);

      // @ts-ignore
      pagePromises.push(page.then((page) => {
        // @ts-ignore
        const textContentPromise: Promise<{ items }> = page.getTextContent();
        return textContentPromise.then((text) => {
          // @ts-ignore
          return text.items.map((s) => s).join('');
        });
      }));
    }

    const texts = await Promise.all(pagePromises);

    // Add it to the cache
    const text = texts.join(' ');
    await writeCache(cachePath.folder, cachePath.filename, text, file.path, '')

    return text

  }
}

export const pdfManager = new PDFManager()
