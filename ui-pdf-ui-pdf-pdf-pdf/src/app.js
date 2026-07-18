(function () {
  "use strict";

  const DEFAULT_THEME = "#2f6f73";

  const FIELD_TYPES = {
    text: { label: "テキスト", empty: "" },
    longText: { label: "長文", empty: "" },
    date: { label: "日付", empty: "" },
    number: { label: "\u6570\u5024", empty: "" },
    checkbox: { label: "チェック", empty: false },
    image: { label: "画像", empty: "" },
  };

  const DEFAULT_SETTINGS = {
    fontSize: "medium",
    fontFamily: "system",
    themeColor: DEFAULT_THEME,
  };

  const app = document.getElementById("app");

  let route = { name: "home" };
  let draft = null;
  let ocrDraft = null;

  const uid = (prefix) =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const nowIso = () => new Date().toISOString();

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };

  const formatDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const createField = (label = "", type = "text") => ({
    id: uid("field"),
    label,
    type,
    required: false,
  });

  const createNotebookDraft = () => ({
    name: "",
    fields: [
      createField("タイトル", "text"),
      createField("日時", "date"),
      createField("メモ", "longText"),
    ],
    deletedFieldIds: [],
  });

  const createEmptyValues = (fields) =>
    fields.reduce((values, field) => {
      values[field.id] = FIELD_TYPES[field.type]?.empty ?? "";
      return values;
    }, {});

  const normalizeState = (raw) => {
    const base = {
      version: 1,
      settings: clone(DEFAULT_SETTINGS),
      notebooks: [],
      updatedAt: nowIso(),
    };

    if (!raw || typeof raw !== "object") return base;

    const notebooks = Array.isArray(raw.notebooks)
      ? raw.notebooks.map((notebook) => {
          const fields = Array.isArray(notebook.fields)
            ? notebook.fields.map((field) => ({
                id: field.id || uid("field"),
                label: field.label || "項目",
                type: FIELD_TYPES[field.type] ? field.type : "text",
                required: Boolean(field.required),
              }))
            : [];

          const entries = Array.isArray(notebook.entries)
            ? notebook.entries.map((entry) => ({
                id: entry.id || uid("entry"),
                createdAt: entry.createdAt || nowIso(),
                updatedAt: entry.updatedAt || entry.createdAt || nowIso(),
                values: entry.values && typeof entry.values === "object" ? entry.values : {},
                assetIds: Array.isArray(entry.assetIds) ? entry.assetIds : [],
              }))
            : [];

          return {
            id: notebook.id || uid("notebook"),
            name: notebook.name || "無題の記録",
            createdAt: notebook.createdAt || nowIso(),
            updatedAt: notebook.updatedAt || nowIso(),
            fields,
            entries,
          };
        })
      : [];

    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      notebooks,
      updatedAt: raw.updatedAt || nowIso(),
    };
  };

  const Store = (() => {
    let state = normalizeState(null);
    let saveQueue = Promise.resolve();

    async function init() {
      const result = await window.KirokuDB.loadState();
      state = normalizeState(result.state);

      if (!result.state) {
        await save();
      }

      return result;
    }

    function persist() {
      state.updatedAt = nowIso();
      const snapshot = clone(state);

      saveQueue = saveQueue
        .then(() => window.KirokuDB.saveState(snapshot))
        .catch((error) => {
          alert("保存に失敗しました。端末の空き容量を確認してから、もう一度お試しください。");
          console.error(error);
        });

      return saveQueue;
    }


    function save() {
      return persist();
    }

    return {
      init,
      get: () => state,
      set(nextState) {
        state = normalizeState(nextState);
        return save();
      },
      update(mutator) {
        const next = clone(state);
        mutator(next);
        state = normalizeState(next);
        return save();
      },
      updateWithAssets(mutator, assets) {
        const previousState = state;
        const next = clone(state);
        mutator(next);
        const pendingState = normalizeState(next);
        pendingState.updatedAt = nowIso();
        state = pendingState;
        const snapshot = clone(pendingState);
        const operation = saveQueue.then(() => window.KirokuDB.saveStateAndAssets(snapshot, assets));
        saveQueue = operation.catch(() => {});

        return operation.catch((error) => {
          if (state === pendingState) state = previousState;
          alert("\u4e00\u62ec\u4fdd\u5b58\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u7aef\u672b\u306e\u7a7a\u304d\u5bb9\u91cf\u3092\u78ba\u8a8d\u3057\u3066\u3001\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002");
          console.error(error);
          throw error;
        });
      },
      flush() {
        return saveQueue;
      },
    };
  })();

  const ViewModel = {
    findNotebook(id) {
      return Store.get().notebooks.find((notebook) => notebook.id === id);
    },

    async addNotebook(payload) {
      const notebook = {
        id: uid("notebook"),
        name: payload.name.trim(),
        fields: payload.fields.map((field) => ({
          id: field.id,
          label: field.label.trim(),
          type: field.type,
          required: Boolean(field.required),
        })),
        entries: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      await Store.update((state) => {
        state.notebooks.unshift(notebook);
      });

      return notebook.id;
    },

    async updateNotebook(notebookId, payload) {
      await Store.update((state) => {
        const notebook = state.notebooks.find((item) => item.id === notebookId);
        if (!notebook) return;

        notebook.name = payload.name.trim();
        notebook.fields = payload.fields.map((field) => ({
          id: field.id,
          label: field.label.trim(),
          type: field.type,
          required: Boolean(field.required),
        }));
        notebook.updatedAt = nowIso();

        for (const entry of notebook.entries) {
          for (const fieldId of payload.deletedFieldIds) {
            delete entry.values[fieldId];
          }
          for (const field of notebook.fields) {
            if (!(field.id in entry.values)) {
              entry.values[field.id] = FIELD_TYPES[field.type]?.empty ?? "";
            }
          }
        }
      });
    },

    async deleteNotebook(notebookId) {
      await Store.update((state) => {
        state.notebooks = state.notebooks.filter((notebook) => notebook.id !== notebookId);
      });
    },

    async addEntry(notebookId, values) {
      await Store.update((state) => {
        const notebook = state.notebooks.find((item) => item.id === notebookId);
        if (!notebook) return;
        notebook.entries.unshift({
          id: uid("entry"),
          createdAt: nowIso(),
          updatedAt: nowIso(),
          values,
        });
        notebook.updatedAt = nowIso();
      });
    },

    async addEntriesBatch(notebookId, valuesList, originalImage = null) {
      const notebook = this.findNotebook(notebookId);
      if (!notebook) throw new Error("\u8a18\u9332\u30ce\u30fc\u30c8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002");

      const timestamp = nowIso();
      const entries = valuesList.map((values) => ({
        id: uid("entry"),
        createdAt: timestamp,
        updatedAt: timestamp,
        values,
        assetIds: [],
      }));
      const assets = [];

      if (originalImage && entries.length) {
        const assetId = uid("asset");
        const entryIds = entries.map((entry) => entry.id);
        for (const entry of entries) entry.assetIds.push(assetId);
        assets.push({
          id: assetId,
          notebookId,
          entryId: entryIds[0],
          entryIds,
          blob: originalImage,
          name: originalImage.name || "ocr-source-image",
          mimeType: originalImage.type || "application/octet-stream",
          size: originalImage.size || 0,
          createdAt: timestamp,
        });
      }

      await Store.updateWithAssets((state) => {
        const target = state.notebooks.find((item) => item.id === notebookId);
        if (!target) throw new Error("\u8a18\u9332\u30ce\u30fc\u30c8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002");
        target.entries.unshift(...entries);
        target.updatedAt = timestamp;
      }, assets);

      return entries.length;
    },

    async updateEntry(notebookId, entryId, values) {
      await Store.update((state) => {
        const notebook = state.notebooks.find((item) => item.id === notebookId);
        if (!notebook) return;
        const entry = notebook.entries.find((item) => item.id === entryId);
        if (!entry) return;
        entry.values = values;
        entry.updatedAt = nowIso();
        notebook.updatedAt = nowIso();
      });
    },

    async deleteEntry(notebookId, entryId) {
      await Store.update((state) => {
        const notebook = state.notebooks.find((item) => item.id === notebookId);
        if (!notebook) return;
        notebook.entries = notebook.entries.filter((entry) => entry.id !== entryId);
        notebook.updatedAt = nowIso();
      });
    },
  };

  const PdfExporter = {
    printNotebook(notebook) {
      const opened = window.open("", "_blank");
      if (!opened) {
        alert("出力画面を開けませんでした。ポップアップの許可を確認してください。");
        return;
      }

      opened.document.open();
      opened.document.write(this.buildHtml(notebook));
      opened.document.close();
      opened.focus();
      setTimeout(() => opened.print(), 350);
    },

    buildHtml(notebook) {
      const outputDate = new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date());

      const entriesHtml = notebook.entries.length
        ? notebook.entries.map((entry, index) => this.entryHtml(notebook, entry, index + 1)).join("")
        : `<p class="empty">記録はまだありません。</p>`;

      return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(notebook.name)} PDF</title>
    <style>
      @page { margin: 16mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1b2326;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12pt;
        line-height: 1.7;
      }
      header {
        margin-bottom: 18px;
        padding-bottom: 12px;
        border-bottom: 2px solid #2f6f73;
      }
      h1 {
        margin: 0;
        font-size: 22pt;
        letter-spacing: 0;
      }
      .meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 8px;
        color: #566366;
        font-size: 10pt;
      }
      .entry {
        break-inside: avoid;
        padding: 12px 0;
        border-bottom: 1px solid #cdd6d8;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 14pt;
      }
      dl {
        display: grid;
        grid-template-columns: 34mm 1fr;
        gap: 5px 8px;
        margin: 0;
      }
      dt {
        color: #566366;
        font-weight: 700;
      }
      dd {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      img {
        max-width: 70mm;
        max-height: 45mm;
        object-fit: contain;
        border: 1px solid #cdd6d8;
      }
      .empty { color: #566366; }
      .no-print {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        background: white;
      }
      button {
        min-height: 48px;
        padding: 0 12px;
        border: 1px solid #cdd6d8;
        border-radius: 6px;
        background: #fff;
        font: inherit;
        cursor: pointer;
      }
      button:first-child {
        border-color: #2f6f73;
        background: #2f6f73;
        color: white;
        font-weight: 700;
      }
      @media (max-width: 640px) {
        body {
          padding-bottom: calc(78px + env(safe-area-inset-bottom));
          font-size: 11pt;
        }
        .no-print {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 10;
          gap: 10px;
          margin: 0;
          padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
          border-top: 1px solid #cdd6d8;
        }
        .no-print button {
          flex: 1;
        }
        dl {
          grid-template-columns: 1fr;
        }
      }
      @media print {
        .no-print { display: none; }
        body { padding-bottom: 0; }
      }
    </style>
  </head>
  <body>
    <div class="no-print">
      <button onclick="window.print()">PDFとして保存</button>
      <button onclick="window.close()">閉じる</button>
    </div>
    <header>
      <h1>${escapeHtml(notebook.name)} PDF</h1>
      <div class="meta">
        <span>出力日：${escapeHtml(outputDate)}</span>
        <span>記録数：${notebook.entries.length}件</span>
      </div>
    </header>
    <main>${entriesHtml}</main>
  </body>
</html>`;
    },

    entryHtml(notebook, entry, number) {
      const title = escapeHtml(getEntryTitle(notebook, entry) || `記録 ${number}`);
      const rows = notebook.fields
        .map((field) => {
          const value = entry.values[field.id];
          return `<dt>${escapeHtml(field.label)}</dt><dd>${formatValueForPrint(field, value)}</dd>`;
        })
        .join("");

      return `<section class="entry">
  <h2>${number}. ${title}</h2>
  <dl>
    <dt>登録日</dt><dd>${escapeHtml(formatDateTime(entry.createdAt))}</dd>
    ${rows}
  </dl>
</section>`;
    },
  };

  function applySettings(settings) {
    document.body.dataset.fontSize = settings.fontSize;
    document.body.dataset.fontFamily = settings.fontFamily;
    document.documentElement.style.setProperty("--theme", settings.themeColor || DEFAULT_THEME);
    document.documentElement.style.setProperty("--theme-strong", darken(settings.themeColor || DEFAULT_THEME));
    document.documentElement.style.setProperty("--theme-soft", soften(settings.themeColor || DEFAULT_THEME));
  }

  function darken(hex) {
    const color = parseHex(hex);
    if (!color) return "#20555a";
    return toHex(color.map((part) => Math.max(0, Math.round(part * 0.72))));
  }

  function soften(hex) {
    const color = parseHex(hex);
    if (!color) return "#e8f4f2";
    return toHex(color.map((part) => Math.round(part + (255 - part) * 0.88)));
  }

  function parseHex(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!match) return null;
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
  }

  function toHex(parts) {
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }

  function navigate(nextRoute) {
    route = nextRoute;
    draft = nextRoute.draft || null;
    render();
  }

  function render() {
    applySettings(Store.get().settings);

    const title = screenTitle();
    app.innerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">き</div>
            <div>
              <h1 class="brand-title">きろく</h1>
              <p class="screen-title">${escapeHtml(title)}</p>
            </div>
          </div>
          ${renderTopbarAction()}
        </div>
      </header>
      <main class="main" data-screen="${escapeHtml(route.name)}">${renderScreen()}</main>
      ${renderBottomNav()}
    `;

  }

  function renderTopbarAction() {
    if (route.name === "home") return "";
    if (route.name === "imageImport") {
      return `<button class="button ghost" data-action="discard-image-import">\u623b\u308b</button>`;
    }
    return `<button class="button ghost" data-action="back-home">\u30db\u30fc\u30e0</button>`;
  }

  function screenTitle() {
    if (route.name === "home") return "ホーム";
    if (route.name === "notebookForm" && route.mode === "create") return "新しい記録";
    if (route.name === "notebookForm" && route.mode === "settings") return "記録の設定";
    if (route.name === "notebook") return ViewModel.findNotebook(route.notebookId)?.name || "活動の記録";
    if (route.name === "entryForm" && route.mode === "create") return "ノートをつける";
    if (route.name === "entryForm" && route.mode === "edit") return "記録を編集";
    if (route.name === "imageImport") return "\u753b\u50cf\u304b\u3089\u8a18\u9332";
    if (route.name === "settings") return "設定";
    if (route.name === "export") return "出力";
    return "";
  }

  function renderScreen() {
    if (route.name === "home") return renderHome();
    if (route.name === "notebookForm") return renderNotebookForm();
    if (route.name === "notebook") return renderNotebook(route.notebookId);
    if (route.name === "entryForm") return renderEntryForm(route.notebookId, route.entryId);
    if (route.name === "imageImport") return renderImageImport(route.notebookId);
    if (route.name === "settings") return renderSettings();
    if (route.name === "export") return renderExport();
    return renderHome();
  }

  function renderBottomNav() {
    if (route.name === "imageImport") return "";
    const primary = bottomPrimaryAction();
    const isHome = route.name === "home";
    const isExport = route.name === "export";
    const isSettings = route.name === "settings";

    return `
      <nav class="bottom-nav" aria-label="主要操作">
        <div class="bottom-nav-inner">
          ${primary}
          <div class="bottom-nav-row">
            <button class="bottom-nav-button ${isHome ? "active" : ""}" data-action="back-home">ホーム</button>
            <button class="bottom-nav-button ${isExport ? "active" : ""}" data-action="open-export">出力</button>
            <button class="bottom-nav-button ${isSettings ? "active" : ""}" data-action="open-settings">設定</button>
          </div>
        </div>
      </nav>
    `;
  }

  function bottomPrimaryAction() {
    if (route.name === "home") {
      return `<button class="bottom-primary" data-action="new-notebook">＋ 新しい記録</button>`;
    }

    if (route.name === "notebook") {
      return `<div class="bottom-action-grid">
        <button class="bottom-primary" data-action="new-entry" data-notebook-id="${escapeHtml(route.notebookId)}">\uff0b \u30ce\u30fc\u30c8\u3092\u3064\u3051\u308b</button>
        <button class="bottom-secondary" data-action="image-import" data-notebook-id="${escapeHtml(route.notebookId)}">\u753b\u50cf\u304b\u3089\u8a18\u9332</button>
      </div>`;
    }

    if (route.name === "export") {
      const notebooks = Store.get().notebooks;
      const selectedId = route.notebookId || notebooks[0]?.id || "";
      return selectedId
        ? `<button class="bottom-primary" data-action="print-pdf" data-notebook-id="${escapeHtml(selectedId)}">PDF出力</button>`
        : "";
    }

    return "";
  }

  function renderHome() {
    const notebooks = Store.get().notebooks;
    const list = notebooks.length
      ? `<div class="grid notebook-grid">${notebooks.map(renderNotebookCard).join("")}</div>`
      : `<div class="empty">
          <p>まだ記録ノートがありません。</p>
          <button class="button primary" data-action="new-notebook">＋ 新しい記録</button>
        </div>`;

    return `
      <section class="page-head">
        <div>
          <h2>活動の記録</h2>
          <p class="subtle">${notebooks.length}冊の記録ノート</p>
        </div>
        <div class="toolbar">
          <button class="button primary" data-action="new-notebook">＋ 新しい記録</button>
          <button class="button" data-action="open-settings">⚙ 設定</button>
          <button class="button" data-action="open-export">⬇ 出力</button>
        </div>
      </section>
      ${list}
    `;
  }

  function renderNotebookCard(notebook) {
    return `
      <button class="notebook-card" data-action="open-notebook" data-notebook-id="${escapeHtml(notebook.id)}">
        <h3>${escapeHtml(notebook.name)}</h3>
        <div class="card-meta">
          <span class="pill">${notebook.entries.length}件</span>
          <span>${notebook.fields.length}項目</span>
          <span>更新 ${escapeHtml(formatDate(notebook.updatedAt))}</span>
        </div>
      </button>
    `;
  }

  function renderNotebookForm() {
    const mode = route.mode;
    const heading = mode === "create" ? "新しい記録" : "記録の設定";
    const submit = mode === "create" ? "作成" : "保存";
    const deleteButton =
      mode === "settings"
        ? `<button type="button" class="button danger" data-action="delete-notebook">記録ノートを削除</button>`
        : "";

    return `
      <section class="page-head">
        <div>
          <h2>${heading}</h2>
          <p class="subtle">項目数：${draft.fields.length}</p>
        </div>
      </section>
      <form class="form-panel" id="notebook-form">
        <div class="form-grid">
          <div class="field">
            <label for="notebook-name">記録名</label>
            <input id="notebook-name" class="input" name="name" required value="${escapeHtml(draft.name)}" placeholder="読書記録" />
          </div>
          <div class="field">
            <div class="group-label">記録する項目</div>
            <div class="fields-editor" id="fields-editor">
              ${draft.fields.map(renderFieldRow).join("")}
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="button soft" data-action="add-field">＋ 項目を追加</button>
          <button type="submit" class="button primary">${submit}</button>
          <button type="button" class="button" data-action="${mode === "create" ? "back-home" : "open-notebook"}" data-notebook-id="${escapeHtml(route.notebookId || "")}">キャンセル</button>
          ${deleteButton}
        </div>
      </form>
    `;
  }

  function renderFieldRow(field, index) {
    return `
      <div class="field-row js-field-row" data-field-id="${escapeHtml(field.id)}">
        <input class="input js-field-label" required value="${escapeHtml(field.label)}" placeholder="項目名" />
        <select class="select js-field-type">
          ${Object.entries(FIELD_TYPES)
            .map(([type, item]) => `<option value="${type}" ${type === field.type ? "selected" : ""}>${item.label}</option>`)
            .join("")}
        </select>
        <div class="field-actions">
          <button type="button" class="icon-button" data-action="move-field" data-index="${index}" data-direction="-1" title="上へ" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="icon-button" data-action="move-field" data-index="${index}" data-direction="1" title="下へ" ${index === draft.fields.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="icon-button danger" data-action="remove-field" data-index="${index}" title="削除">×</button>
        </div>
      </div>
    `;
  }

  function renderNotebook(notebookId) {
    const notebook = ViewModel.findNotebook(notebookId);
    if (!notebook) return renderMissing();

    const entries = notebook.entries.length
      ? `<div class="entry-list">${notebook.entries.map((entry) => renderEntryCard(notebook, entry)).join("")}</div>`
      : `<div class="empty">
          <p>この記録ノートにはまだ記録がありません。</p>
          <button class="button primary" data-action="new-entry" data-notebook-id="${escapeHtml(notebook.id)}">＋ ノートをつける</button>
          <button class="button image-import-button" data-action="image-import" data-notebook-id="${escapeHtml(notebook.id)}">\u753b\u50cf\u304b\u3089\u8a18\u9332</button>
        </div>`;

    return `
      <section class="page-head">
        <div>
          <h2>${escapeHtml(notebook.name)}</h2>
          <p class="subtle">${notebook.entries.length}件の記録</p>
        </div>
        <div class="toolbar">
          <button class="button primary" data-action="new-entry" data-notebook-id="${escapeHtml(notebook.id)}">＋ ノートをつける</button>
          <button class="button image-import-button" data-action="image-import" data-notebook-id="${escapeHtml(notebook.id)}">\u753b\u50cf\u304b\u3089\u8a18\u9332</button>
          <button class="button" data-action="notebook-settings" data-notebook-id="${escapeHtml(notebook.id)}">⚙ 記録の設定</button>
        </div>
      </section>
      ${entries}
    `;
  }

  function renderEntryCard(notebook, entry) {
    return `
      <article class="entry-card">
        <div class="entry-card-head">
          <div>
            <h3>${escapeHtml(getEntryTitle(notebook, entry) || "記録")}</h3>
            <div class="card-meta">
              <span>登録 ${escapeHtml(formatDateTime(entry.createdAt))}</span>
              <span>更新 ${escapeHtml(formatDateTime(entry.updatedAt))}</span>
            </div>
          </div>
          <div class="entry-actions">
            <button class="button" data-action="edit-entry" data-notebook-id="${escapeHtml(notebook.id)}" data-entry-id="${escapeHtml(entry.id)}">編集</button>
            <button class="button danger" data-action="delete-entry" data-notebook-id="${escapeHtml(notebook.id)}" data-entry-id="${escapeHtml(entry.id)}">削除</button>
          </div>
        </div>
        <div class="detail-list">
          ${notebook.fields.map((field) => renderDetailItem(field, entry.values[field.id])).join("")}
        </div>
      </article>
    `;
  }

  function renderDetailItem(field, value) {
    return `
      <div class="detail-item">
        <div class="detail-label">${escapeHtml(field.label)}</div>
        <div class="detail-value">${formatValueForHtml(field, value)}</div>
      </div>
    `;
  }

  function renderEntryForm(notebookId, entryId) {
    const notebook = ViewModel.findNotebook(notebookId);
    if (!notebook) return renderMissing();

    const entry = entryId ? notebook.entries.find((item) => item.id === entryId) : null;
    const values = entry ? { ...createEmptyValues(notebook.fields), ...entry.values } : createEmptyValues(notebook.fields);
    const heading = entry ? "記録を編集" : "ノートをつける";
    const submit = entry ? "保存" : "追加";

    return `
      <section class="page-head">
        <div>
          <h2>${heading}</h2>
          <p class="subtle">${escapeHtml(notebook.name)}</p>
        </div>
      </section>
      <form class="form-panel" id="entry-form">
        <div class="form-grid">
          ${notebook.fields.map((field) => renderEntryInput(field, values[field.id])).join("")}
        </div>
        <div class="form-actions">
          <button type="submit" class="button primary">${submit}</button>
          <button type="button" class="button" data-action="open-notebook" data-notebook-id="${escapeHtml(notebook.id)}">キャンセル</button>
        </div>
      </form>
    `;
  }

  function renderEntryInput(field, value) {
    const inputId = `entry-field-${field.id}`;
    const common = `data-field-id="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}"`;
    if (field.type === "longText") {
      return `
        <div class="field">
          <label for="${escapeHtml(inputId)}">${escapeHtml(field.label)}</label>
          <textarea id="${escapeHtml(inputId)}" class="textarea js-entry-input" ${common}>${escapeHtml(value)}</textarea>
        </div>
      `;
    }

    if (field.type === "date") {
      return `
        <div class="field">
          <label for="${escapeHtml(inputId)}">${escapeHtml(field.label)}</label>
          <input id="${escapeHtml(inputId)}" type="date" class="input js-entry-input" ${common} value="${escapeHtml(value)}" />
        </div>
      `;
    }

    if (field.type === "checkbox") {
      return `
        <div class="field">
          <span class="group-label">${escapeHtml(field.label)}</span>
          <label class="checkbox-field">
            <input type="checkbox" class="js-entry-input" ${common} ${value ? "checked" : ""} />
            <span>チェックあり</span>
          </label>
        </div>
      `;
    }

    if (field.type === "image") {
      const preview = value ? `<img class="thumb" src="${escapeHtml(value)}" alt="${escapeHtml(field.label)}" />` : "";
      return `
        <div class="field">
          <label for="${escapeHtml(inputId)}">${escapeHtml(field.label)}</label>
          <input id="${escapeHtml(inputId)}" type="file" accept="image/*" class="input js-image-input" ${common} />
          <input type="hidden" class="js-entry-input" ${common} value="${escapeHtml(value)}" />
          <div class="js-image-preview">${preview}</div>
          ${value ? `<button type="button" class="button danger" data-action="clear-image" data-field-id="${escapeHtml(field.id)}">画像を削除</button>` : ""}
        </div>
      `;
    }

    return `
      <div class="field">
        <label for="${escapeHtml(inputId)}">${escapeHtml(field.label)}</label>
        <input id="${escapeHtml(inputId)}" type="${field.type === "number" ? "number" : "text"}" ${field.type === "number" ? 'inputmode="decimal"' : ""} class="input js-entry-input" ${common} value="${escapeHtml(value)}" />
      </div>
    `;
  }

  function createOcrDraft(notebookId) {
    return {
      notebookId,
      stage: "select",
      file: null,
      objectUrl: "",
      saveImage: false,
      text: "",
      splitMode: "blank",
      fixedLines: 2,
      candidates: [],
      progress: 0,
      status: "",
      error: "",
    };
  }

  function renderImageImport(notebookId) {
    const notebook = ViewModel.findNotebook(notebookId);
    if (!notebook) return renderMissing();
    if (!ocrDraft || ocrDraft.notebookId !== notebookId) ocrDraft = createOcrDraft(notebookId);

    const heading = `<section class="page-head ocr-page-head">
      <div>
        <h2>\u753b\u50cf\u304b\u3089\u8a18\u9332</h2>
        <p class="subtle">${escapeHtml(notebook.name)}</p>
      </div>
    </section>`;

    if (ocrDraft.stage === "select") return heading + renderOcrSelect();
    if (ocrDraft.stage === "ready") return heading + renderOcrReady();
    if (ocrDraft.stage === "running") return heading + renderOcrRunning();
    if (ocrDraft.stage === "review") return heading + renderOcrReview(notebook);
    return heading + renderOcrError();
  }

  function renderOcrSelect() {
    return `<div class="ocr-workspace">
      <h3>\u753b\u50cf\u3092\u7528\u610f</h3>
      <p class="subtle">\u30ec\u30b7\u30fc\u30c8\u3084\u4e00\u89a7\u8868\u3092\u3001\u6587\u5b57\u304c\u6b63\u9762\u304b\u3089\u306f\u3063\u304d\u308a\u898b\u3048\u308b\u3088\u3046\u306b\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044\u3002</p>
      <div class="ocr-source-grid">
        <label class="button primary upload-button" for="ocr-camera">\u5199\u771f\u3092\u64ae\u308b</label>
        <input id="ocr-camera" class="visually-hidden js-ocr-file" type="file" accept="image/*" capture="environment" />
        <label class="button upload-button" for="ocr-library">\u5199\u771f\u3092\u9078\u3076</label>
        <input id="ocr-library" class="visually-hidden js-ocr-file" type="file" accept="image/*" />
      </div>
      <p class="privacy-note">\u753b\u50cf\u3068\u8aad\u307f\u53d6\u308a\u7d50\u679c\u306f\u5916\u90e8\u3078\u9001\u4fe1\u3057\u307e\u305b\u3093\u3002\u521d\u56de\u306e\u307f OCR \u8a00\u8a9e\u30e2\u30c7\u30eb\u3092\u53d6\u5f97\u3057\u307e\u3059\u3002</p>
    </div>`;
  }

  function renderOcrReady() {
    const fileSize = ocrDraft.file ? `${(ocrDraft.file.size / 1024 / 1024).toFixed(1)} MB` : "";
    return `<div class="ocr-workspace">
      <div class="ocr-image-frame">
        <img src="${escapeHtml(ocrDraft.objectUrl)}" alt="\u8aad\u307f\u53d6\u308a\u5bfe\u8c61\u306e\u753b\u50cf" />
      </div>
      <p class="file-meta">${escapeHtml(ocrDraft.file?.name || "")} ${escapeHtml(fileSize)}</p>
      <label class="checkbox-field ocr-save-original">
        <input type="checkbox" class="js-ocr-save-image" ${ocrDraft.saveImage ? "checked" : ""} />
        <span>\u5143\u753b\u50cf\u3082\u4fdd\u5b58\u3059\u308b</span>
      </label>
      <p class="subtle">\u30aa\u30d5\u306e\u5834\u5408\u3001OCR \u5b8c\u4e86\u5f8c\u306b\u753b\u50cf\u306f\u4fdd\u5b58\u3055\u308c\u307e\u305b\u3093\u3002</p>
      <div class="form-actions ocr-sticky-actions">
        <button class="button primary" data-action="start-ocr">\u6587\u5b57\u3092\u8aad\u307f\u53d6\u308b</button>
        <button class="button danger" data-action="clear-ocr-image">\u753b\u50cf\u3092\u524a\u9664</button>
      </div>
    </div>`;
  }

  function renderOcrRunning() {
    const percent = Math.round(Math.max(0, Math.min(1, ocrDraft.progress || 0)) * 100);
    return `<div class="ocr-workspace ocr-progress-panel" aria-live="polite">
      <h3>\u6587\u5b57\u3092\u8aad\u307f\u53d6\u3063\u3066\u3044\u307e\u3059</h3>
      <progress class="ocr-progress js-ocr-progress" max="1" value="${ocrDraft.progress || 0}"></progress>
      <strong class="ocr-percent js-ocr-percent">${percent}%</strong>
      <p class="subtle js-ocr-status">${escapeHtml(ocrDraft.status)}</p>
      <button class="button danger" data-action="cancel-ocr">\u30ad\u30e3\u30f3\u30bb\u30eb</button>
    </div>`;
  }

  function renderOcrError() {
    return `<div class="ocr-workspace error-panel" role="alert">
      <h3>\u8aad\u307f\u53d6\u308a\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f</h3>
      <p>${escapeHtml(ocrDraft.error)}</p>
      <div class="form-actions">
        ${ocrDraft.file ? '<button class="button primary" data-action="retry-ocr">\u518d\u8a66\u884c</button>' : ""}
        <button class="button" data-action="clear-ocr-image">\u5225\u306e\u753b\u50cf\u3092\u9078\u3076</button>
      </div>
    </div>`;
  }

  function renderOcrReview(notebook) {
    const selectedCount = ocrDraft.candidates.filter((candidate) => candidate.selected).length;
    const option = (value, label) => `<option value="${value}" ${ocrDraft.splitMode === value ? "selected" : ""}>${label}</option>`;
    const candidates = ocrDraft.candidates.length
      ? ocrDraft.candidates.map((candidate, index) => renderOcrCandidate(notebook, candidate, index)).join("")
      : '<div class="empty"><p>\u8ffd\u52a0\u5019\u88dc\u304c\u3042\u308a\u307e\u305b\u3093\u3002\u5168\u6587\u3092\u4fee\u6b63\u3057\u3066\u518d\u5206\u5272\u3057\u3066\u304f\u3060\u3055\u3044\u3002</p></div>';

    return `<div class="ocr-review">
      <section class="ocr-section">
        <h3>1. OCR \u5168\u6587\u3092\u78ba\u8a8d</h3>
        <textarea class="textarea ocr-full-text js-ocr-text" aria-label="OCR \u5168\u6587">${escapeHtml(ocrDraft.text)}</textarea>
      </section>
      <section class="ocr-section split-controls">
        <h3>2. \u8a18\u9332\u306e\u5206\u3051\u65b9</h3>
        <div class="split-grid">
          <label class="field"><span>\u5206\u5272\u65b9\u6cd5</span>
            <select class="select js-ocr-split">
              ${option("blank", "\u7a7a\u884c\u3067\u533a\u5207\u308b")}
              ${option("line", "1\u884c\u30921\u8a18\u9332\u306b\u3059\u308b")}
              ${option("fixed", "\u6307\u5b9a\u884c\u6570\u3054\u3068")}
              ${option("date", "\u65e5\u6642\u3089\u3057\u3044\u884c\u304b\u3089\u5206\u3051\u308b")}
              ${option("manual", "\u624b\u52d5\u3067\u7de8\u96c6\u3059\u308b")}
            </select>
          </label>
          <label class="field"><span>1\u8a18\u9332\u306e\u884c\u6570</span>
            <input type="number" min="1" max="20" inputmode="numeric" class="input js-ocr-fixed-lines" value="${ocrDraft.fixedLines}" ${ocrDraft.splitMode === "fixed" ? "" : "disabled"} />
          </label>
        </div>
        <button class="button" data-action="reparse-ocr">\u3053\u306e\u65b9\u6cd5\u3067\u518d\u5206\u5272</button>
      </section>
      <section class="ocr-section">
        <div class="candidate-list-head">
          <div><h3>3. \u4fdd\u5b58\u524d\u306e\u78ba\u8a8d</h3><p class="subtle">${ocrDraft.candidates.length}\u4ef6\u4e2d ${selectedCount}\u4ef6\u3092\u8ffd\u52a0</p></div>
          <button class="button" data-action="add-ocr-candidate">\u5019\u88dc\u3092\u8ffd\u52a0</button>
        </div>
        <div class="ocr-candidate-list">${candidates}</div>
      </section>
      <div class="form-actions ocr-save-bar">
        <button class="button primary" data-action="save-ocr-records" ${selectedCount ? "" : "disabled"}>${selectedCount}\u4ef6\u3092\u4e00\u62ec\u4fdd\u5b58</button>
        <button class="button danger" data-action="discard-image-import">\u7834\u68c4</button>
      </div>
    </div>`;
  }

  function renderOcrCandidate(notebook, candidate, index) {
    return `<article class="ocr-candidate" data-candidate-id="${escapeHtml(candidate.id)}">
      <div class="candidate-head">
        <label class="checkbox-field">
          <input type="checkbox" class="js-ocr-selected" ${candidate.selected ? "checked" : ""} />
          <strong>\u8a18\u9332 ${index + 1}</strong>
        </label>
        <button class="button danger compact" data-action="delete-ocr-candidate" data-index="${index}">\u524a\u9664</button>
      </div>
      <label class="field"><span>\u5143\u30c6\u30ad\u30b9\u30c8</span>
        <textarea class="textarea js-ocr-source">${escapeHtml(candidate.sourceText)}</textarea>
      </label>
      <button class="button compact" data-action="extract-ocr-candidate" data-index="${index}">\u5143\u30c6\u30ad\u30b9\u30c8\u304b\u3089\u518d\u62bd\u51fa</button>
      <div class="candidate-fields">
        ${notebook.fields.map((field) => renderOcrCandidateField(field, candidate)).join("")}
      </div>
      <div class="candidate-tools">
        <button class="button compact" data-action="merge-ocr-candidate" data-index="${index}" ${index === 0 ? "disabled" : ""}>\u4e0a\u3068\u7d50\u5408</button>
        <button class="button compact" data-action="split-ocr-candidate" data-index="${index}">\u884c\u3054\u3068\u306b\u5206\u5272</button>
      </div>
    </article>`;
  }

  function renderOcrCandidateField(field, candidate) {
    const value = candidate.values[field.id] ?? (field.type === "checkbox" ? false : "");
    const common = `class="js-ocr-value" data-field-id="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}"`;
    if (field.type === "image") {
      return `<div class="field"><span>${escapeHtml(field.label)}</span><p class="subtle">OCR \u3067\u306f\u8a2d\u5b9a\u3057\u307e\u305b\u3093\u3002</p></div>`;
    }
    if (field.type === "checkbox") {
      return `<label class="checkbox-field"><input type="checkbox" ${common} ${value ? "checked" : ""} /><span>${escapeHtml(field.label)}</span></label>`;
    }
    if (field.type === "longText") {
      return `<label class="field"><span>${escapeHtml(field.label)}</span><textarea class="textarea js-ocr-value" data-field-id="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}">${escapeHtml(value)}</textarea></label>`;
    }
    const inputType = field.type === "date" ? "date" : field.type === "number" ? "number" : "text";
    const inputMode = field.type === "number" ? ' inputmode="decimal"' : "";
    return `<label class="field"><span>${escapeHtml(field.label)}</span><input type="${inputType}"${inputMode} class="input js-ocr-value" data-field-id="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}" value="${escapeHtml(value)}" /></label>`;
  }

  function renderSettings() {
    const settings = Store.get().settings;
    return `
      <section class="page-head">
        <div>
          <h2>設定</h2>
          <p class="subtle">表示設定</p>
        </div>
      </section>
      <div class="setting-list">
        <div class="setting-row">
          <label for="font-size">文字サイズ</label>
          <select id="font-size" class="select js-setting" data-setting="fontSize">
            <option value="small" ${settings.fontSize === "small" ? "selected" : ""}>小</option>
            <option value="medium" ${settings.fontSize === "medium" ? "selected" : ""}>標準</option>
            <option value="large" ${settings.fontSize === "large" ? "selected" : ""}>大</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="font-family">フォント</label>
          <select id="font-family" class="select js-setting" data-setting="fontFamily">
            <option value="system" ${settings.fontFamily === "system" ? "selected" : ""}>標準</option>
            <option value="serif" ${settings.fontFamily === "serif" ? "selected" : ""}>明朝</option>
            <option value="rounded" ${settings.fontFamily === "rounded" ? "selected" : ""}>丸ゴシック</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="theme-color">テーマカラー</label>
          <div class="color-row">
            <input id="theme-color" type="color" class="color-input js-setting" data-setting="themeColor" value="${escapeHtml(settings.themeColor)}" />
            <input type="text" class="input js-setting" data-setting="themeColor" value="${escapeHtml(settings.themeColor)}" pattern="#[0-9a-fA-F]{6}" />
          </div>
        </div>
      </div>
    `;
  }

  function renderExport() {
    const notebooks = Store.get().notebooks;
    const selectedId = route.notebookId || notebooks[0]?.id || "";
    const selected = notebooks.find((notebook) => notebook.id === selectedId);

    if (!notebooks.length) {
      return `
        <section class="page-head">
          <div><h2>出力</h2><p class="subtle">PDF</p></div>
        </section>
        <div class="empty">
          <p>出力できる記録ノートがありません。</p>
          <button class="button primary" data-action="new-notebook">＋ 新しい記録</button>
        </div>
      `;
    }

    return `
      <section class="page-head">
        <div>
          <h2>出力</h2>
          <p class="subtle">PDF</p>
        </div>
      </section>
      <div class="export-layout">
        <div class="form-panel">
          <div class="form-grid">
            <div class="field">
              <label for="export-notebook">記録ノート</label>
              <select id="export-notebook" class="select" data-action="select-export-notebook">
                ${notebooks
                  .map((notebook) => `<option value="${escapeHtml(notebook.id)}" ${notebook.id === selectedId ? "selected" : ""}>${escapeHtml(notebook.name)}</option>`)
                  .join("")}
              </select>
            </div>
          </div>
          <div class="form-actions">
            <button class="button primary" data-action="print-pdf" data-notebook-id="${escapeHtml(selectedId)}">PDF出力</button>
          </div>
        </div>
        <div class="export-preview">
          ${selected ? renderExportPreview(selected) : ""}
        </div>
      </div>
    `;
  }

  function renderExportPreview(notebook) {
    const firstEntries = notebook.entries.slice(0, 5);
    const lines = firstEntries.length
      ? firstEntries
          .map(
            (entry) => `
              <div class="preview-line">
                <span>${escapeHtml(getEntryTitle(notebook, entry) || "記録")}</span>
                <span>${escapeHtml(formatDate(entry.createdAt))}</span>
              </div>
            `
          )
          .join("")
      : `<p class="subtle">記録はまだありません。</p>`;

    return `
      <h3>${escapeHtml(notebook.name)} PDF</h3>
      <div class="card-meta">
        <span>記録数 ${notebook.entries.length}件</span>
        <span>項目数 ${notebook.fields.length}項目</span>
      </div>
      <div class="preview-lines">${lines}</div>
    `;
  }

  function renderMissing() {
    return `
      <div class="empty">
        <p>対象の記録が見つかりません。</p>
        <button class="button primary" data-action="back-home">ホームへ戻る</button>
      </div>
    `;
  }

  function releaseOcrImage() {
    if (ocrDraft?.objectUrl) URL.revokeObjectURL(ocrDraft.objectUrl);
  }

  function syncOcrDraftFromDom() {
    if (!ocrDraft) return;
    const textInput = app.querySelector(".js-ocr-text");
    const splitInput = app.querySelector(".js-ocr-split");
    const fixedInput = app.querySelector(".js-ocr-fixed-lines");
    const saveImageInput = app.querySelector(".js-ocr-save-image");
    if (textInput) ocrDraft.text = textInput.value;
    if (splitInput) ocrDraft.splitMode = splitInput.value;
    if (fixedInput) ocrDraft.fixedLines = Math.max(1, Math.min(20, Number(fixedInput.value) || 1));
    if (saveImageInput) ocrDraft.saveImage = saveImageInput.checked;

    for (const card of app.querySelectorAll(".ocr-candidate")) {
      const candidate = ocrDraft.candidates.find((item) => item.id === card.dataset.candidateId);
      if (!candidate) continue;
      candidate.selected = Boolean(card.querySelector(".js-ocr-selected")?.checked);
      candidate.sourceText = card.querySelector(".js-ocr-source")?.value || "";
      for (const input of card.querySelectorAll(".js-ocr-value")) {
        candidate.values[input.dataset.fieldId] = input.dataset.fieldType === "checkbox" ? input.checked : input.value;
      }
    }
  }

  async function selectOcrFile(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      window.KirokuOCR.validateFile(file);
      releaseOcrImage();
      ocrDraft.file = file;
      ocrDraft.objectUrl = URL.createObjectURL(file);
      ocrDraft.stage = "ready";
      ocrDraft.error = "";
      render();
    } catch (error) {
      ocrDraft.error = error.message || "\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002";
      ocrDraft.stage = "error";
      render();
    }
  }

  function updateOcrProgress(progress) {
    if (!ocrDraft || route.name !== "imageImport") return;
    ocrDraft.progress = progress.progress;
    ocrDraft.status = progress.status;
    const bar = app.querySelector(".js-ocr-progress");
    const percent = app.querySelector(".js-ocr-percent");
    const status = app.querySelector(".js-ocr-status");
    if (bar) bar.value = progress.progress;
    if (percent) percent.textContent = `${Math.round(Math.max(0, Math.min(1, progress.progress)) * 100)}%`;
    if (status) status.textContent = progress.status;
  }

  async function startOcr() {
    if (!ocrDraft?.file) return;
    syncOcrDraftFromDom();
    const currentDraft = ocrDraft;
    currentDraft.stage = "running";
    currentDraft.progress = 0;
    currentDraft.status = "\u753b\u50cf\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059";
    currentDraft.error = "";
    render();

    try {
      const textResult = await window.KirokuOCR.recognize(currentDraft.file, { onProgress: updateOcrProgress });
      if (ocrDraft !== currentDraft) return;
      if (!textResult.trim()) throw new Error("\u6587\u5b57\u3092\u8a8d\u8b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u3088\u308a\u660e\u308b\u3044\u5834\u6240\u3067\u3001\u6587\u5b57\u3092\u5927\u304d\u304f\u64ae\u5f71\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
      currentDraft.text = textResult;
      currentDraft.candidates = window.KirokuImportParser.buildCandidates(
        ViewModel.findNotebook(currentDraft.notebookId),
        textResult,
        currentDraft.splitMode,
        currentDraft.fixedLines
      );
      currentDraft.stage = "review";
      render();
    } catch (error) {
      if (ocrDraft !== currentDraft) return;
      if (error?.name === "AbortError") {
        currentDraft.stage = "ready";
      } else {
        currentDraft.error = error.message || "OCR \u51e6\u7406\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
        currentDraft.stage = "error";
      }
      render();
    }
  }

  function reparseOcr() {
    syncOcrDraftFromDom();
    const notebook = ViewModel.findNotebook(ocrDraft.notebookId);
    ocrDraft.candidates = window.KirokuImportParser.buildCandidates(
      notebook,
      ocrDraft.text,
      ocrDraft.splitMode,
      ocrDraft.fixedLines
    );
    render();
  }

  async function saveOcrRecords() {
    syncOcrDraftFromDom();
    const selected = ocrDraft.candidates.filter((candidate) => candidate.selected);
    if (!selected.length) {
      alert("\u4fdd\u5b58\u3059\u308b\u8a18\u9332\u30921\u4ef6\u4ee5\u4e0a\u9078\u3093\u3067\u304f\u3060\u3055\u3044\u3002");
      return;
    }
    const ok = confirm(`${selected.length}\u4ef6\u306e\u8a18\u9332\u3092\u8ffd\u52a0\u3057\u307e\u3059\u3002\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f`);
    if (!ok) return;

    const notebookId = ocrDraft.notebookId;
    const originalImage = ocrDraft.saveImage ? ocrDraft.file : null;
    const count = await ViewModel.addEntriesBatch(
      notebookId,
      selected.map((candidate) => candidate.values),
      originalImage
    );
    releaseOcrImage();
    ocrDraft = null;
    navigate({ name: "notebook", notebookId });
    alert(`${count}\u4ef6\u306e\u8a18\u9332\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f\u3002`);
  }

  async function onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target || !app.contains(target)) return;

    const action = target.dataset.action;

    if (action === "image-import") {
      const notebookId = target.dataset.notebookId;
      if (!ViewModel.findNotebook(notebookId)) return;
      releaseOcrImage();
      ocrDraft = createOcrDraft(notebookId);
      navigate({ name: "imageImport", notebookId });
    }

    if (action === "discard-image-import") {
      const ok = confirm("\u753b\u50cf\u304b\u3089\u306e\u8a18\u9332\u4f5c\u6210\u3092\u7834\u68c4\u3057\u307e\u3059\u3002\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f");
      if (!ok) return;
      await window.KirokuOCR.cancel();
      const notebookId = ocrDraft?.notebookId || route.notebookId;
      releaseOcrImage();
      ocrDraft = null;
      navigate({ name: "notebook", notebookId });
    }

    if (action === "clear-ocr-image") {
      const ok = confirm("\u9078\u629e\u3057\u305f\u753b\u50cf\u3092\u524a\u9664\u3057\u307e\u3059\u3002\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f");
      if (!ok) return;
      const notebookId = ocrDraft.notebookId;
      releaseOcrImage();
      ocrDraft = createOcrDraft(notebookId);
      render();
    }

    if (action === "start-ocr" || action === "retry-ocr") await startOcr();

    if (action === "cancel-ocr") {
      await window.KirokuOCR.cancel();
      if (ocrDraft) {
        ocrDraft.stage = "ready";
        render();
      }
    }

    if (action === "reparse-ocr") reparseOcr();

    if (action === "extract-ocr-candidate") {
      syncOcrDraftFromDom();
      const index = Number(target.dataset.index);
      const candidate = ocrDraft.candidates[index];
      if (candidate) candidate.values = window.KirokuImportParser.buildValues(ViewModel.findNotebook(ocrDraft.notebookId), candidate.sourceText);
      render();
    }

    if (action === "delete-ocr-candidate") {
      syncOcrDraftFromDom();
      ocrDraft.candidates.splice(Number(target.dataset.index), 1);
      render();
    }

    if (action === "merge-ocr-candidate") {
      syncOcrDraftFromDom();
      const index = Number(target.dataset.index);
      if (index > 0 && index < ocrDraft.candidates.length) {
        const previous = ocrDraft.candidates[index - 1];
        const current = ocrDraft.candidates[index];
        previous.sourceText = [previous.sourceText, current.sourceText].filter(Boolean).join("\n");
        previous.selected = previous.selected || current.selected;
        previous.values = window.KirokuImportParser.buildValues(ViewModel.findNotebook(ocrDraft.notebookId), previous.sourceText);
        ocrDraft.candidates.splice(index, 1);
        render();
      }
    }

    if (action === "split-ocr-candidate") {
      syncOcrDraftFromDom();
      const index = Number(target.dataset.index);
      const current = ocrDraft.candidates[index];
      const lines = window.KirokuImportParser.splitText(current?.sourceText || "", "line");
      if (lines.length < 2) {
        alert("\u5206\u5272\u3067\u304d\u308b\u8907\u6570\u306e\u884c\u304c\u3042\u308a\u307e\u305b\u3093\u3002");
      } else {
        const notebook = ViewModel.findNotebook(ocrDraft.notebookId);
        const replacements = lines.map((line) => window.KirokuImportParser.buildCandidate(notebook, line));
        ocrDraft.candidates.splice(index, 1, ...replacements);
        render();
      }
    }

    if (action === "add-ocr-candidate") {
      syncOcrDraftFromDom();
      ocrDraft.candidates.push(window.KirokuImportParser.buildCandidate(ViewModel.findNotebook(ocrDraft.notebookId), ""));
      render();
    }

    if (action === "save-ocr-records") await saveOcrRecords();

    if (action === "back-home") {
      navigate({ name: "home" });
    }

    if (action === "new-notebook") {
      navigate({ name: "notebookForm", mode: "create", draft: createNotebookDraft() });
    }

    if (action === "open-settings") {
      navigate({ name: "settings" });
    }

    if (action === "open-export") {
      navigate({ name: "export" });
    }

    if (action === "open-notebook") {
      navigate({ name: "notebook", notebookId: target.dataset.notebookId });
    }

    if (action === "notebook-settings") {
      const notebook = ViewModel.findNotebook(target.dataset.notebookId);
      if (!notebook) return;
      navigate({
        name: "notebookForm",
        mode: "settings",
        notebookId: notebook.id,
        draft: {
          name: notebook.name,
          fields: clone(notebook.fields),
          originalFields: clone(notebook.fields),
          deletedFieldIds: [],
        },
      });
    }

    if (action === "add-field") {
      syncNotebookDraftFromDom();
      draft.fields.push(createField("新しい項目", "text"));
      render();
    }

    if (action === "move-field") {
      syncNotebookDraftFromDom();
      const index = Number(target.dataset.index);
      const direction = Number(target.dataset.direction);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.fields.length) return;
      const [field] = draft.fields.splice(index, 1);
      draft.fields.splice(nextIndex, 0, field);
      render();
    }

    if (action === "remove-field") {
      syncNotebookDraftFromDom();
      removeDraftField(Number(target.dataset.index));
    }

    if (action === "delete-notebook") {
      const notebook = ViewModel.findNotebook(route.notebookId);
      if (!notebook) return;
      const ok = confirm(`「${notebook.name}」と保存済みの記録をすべて削除します。本当に削除しますか？`);
      if (!ok) return;
      await ViewModel.deleteNotebook(notebook.id);
      navigate({ name: "home" });
    }

    if (action === "new-entry") {
      navigate({ name: "entryForm", mode: "create", notebookId: target.dataset.notebookId });
    }

    if (action === "edit-entry") {
      navigate({
        name: "entryForm",
        mode: "edit",
        notebookId: target.dataset.notebookId,
        entryId: target.dataset.entryId,
      });
    }

    if (action === "delete-entry") {
      const ok = confirm("この記録を削除します。本当に削除しますか？");
      if (!ok) return;
      await ViewModel.deleteEntry(target.dataset.notebookId, target.dataset.entryId);
      render();
    }

    if (action === "clear-image") {
      const input = app.querySelector(`.js-entry-input[data-field-id="${cssEscape(target.dataset.fieldId)}"]`);
      const preview = target.closest(".field")?.querySelector(".js-image-preview");
      if (input) input.value = "";
      if (preview) preview.innerHTML = "";
      target.remove();
    }

    if (action === "print-pdf") {
      const notebook = ViewModel.findNotebook(target.dataset.notebookId);
      if (notebook) PdfExporter.printNotebook(notebook);
    }
  }

  async function onSubmit(event) {
    if (event.target.id === "notebook-form") {
      event.preventDefault();
      syncNotebookDraftFromDom();
      await saveNotebookForm();
    }

    if (event.target.id === "entry-form") {
      event.preventDefault();
      await saveEntryForm();
    }
  }

  async function onChange(event) {
    const target = event.target;

    if (target.matches("[data-action='select-export-notebook']")) {
      navigate({ name: "export", notebookId: target.value });
    }

    if (target.matches(".js-setting")) {
      await updateSetting(target.dataset.setting, target.value);
    }

    if (target.matches(".js-image-input")) {
      readImageInput(target);
    }

    if (target.matches(".js-ocr-file")) {
      await selectOcrFile(target);
    }

    if (target.matches(".js-ocr-save-image")) {
      ocrDraft.saveImage = target.checked;
    }

    if (target.matches(".js-ocr-split")) {
      syncOcrDraftFromDom();
      render();
    }

    if (target.matches(".js-ocr-selected")) {
      syncOcrDraftFromDom();
      render();
    }
  }

  async function onInput(event) {
    const target = event.target;
    if (target.matches(".js-setting")) {
      await updateSetting(target.dataset.setting, target.value);
    }
  }

  async function updateSetting(key, value) {
    if (key === "themeColor" && !/^#[0-9a-fA-F]{6}$/.test(value)) return;
    await Store.update((state) => {
      state.settings[key] = value;
    });
    applySettings(Store.get().settings);
  }

  function syncNotebookDraftFromDom() {
    if (!draft) return;
    const nameInput = app.querySelector("#notebook-name");
    if (nameInput) draft.name = nameInput.value;

    draft.fields = Array.from(app.querySelectorAll(".js-field-row")).map((row) => ({
      id: row.dataset.fieldId,
      label: row.querySelector(".js-field-label").value,
      type: row.querySelector(".js-field-type").value,
      required: false,
    }));
  }

  async function saveNotebookForm() {
    const name = draft.name.trim();
    const fields = draft.fields
      .map((field) => ({ ...field, label: field.label.trim() }))
      .filter((field) => field.label);

    if (!name) {
      alert("記録名を入力してください。");
      return;
    }

    if (!fields.length) {
      alert("項目を1つ以上追加してください。");
      return;
    }

    if (route.mode === "settings" && hasRiskyTypeChange(fields)) {
      const ok = confirm("項目の種類を変更すると、既存データの表示や入力形式が変わる可能性があります。保存しますか？");
      if (!ok) return;
    }

    if (route.mode === "create") {
      await ViewModel.addNotebook({ name, fields, deletedFieldIds: [] });
      navigate({ name: "home" });
      return;
    }

    await ViewModel.updateNotebook(route.notebookId, {
      name,
      fields,
      deletedFieldIds: draft.deletedFieldIds || [],
    });
    navigate({ name: "notebook", notebookId: route.notebookId });
  }

  function removeDraftField(index) {
    if (!draft || draft.fields.length <= 1) {
      alert("項目は1つ以上必要です。");
      return;
    }

    const field = draft.fields[index];
    if (!field) return;

    if (route.mode === "settings") {
      const notebook = ViewModel.findNotebook(route.notebookId);
      const hasData = notebook?.entries.some((entry) => hasValue(field, entry.values[field.id]));
      if (hasData) {
        const ok = confirm("この項目を削除すると、既存の記録データも削除されます。本当に削除しますか？");
        if (!ok) return;
      }
      draft.deletedFieldIds.push(field.id);
    }

    draft.fields.splice(index, 1);
    render();
  }

  function hasRiskyTypeChange(fields) {
    const notebook = ViewModel.findNotebook(route.notebookId);
    if (!notebook) return false;

    const originalById = new Map((draft.originalFields || []).map((field) => [field.id, field]));
    return fields.some((field) => {
      const original = originalById.get(field.id);
      if (!original || original.type === field.type) return false;
      return notebook.entries.some((entry) => hasValue(original, entry.values[field.id]));
    });
  }

  async function saveEntryForm() {
    const notebook = ViewModel.findNotebook(route.notebookId);
    if (!notebook) return;

    const values = createEmptyValues(notebook.fields);
    for (const input of app.querySelectorAll(".js-entry-input")) {
      const fieldId = input.dataset.fieldId;
      const type = input.dataset.fieldType;
      if (type === "checkbox") {
        values[fieldId] = input.checked;
      } else {
        values[fieldId] = input.value;
      }
    }

    if (route.mode === "edit") {
      await ViewModel.updateEntry(route.notebookId, route.entryId, values);
    } else {
      await ViewModel.addEntry(route.notebookId, values);
    }

    navigate({ name: "notebook", notebookId: route.notebookId });
  }

  function readImageInput(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("画像ファイルを選択してください。");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const wrapper = input.closest(".field");
      const hidden = wrapper.querySelector(".js-entry-input");
      const preview = wrapper.querySelector(".js-image-preview");
      hidden.value = String(reader.result || "");
      preview.innerHTML = `<img class="thumb" src="${escapeHtml(hidden.value)}" alt="" />`;
      if (!wrapper.querySelector("[data-action='clear-image']")) {
        wrapper.insertAdjacentHTML(
          "beforeend",
          `<button type="button" class="button danger" data-action="clear-image" data-field-id="${escapeHtml(input.dataset.fieldId)}">画像を削除</button>`
        );
      }
    };
    reader.readAsDataURL(file);
  }

  function getEntryTitle(notebook, entry) {
    const preferred = notebook.fields.find((field) => ["text", "date"].includes(field.type) && hasValue(field, entry.values[field.id]));
    if (!preferred) return "";
    return String(formatPlainValue(preferred, entry.values[preferred.id])).trim();
  }

  function hasValue(field, value) {
    if (field.type === "checkbox") return value === true;
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  function formatPlainValue(field, value) {
    if (field.type === "checkbox") return value ? "はい" : "いいえ";
    if (field.type === "date") return formatDate(value);
    if (field.type === "image") return value ? "画像あり" : "";
    return value ?? "";
  }

  function formatValueForHtml(field, value) {
    if (field.type === "image") {
      return value ? `<img class="thumb" src="${escapeHtml(value)}" alt="${escapeHtml(field.label)}" />` : "";
    }
    return escapeHtml(formatPlainValue(field, value));
  }

  function formatValueForPrint(field, value) {
    if (field.type === "image") {
      return value ? `<img src="${escapeHtml(value)}" alt="${escapeHtml(field.label)}" />` : "";
    }
    return escapeHtml(formatPlainValue(field, value));
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol === "file:") return;

    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }

  async function boot() {
    app.innerHTML = `
      <main class="main">
        <div class="empty">
          <p>データを読み込んでいます。</p>
        </div>
      </main>
    `;

    try {
      const result = await Store.init();
      if (result.migrated) {
        console.info("Legacy localStorage data migrated to IndexedDB.");
      }

      applySettings(Store.get().settings);
      app.addEventListener("click", onClick);
      app.addEventListener("submit", onSubmit);
      app.addEventListener("change", onChange);
      app.addEventListener("input", onInput);
      registerServiceWorker();
      render();
    } catch (error) {
      console.error(error);
      app.innerHTML = `
        <main class="main">
          <div class="empty">
            <p>保存領域を開けませんでした。Safariのプライベートブラウズを解除し、空き容量を確認してください。</p>
          </div>
        </main>
      `;
    }
  }

  boot();
})();
