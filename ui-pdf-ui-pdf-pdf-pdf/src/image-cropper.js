(function () {
  "use strict";

  const MAX_OUTPUT_EDGE = 2200;
  const MIN_CROP_SIZE = 0.08;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  async function loadSource(file) {
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return {
          image: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release() {
            bitmap.close();
          },
        };
      } catch {
        // Safari may need the image element fallback for some formats.
      }
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002"));
      image.src = objectUrl;
    });

    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release() {
        URL.revokeObjectURL(objectUrl);
      },
    };
  }

  class ImageCropper {
    constructor(stage, canvas, selection, source) {
      this.stage = stage;
      this.canvas = canvas;
      this.selection = selection;
      this.source = source;
      this.rotation = 0;
      this.crop = { x: 0, y: 0, width: 1, height: 1 };
      this.imageRect = { x: 0, y: 0, width: 1, height: 1 };
      this.drag = null;
      this.destroyed = false;

      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.onResize = this.render.bind(this);

      this.selection.addEventListener("pointerdown", this.onPointerDown);
      window.addEventListener("pointermove", this.onPointerMove, { passive: false });
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerUp);
      window.addEventListener("resize", this.onResize);
      this.render();
    }

    get rotatedWidth() {
      return this.rotation % 180 === 0 ? this.source.width : this.source.height;
    }

    get rotatedHeight() {
      return this.rotation % 180 === 0 ? this.source.height : this.source.width;
    }

    render() {
      if (this.destroyed) return;
      const stageWidth = Math.max(1, this.stage.clientWidth);
      const stageHeight = Math.max(1, this.stage.clientHeight);
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(stageWidth * pixelRatio);
      this.canvas.height = Math.round(stageHeight * pixelRatio);

      const context = this.canvas.getContext("2d", { alpha: false });
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = "#1f2525";
      context.fillRect(0, 0, stageWidth, stageHeight);

      const scale = Math.min(stageWidth / this.rotatedWidth, stageHeight / this.rotatedHeight);
      const width = this.rotatedWidth * scale;
      const height = this.rotatedHeight * scale;
      const x = (stageWidth - width) / 2;
      const y = (stageHeight - height) / 2;
      this.imageRect = { x, y, width, height };

      context.save();
      context.translate(x + width / 2, y + height / 2);
      context.rotate((this.rotation * Math.PI) / 180);
      const drawWidth = this.source.width * scale;
      const drawHeight = this.source.height * scale;
      context.drawImage(this.source.image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      context.restore();
      this.renderSelection();
    }

    renderSelection() {
      const imageRect = this.imageRect;
      this.selection.style.left = imageRect.x + this.crop.x * imageRect.width + "px";
      this.selection.style.top = imageRect.y + this.crop.y * imageRect.height + "px";
      this.selection.style.width = this.crop.width * imageRect.width + "px";
      this.selection.style.height = this.crop.height * imageRect.height + "px";
    }

    onPointerDown(event) {
      if (this.destroyed) return;
      event.preventDefault();
      const handle = event.target.closest("[data-crop-handle]");
      this.drag = {
        pointerId: event.pointerId,
        mode: (handle && handle.dataset.cropHandle) || "move",
        startX: event.clientX,
        startY: event.clientY,
        crop: { ...this.crop },
      };
      if (this.selection.setPointerCapture) this.selection.setPointerCapture(event.pointerId);
    }

    onPointerMove(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId || this.destroyed) return;
      event.preventDefault();
      const deltaX = (event.clientX - this.drag.startX) / this.imageRect.width;
      const deltaY = (event.clientY - this.drag.startY) / this.imageRect.height;
      const start = this.drag.crop;

      if (this.drag.mode === "move") {
        this.crop.x = clamp(start.x + deltaX, 0, 1 - start.width);
        this.crop.y = clamp(start.y + deltaY, 0, 1 - start.height);
      } else {
        let left = start.x;
        let top = start.y;
        let right = start.x + start.width;
        let bottom = start.y + start.height;
        if (this.drag.mode.includes("w")) left = clamp(start.x + deltaX, 0, right - MIN_CROP_SIZE);
        if (this.drag.mode.includes("e")) right = clamp(right + deltaX, left + MIN_CROP_SIZE, 1);
        if (this.drag.mode.includes("n")) top = clamp(start.y + deltaY, 0, bottom - MIN_CROP_SIZE);
        if (this.drag.mode.includes("s")) bottom = clamp(bottom + deltaY, top + MIN_CROP_SIZE, 1);
        this.crop = { x: left, y: top, width: right - left, height: bottom - top };
      }
      this.renderSelection();
    }

    onPointerUp(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
    }

    rotate() {
      this.rotation = (this.rotation + 90) % 360;
      this.resetCrop();
    }

    resetCrop() {
      this.crop = { x: 0, y: 0, width: 1, height: 1 };
      this.render();
    }

    async toBlob() {
      const cropX = Math.round(this.crop.x * this.rotatedWidth);
      const cropY = Math.round(this.crop.y * this.rotatedHeight);
      const cropWidth = Math.max(1, Math.round(this.crop.width * this.rotatedWidth));
      const cropHeight = Math.max(1, Math.round(this.crop.height * this.rotatedHeight));
      const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(cropWidth, cropHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cropWidth * scale));
      canvas.height = Math.max(1, Math.round(cropHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(scale, scale);
      context.translate(-cropX, -cropY);

      if (this.rotation === 90) {
        context.translate(this.source.height, 0);
        context.rotate(Math.PI / 2);
      } else if (this.rotation === 180) {
        context.translate(this.source.width, this.source.height);
        context.rotate(Math.PI);
      } else if (this.rotation === 270) {
        context.translate(0, this.source.width);
        context.rotate(-Math.PI / 2);
      }
      context.drawImage(this.source.image, 0, 0);

      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("\u30c8\u30ea\u30df\u30f3\u30b0\u753b\u50cf\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002"))),
          "image/jpeg",
          0.92
        );
      });
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.selection.removeEventListener("pointerdown", this.onPointerDown);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("pointercancel", this.onPointerUp);
      window.removeEventListener("resize", this.onResize);
      this.source.release();
    }
  }

  async function create(file, elements) {
    const source = await loadSource(file);
    return new ImageCropper(elements.stage, elements.canvas, elements.selection, source);
  }

  window.KirokuImageCropper = { create };
})();