import { Platform, TFile } from 'obsidian'
import WebWorker from 'web-worker:./pdf-worker.ts'
import {
  CANT_EXTRACT_ON_MOBILE,
  FAILED_TO_EXTRACT,
  pdfProcessQueue,
  workerTimeout,
} from '../globals'
import { getCachePath, readCache, writeCache } from '../cache'

class PDFWorker {
  static #pool: PDFWorker[] = []
  #running = false

  private constructor(private worker: Worker) { }

  static getWorker(): PDFWorker {
    const free = PDFWorker.#pool.find(w => !w.#running)
    if (free) {
      return free
    }
    // Spawn a new worker
    const worker = new PDFWorker(new WebWorker({ name: 'PDF Text Extractor' }))
    PDFWorker.#pool.push(worker)
    return worker
  }

  static #destroyWorker(pdfWorker: PDFWorker) {
    pdfWorker.worker.terminate()
    PDFWorker.#pool = PDFWorker.#pool.filter(w => w !== pdfWorker)
  }

  public async run(msg: { data: string; name: string }): Promise<any> {
    console.log("Running PDFWorker for " + msg.name)
    return new Promise((resolve, reject) => {
      this.#running = true

      const timeout = setTimeout(() => {
        console.warn('Text Extractor - PDF Worker timeout for ', msg.name)
        reject('timeout')
        PDFWorker.#destroyWorker(this)
      }, workerTimeout)

      this.worker.postMessage(msg)
      this.worker.onmessage = evt => {
        console.log("PDFWorker finished for " + msg.name)
        clearTimeout(timeout)
        resolve(evt)
        this.#running = false
      }
    })
  }
}

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

    if (Platform.isMobile) {
      return CANT_EXTRACT_ON_MOBILE
    }

    // The PDF is not cached, extract it
    const cachePath = getCachePath(file)
    const worker = PDFWorker.getWorker()

    return new Promise(async (resolve, reject) => {
      try {
        const res = await worker.run({ data: file.path, name: file.basename })
        const text = (res.data.text as string)
          // Replace \n with spaces
          .replace(/\n/g, ' ')
          // Trim multiple spaces
          .replace(/ +/g, ' ')
          .trim()

        // Add it to the cache
        await writeCache(cachePath.folder, cachePath.filename, text, file.path, '')
        // Add a delay to prevent out-of-memory crash (hopefully garbage collection will run more often)
        setTimeout(() => {
          resolve(text)
        }, 10000)
      } catch (e) {
        // In case of error (unreadable PDF or timeout) just add
        // an empty string to the cache
        await writeCache(cachePath.folder, cachePath.filename, '', file.path, '')
        resolve('')
      }
    })
  }
}

export const pdfManager = new PDFManager()
