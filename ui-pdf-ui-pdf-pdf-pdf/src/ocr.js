(function () {
  "use strict";

  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 2200;
  const LANGUAGE_PATH = "https://tessdata.projectnaptha.com/4.0.0";
  const STATUS_LABELS = {
    "loading tesseract core": "OCR\u30a8\u30f3\u30b8\u30f3\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059",
    "initializing tesseract": "OCR\u30a8\u30f3\u30b8\u30f3\u3092\u521d\u671f\u5316\u3057\u3066\u3044\u307e\u3059",
    "loading language traineddata": "\u65e5\u672c\u8a9e\u30e2\u30c7\u30eb\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059",
    "initializing api": "\u8a8d\u8b58\u51e6\u7406\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059",
    "recognizing text": "\u753b\u50cf\u306e\u6587\u5b57\u3092\u8aad\u307f\u53d6\u3063\u3066\u3044\u307e\u3059",
  };

  let activeWorker = null;
  let cancelRequested = false;

  function appUrl(pathname) {
    return new URL(pathname, document.baseURI).href;
  }

  function validateFile(file) {
    if (!(file instanceof Blob) || !file.type.startsWith("image/")) {
      throw new Error("\u753b\u50cf\u30d5\u30a1\u30a4\u30eb\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("\u753b\u50cf\u304c\u5927\u304d\u3059\u304e\u307e\u3059\u300215MB\u4ee5\u4e0b\u306e\u753b\u50cf\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    }
  }

  async function loadImage(file) {
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw(context, width, height) {
            context.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();
          },
        };
      } catch {
        // Some Safari/image formats require the image element fallback below.
      }
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002"));
        image.src = objectUrl;
      });
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw(context, width, height) {
          context.drawImage(image, 0, 0, width, height);
          URL.revokeObjectURL(objectUrl);
        },
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  async function prepareImage(file) {
    const source = await loadImage(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    source.draw(context, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("OCR\u7528\u753b\u50cf\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002"))),
        "image/jpeg",
        0.9
      );
    });
  }

  async function recognize(file, { onProgress } = {}) {
    validateFile(file);
    if (!window.Tesseract?.createWorker) {
      throw new Error("OCR\u30e9\u30a4\u30d6\u30e9\u30ea\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u518d\u8aad\u307f\u8fbc\u307f\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    }

    cancelRequested = false;
    onProgress?.({ progress: 0, status: "\u753b\u50cf\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059" });
    const preparedImage = await prepareImage(file);
    if (cancelRequested) throw new DOMException("OCR\u3092\u30ad\u30e3\u30f3\u30bb\u30eb\u3057\u307e\u3057\u305f\u3002", "AbortError");

    try {
      activeWorker = await window.Tesseract.createWorker(["jpn", "eng"], 1, {
        workerPath: appUrl("./vendor/tesseract/worker.min.js"),
        corePath: appUrl("./vendor/tesseract/core"),
        langPath: LANGUAGE_PATH,
        logger(message) {
          const progress = Number.isFinite(message.progress) ? message.progress : 0;
          onProgress?.({
            progress,
            status: STATUS_LABELS[message.status] || "\u6587\u5b57\u3092\u8aad\u307f\u53d6\u3063\u3066\u3044\u307e\u3059",
          });
        },
      });

      if (cancelRequested) throw new DOMException("OCR\u3092\u30ad\u30e3\u30f3\u30bb\u30eb\u3057\u307e\u3057\u305f\u3002", "AbortError");
      const result = await activeWorker.recognize(preparedImage);
      return String(result.data?.text || "").trim();
    } finally {
      const worker = activeWorker;
      activeWorker = null;
      if (worker) await worker.terminate().catch(() => {});
    }
  }

  async function cancel() {
    cancelRequested = true;
    const worker = activeWorker;
    activeWorker = null;
    if (worker) await worker.terminate().catch(() => {});
  }

  window.KirokuOCR = {
    MAX_FILE_SIZE,
    validateFile,
    recognize,
    cancel,
  };
})();
