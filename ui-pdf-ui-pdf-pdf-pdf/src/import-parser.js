(function () {
  "use strict";

  const TITLE_LABEL_PATTERN = /(\u30bf\u30a4\u30c8\u30eb|\u984c\u540d|\u66f8\u540d|\u54c1\u540d|\u540d\u79f0)/;
  const DATE_LABEL_PATTERN = /(\u65e5\u6642|\u65e5\u4ed8|\u767b\u9332\u65e5|\u8cfc\u5165\u65e5|\u8cb8\u51fa\u65e5|\u8fd4\u5374\u65e5)/;
  const AMOUNT_LABEL_PATTERN = /(\u4fa1\u683c|\u91d1\u984d|\u5024\u6bb5|\u6599\u91d1|\u5408\u8a08|\u8cbb\u7528)/;

  function linesOf(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim());
  }

  function splitText(text, mode = "blank", fixedLines = 2) {
    const lines = linesOf(text);
    if (mode === "blank") {
      return lines
        .join("\n")
        .split(/\n\s*\n+/)
        .map((block) => block.trim())
        .filter(Boolean);
    }

    const nonEmpty = lines.filter(Boolean);
    if (mode === "line" || mode === "manual") return nonEmpty;

    if (mode === "fixed") {
      const size = Math.max(1, Math.min(20, Number(fixedLines) || 1));
      const blocks = [];
      for (let index = 0; index < nonEmpty.length; index += size) {
        blocks.push(nonEmpty.slice(index, index + size).join("\n"));
      }
      return blocks;
    }

    if (mode === "date") {
      const blocks = [];
      let current = [];
      for (const line of nonEmpty) {
        if (detectDate(line) && current.length) {
          blocks.push(current.join("\n"));
          current = [];
        }
        current.push(line);
      }
      if (current.length) blocks.push(current.join("\n"));
      return blocks;
    }

    return nonEmpty;
  }

  function validDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function detectDate(text) {
    const source = String(text || "");
    const full = source.match(/(?:^|\D)(\d{4})(?:[\/-]|\u5e74)(\d{1,2})(?:[\/-]|\u6708)(\d{1,2})(?:\u65e5)?(?:\D|$)/);
    const short = source.match(/(?:^|\D)(\d{1,2})\u6708(\d{1,2})\u65e5?(?:\D|$)/);
    const year = full ? Number(full[1]) : new Date().getFullYear();
    const month = Number(full ? full[2] : short?.[1]);
    const day = Number(full ? full[3] : short?.[2]);
    if (!month || !day || !validDate(year, month, day)) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function detectAmount(text) {
    const source = String(text || "");
    const marked = source.match(/(?:[\u00a5\uffe5]\s*([0-9][0-9,]*)(?:\.\d+)?|([0-9][0-9,]*)(?:\.\d+)?\s*\u5186)/);
    const plain = source.match(/(?:^|\s)([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,})(?:\s|$)/);
    const value = marked?.[1] || marked?.[2] || plain?.[1] || "";
    return value ? value.replace(/,/g, "") : "";
  }

  function buildValues(notebook, sourceText) {
    const values = {};
    const lines = linesOf(sourceText).filter(Boolean);
    const title = lines[0] || "";
    const date = detectDate(sourceText);
    const amount = detectAmount(sourceText);

    for (const field of notebook.fields) {
      let value = field.type === "checkbox" ? false : "";
      if (TITLE_LABEL_PATTERN.test(field.label) && ["text", "longText"].includes(field.type)) value = title;
      else if ((field.type === "date" || DATE_LABEL_PATTERN.test(field.label)) && date) value = date;
      else if ((field.type === "number" || AMOUNT_LABEL_PATTERN.test(field.label)) && amount) value = amount;
      else if (field.type === "longText" && !TITLE_LABEL_PATTERN.test(field.label)) value = sourceText.trim();
      values[field.id] = value;
    }
    return values;
  }

  function buildCandidate(notebook, sourceText, id) {
    return {
      id: id || `candidate_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      sourceText: String(sourceText || "").trim(),
      selected: true,
      values: buildValues(notebook, sourceText),
    };
  }

  function buildCandidates(notebook, text, mode, fixedLines) {
    return splitText(text, mode, fixedLines).map((block) => buildCandidate(notebook, block));
  }

  window.KirokuImportParser = {
    splitText,
    detectDate,
    detectAmount,
    buildValues,
    buildCandidate,
    buildCandidates,
  };
})();
