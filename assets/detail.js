(() => {
  "use strict";

  const tooltip = document.querySelector("#chart-tooltip");
  const tablist = document.querySelector(".overview-tabs[role='tablist']");
  const panel = document.querySelector("#overview-panel");
  const display = document.querySelector(".overview-display");
  const canvas = document.querySelector(".overview-canvas");
  const loading = document.querySelector("#overview-loading");
  const selectedLabel = document.querySelector("#overview-selected-label");
  const downloadLink = document.querySelector("#overview-download-link");
  const zoomOutput = document.querySelector("#overview-zoom-output");
  const zoomOutButton = document.querySelector("[data-zoom-action='out']");
  const fitButton = document.querySelector("[data-zoom-action='fit']");
  const zoomInButton = document.querySelector("[data-zoom-action='in']");
  const tableSection = document.querySelector("#financial-table-section");
  const tableSelectedLabel = document.querySelector("#financial-table-selected-label");
  const pdfLinksContainer = document.querySelector("#financial-pdf-links");
  const tablesContainer = document.querySelector("#financial-tables");
  const renderer = window.CompanyChartRenderer;

  if (
    !(tooltip instanceof HTMLElement) ||
    !(tablist instanceof HTMLElement) ||
    !(panel instanceof HTMLElement) ||
    !(display instanceof HTMLElement) ||
    !(canvas instanceof HTMLElement) ||
    !(loading instanceof HTMLElement) ||
    !(selectedLabel instanceof HTMLElement) ||
    !(downloadLink instanceof HTMLAnchorElement) ||
    !(zoomOutput instanceof HTMLOutputElement) ||
    !(zoomOutButton instanceof HTMLButtonElement) ||
    !(fitButton instanceof HTMLButtonElement) ||
    !(zoomInButton instanceof HTMLButtonElement) ||
    !(tableSection instanceof HTMLElement) ||
    !(tableSelectedLabel instanceof HTMLElement) ||
    !(pdfLinksContainer instanceof HTMLElement) ||
    !(tablesContainer instanceof HTMLElement) ||
    !renderer
  ) {
    return;
  }

  const tabs = Array.from(tablist.querySelectorAll("[role='tab']")).filter(
    (tab) => tab instanceof HTMLButtonElement,
  );
  if (tabs.length === 0) {
    return;
  }

  document.body.classList.add("js-enhanced");

  const MIN_ZOOM = 0.5;
  const DEFAULT_MAX_ZOOM = 4;
  const ZOOM_STEP = 0.25;
  const WHEEL_ZOOM_THRESHOLD = 120;
  const payloadUrl = panel.dataset.payloadUrl;
  const viewCache = new Map();
  let requestToken = 0;
  let describedSegment = null;
  let pinnedSegment = null;
  let currentSvg = null;
  let zoom = 1;
  let maxZoom = DEFAULT_MAX_ZOOM;
  let baseWidth = 0;
  let baseHeight = 0;
  let resizeFrame = null;
  let dragState = null;
  let suppressSegmentClick = false;
  let activeObjectUrl = null;
  let tableRenderToken = 0;
  let wheelZoomDelta = 0;

  if (!payloadUrl) {
    return;
  }

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));

  const htmlElement = (name, className = null, text = null) => {
    const node = document.createElement(name);
    if (className !== null) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
  };

  const tableFragment = (model) => {
    const fragment = document.createDocumentFragment();
    model.tables.forEach((tableModel, tableIndex) => {
      const section = htmlElement("section", "financial-table-group");
      const heading = htmlElement("div", "financial-table-group-heading");
      heading.append(htmlElement("h3", null, tableModel.label));
      const copyArea = htmlElement("div", "financial-table-copy-area");
      const copyButton = htmlElement("button", "financial-table-copy", "Markdownをコピー");
      copyButton.type = "button";
      copyButton.setAttribute("aria-label", `${tableModel.label}をMarkdownでコピー`);
      const copyStatus = htmlElement("p", "financial-table-copy-status");
      copyStatus.id = `financial-table-copy-status-${tableIndex}`;
      copyStatus.setAttribute("role", "status");
      copyStatus.setAttribute("aria-live", "polite");
      copyButton.setAttribute("aria-describedby", copyStatus.id);
      const markdown = renderer.overviewTableMarkdown({ ...model, tables: [tableModel] });
      const renderToken = tableRenderToken;
      copyButton.addEventListener("click", async () => {
        if (copyButton.disabled) return;
        copyButton.disabled = true;
        copyStatus.textContent = "コピーしています…";
        try {
          await copyText(markdown);
          if (renderToken === tableRenderToken) {
            copyStatus.textContent = "Markdownをコピーしました";
          }
        } catch (_error) {
          if (renderToken === tableRenderToken) {
            copyStatus.textContent = "コピーできませんでした";
          }
        } finally {
          if (renderToken === tableRenderToken) {
            copyButton.disabled = false;
          }
        }
      });
      copyArea.append(copyButton, copyStatus);
      heading.append(copyArea);
      section.append(heading);
      const scroll = htmlElement("div", "financial-table-scroll");
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", `${tableModel.label}財務諸表`);
      scroll.tabIndex = 0;
      const table = htmlElement("table", "financial-table");
      const caption = htmlElement("caption", "visually-hidden", `${model.viewLabel}・${tableModel.label}`);
      table.append(caption);
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["期末", "PL", "BS", "CF"].forEach((label, index) => {
        const cell = htmlElement("th", index === 0 ? "financial-table-period" : "financial-statement-cell", label);
        cell.scope = "col";
        headRow.append(cell);
      });
      head.append(headRow);
      table.append(head);
      const body = document.createElement("tbody");
      tableModel.rows.forEach((row) => {
        const tableRow = document.createElement("tr");
        const period = htmlElement("th", "financial-table-period");
        period.scope = "row";
        const time = htmlElement("time", null, row.periodEnd);
        time.dateTime = row.periodEnd;
        period.append(time);
        tableRow.append(period);
        row.statements.forEach((statement) => {
          if (statement === null) {
            tableRow.append(htmlElement("td", "financial-statement-cell financial-cell-missing", "—"));
            return;
          }
          const cell = htmlElement("td", "financial-statement-cell");
          cell.append(htmlElement("p", "financial-cell-meta", statement.meta));
          cell.append(htmlElement("p", "financial-cell-period", statement.periodLabel));
          if (statement.details.length > 0) {
            const list = htmlElement("ul", "financial-cell-details");
            statement.details.forEach((detail) => list.append(htmlElement("li", null, detail)));
            cell.append(list);
          }
          if (statement.footer !== null) {
            cell.append(htmlElement("strong", "financial-cell-footer", statement.footer));
          }
          tableRow.append(cell);
        });
        body.append(tableRow);
      });
      table.append(body);
      scroll.append(table);
      section.append(scroll);
      fragment.append(section);
    });
    return fragment;
  };

  const pdfLinksFragment = (model) => {
    if (model.sourceDocuments.length === 0) {
      return htmlElement("p", "financial-pdf-state", "PDFデータなし");
    }
    const list = htmlElement("ul", "financial-pdf-list");
    model.sourceDocuments.forEach((sourceDocument) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const documentTypes = sourceDocument.documentTypes.join("・");
      link.href = `https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${encodeURIComponent(sourceDocument.docId)}.pdf`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${sourceDocument.periodEnd}・${documentTypes}`;
      item.append(link);
      list.append(item);
    });
    return list;
  };

  const resetFinancialTable = (label, message) => {
    tableRenderToken += 1;
    tableSelectedLabel.textContent = label;
    pdfLinksContainer.replaceChildren(
      htmlElement("p", "financial-pdf-state", "PDF一覧を読み込んでいます…"),
    );
    tablesContainer.replaceChildren(htmlElement("p", "financial-table-state", message));
    tableSection.hidden = false;
    tableSection.setAttribute("aria-busy", "true");
  };

  const commitFinancialTable = (model) => {
    const fragment = tableFragment(model);
    pdfLinksContainer.replaceChildren(pdfLinksFragment(model));
    tablesContainer.replaceChildren(fragment);
    tableSelectedLabel.textContent = model.viewLabel;
    tableSection.hidden = false;
    tableSection.setAttribute("aria-busy", "false");
  };

  const legacyCopy = (text) => {
    const textarea = htmlElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }
    return copied;
  };

  const copyText = async (text) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_error) {
        // Fall through for browsers or permission policies that reject Clipboard API.
      }
    }
    if (!legacyCopy(text)) throw new Error("Clipboard unavailable");
  };

  const maximumZoomForSvg = (svg) => {
    const viewBoxWidth = svg.viewBox.baseVal.width;
    const columnPositions = Array.from(svg.querySelectorAll(".overview-column-header"))
      .map((header) => header.transform?.baseVal.consolidate()?.matrix.e)
      .filter((position) => Number.isFinite(position))
      .sort((left, right) => left - right)
      .filter((position, index, positions) => index === 0 || position !== positions[index - 1]);
    let columnPitch = Number.POSITIVE_INFINITY;
    for (let index = 1; index < columnPositions.length; index += 1) {
      const difference = columnPositions[index] - columnPositions[index - 1];
      if (difference > 0) {
        columnPitch = Math.min(columnPitch, difference);
      }
    }
    if (!(viewBoxWidth > 0) || !Number.isFinite(columnPitch)) {
      return DEFAULT_MAX_ZOOM;
    }
    const periodFillsViewport = viewBoxWidth / columnPitch;
    return Math.max(
      DEFAULT_MAX_ZOOM,
      Math.ceil(periodFillsViewport / ZOOM_STEP) * ZOOM_STEP,
    );
  };

  const placeTooltip = (x, y) => {
    const margin = 12;
    tooltip.style.left = `${margin}px`;
    tooltip.style.top = `${margin}px`;
    const bounds = tooltip.getBoundingClientRect();
    const left = Math.max(margin, Math.min(x + margin, window.innerWidth - bounds.width - margin));
    const top = Math.max(margin, Math.min(y + margin, window.innerHeight - bounds.height - margin));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const showTooltip = (segment, x, y, { pin = false } = {}) => {
    if (dragState) {
      return;
    }
    if (pinnedSegment && !pin && pinnedSegment !== segment) {
      return;
    }
    if (describedSegment && describedSegment !== segment) {
      describedSegment.removeAttribute("aria-describedby");
    }
    if (pin && pinnedSegment && pinnedSegment !== segment) {
      pinnedSegment.setAttribute("aria-expanded", "false");
    }
    describedSegment = segment;
    if (pin) {
      pinnedSegment = segment;
      segment.setAttribute("aria-expanded", "true");
    }
    tooltip.textContent = segment.dataset.tooltip || "";
    tooltip.hidden = false;
    segment.setAttribute("aria-describedby", "chart-tooltip");
    placeTooltip(x, y);
  };

  const clearTooltip = () => {
    tooltip.hidden = true;
    if (describedSegment) {
      describedSegment.removeAttribute("aria-describedby");
    }
    if (pinnedSegment) {
      pinnedSegment.setAttribute("aria-expanded", "false");
    }
    describedSegment = null;
    pinnedSegment = null;
  };

  const hideTransientTooltip = (segment) => {
    if (pinnedSegment === segment || describedSegment !== segment) {
      return;
    }
    tooltip.hidden = true;
    segment.removeAttribute("aria-describedby");
    describedSegment = null;
  };

  const togglePinnedTooltip = (segment, x, y) => {
    if (pinnedSegment === segment) {
      clearTooltip();
      return;
    }
    showTooltip(segment, x, y, { pin: true });
  };

  const bindTooltips = (scope) => {
    scope.querySelectorAll("[data-tooltip]").forEach((segment) => {
      segment.setAttribute("role", "button");
      segment.setAttribute("aria-expanded", "false");
      segment.addEventListener("pointerenter", (event) => {
        showTooltip(segment, event.clientX, event.clientY);
      });
      segment.addEventListener("pointermove", (event) => {
        if (!dragState && !pinnedSegment) {
          placeTooltip(event.clientX, event.clientY);
        }
      });
      segment.addEventListener("pointerleave", () => hideTransientTooltip(segment));
      segment.addEventListener("focus", () => {
        const bounds = segment.getBoundingClientRect();
        showTooltip(segment, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      });
      segment.addEventListener("blur", () => hideTransientTooltip(segment));
      segment.addEventListener("click", (event) => {
        if (suppressSegmentClick) {
          return;
        }
        event.stopPropagation();
        togglePinnedTooltip(segment, event.clientX, event.clientY);
      });
      segment.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          clearTooltip();
          segment.blur();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const bounds = segment.getBoundingClientRect();
          togglePinnedTooltip(
            segment,
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
        }
      });
    });
  };

  const viewerGeometry = () => {
    const scaledWidth = baseWidth * zoom;
    const scaledHeight = baseHeight * zoom;
    const canvasWidth = Math.max(display.clientWidth, scaledWidth);
    const canvasHeight = Math.max(display.clientHeight, scaledHeight);
    return {
      canvasWidth,
      canvasHeight,
      offsetX: (canvasWidth - scaledWidth) / 2,
      offsetY: (canvasHeight - scaledHeight) / 2,
    };
  };

  const updateZoomControls = () => {
    const percentage = Math.round(zoom * 100);
    zoomOutput.value = `${percentage}%`;
    zoomOutput.textContent = `${percentage}%`;
    zoomOutButton.disabled = zoom <= MIN_ZOOM;
    zoomInButton.disabled = zoom >= maxZoom;
    zoomInButton.title = `最大 ${Math.round(maxZoom * 100)}%`;
    zoomOutput.title = `最大 ${Math.round(maxZoom * 100)}%`;
    fitButton.setAttribute("aria-pressed", zoom === 1 ? "true" : "false");
    display.dataset.zoom = String(zoom);
    display.dataset.maxZoom = String(maxZoom);
  };

  const renderViewerGeometry = () => {
    if (!currentSvg || baseWidth <= 0 || baseHeight <= 0) {
      updateZoomControls();
      return viewerGeometry();
    }
    const geometry = viewerGeometry();
    canvas.style.width = `${geometry.canvasWidth}px`;
    canvas.style.height = `${geometry.canvasHeight}px`;
    currentSvg.style.width = `${baseWidth * zoom}px`;
    currentSvg.style.height = `${baseHeight * zoom}px`;
    currentSvg.style.left = `${geometry.offsetX}px`;
    currentSvg.style.top = `${geometry.offsetY}px`;
    currentSvg.style.removeProperty("transform");
    updateZoomControls();
    return geometry;
  };

  const endDrag = () => {
    const pointerId = dragState?.pointerId;
    dragState = null;
    display.classList.remove("is-dragging");
    if (pointerId !== undefined && display.hasPointerCapture(pointerId)) {
      display.releasePointerCapture(pointerId);
    }
  };

  const setZoom = (requestedZoom, anchor = null) => {
    if (!currentSvg) {
      return;
    }
    const nextZoom = clamp(
      Math.round(requestedZoom / ZOOM_STEP) * ZOOM_STEP,
      MIN_ZOOM,
      maxZoom,
    );
    const anchorX = anchor?.x ?? display.clientWidth / 2;
    const anchorY = anchor?.y ?? display.clientHeight / 2;
    const oldGeometry = viewerGeometry();
    const sourceX = (display.scrollLeft + anchorX - oldGeometry.offsetX) / zoom;
    const sourceY = (display.scrollTop + anchorY - oldGeometry.offsetY) / zoom;

    endDrag();
    clearTooltip();
    zoom = nextZoom;
    const newGeometry = renderViewerGeometry();
    display.scrollLeft = clamp(
      newGeometry.offsetX + sourceX * zoom - anchorX,
      0,
      Math.max(0, newGeometry.canvasWidth - display.clientWidth),
    );
    display.scrollTop = clamp(
      newGeometry.offsetY + sourceY * zoom - anchorY,
      0,
      Math.max(0, newGeometry.canvasHeight - display.clientHeight),
    );
  };

  const resetViewer = () => {
    endDrag();
    clearTooltip();
    wheelZoomDelta = 0;
    zoom = 1;
    baseWidth = display.clientWidth;
    baseHeight = display.clientHeight;
    renderViewerGeometry();
    display.scrollLeft = 0;
    display.scrollTop = 0;
  };

  const clearViewer = () => {
    endDrag();
    clearTooltip();
    wheelZoomDelta = 0;
    currentSvg = null;
    zoom = 1;
    maxZoom = DEFAULT_MAX_ZOOM;
    baseWidth = 0;
    baseHeight = 0;
    canvas.replaceChildren();
    canvas.removeAttribute("style");
    display.scrollLeft = 0;
    display.scrollTop = 0;
    updateZoomControls();
  };

  const resizeViewer = () => {
    if (!currentSvg || baseWidth <= 0 || baseHeight <= 0) {
      return;
    }
    const oldGeometry = viewerGeometry();
    const sourceCenterX =
      (display.scrollLeft + display.clientWidth / 2 - oldGeometry.offsetX) / zoom;
    const sourceCenterY =
      (display.scrollTop + display.clientHeight / 2 - oldGeometry.offsetY) / zoom;
    const sourceRatioX = sourceCenterX / baseWidth;
    const sourceRatioY = sourceCenterY / baseHeight;

    baseWidth = display.clientWidth;
    baseHeight = display.clientHeight;
    const newGeometry = renderViewerGeometry();
    display.scrollLeft = clamp(
      newGeometry.offsetX + sourceRatioX * baseWidth * zoom - display.clientWidth / 2,
      0,
      Math.max(0, newGeometry.canvasWidth - display.clientWidth),
    );
    display.scrollTop = clamp(
      newGeometry.offsetY + sourceRatioY * baseHeight * zoom - display.clientHeight / 2,
      0,
      Math.max(0, newGeometry.canvasHeight - display.clientHeight),
    );
  };

  const scheduleViewerResize = () => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resizeViewer();
    });
  };

  const payloadPromise = fetch(payloadUrl, { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Payload request failed: ${response.status}`);
      }
      return response.text();
    })
    .then((payloadText) => {
      if (new Blob([payloadText]).size > 2_000_000) {
        throw new Error("Payload is too large");
      }
      return JSON.parse(payloadText);
    })
    .then((payload) => {
      renderer.validatePayload(payload);
      if (payload.views.length !== tabs.length) {
        throw new Error("Tab and payload view count differ");
      }
      payload.views.forEach((view, index) => {
        const tab = tabs[index];
        if (
          tab.dataset.view !== view.viewKey ||
          tab.dataset.label !== view.label ||
          tab.dataset.downloadFilename !== view.downloadFilename
        ) {
          throw new Error("Tab and payload view manifest differ");
        }
      });
      return payload;
    });

  const releaseDownload = () => {
    if (activeObjectUrl !== null) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
    downloadLink.removeAttribute("href");
  };

  const enableDownload = (canonicalMarkup, filename) => {
    releaseDownload();
    activeObjectUrl = URL.createObjectURL(
      new Blob([canonicalMarkup], { type: "image/svg+xml;charset=utf-8" }),
    );
    downloadLink.href = activeObjectUrl;
    downloadLink.download = filename;
    downloadLink.removeAttribute("aria-disabled");
  };

  const disableDownload = () => {
    releaseDownload();
    downloadLink.removeAttribute("download");
    downloadLink.setAttribute("aria-disabled", "true");
  };

  const setHistory = (tab, mode) => {
    if (mode === "none") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", tab.dataset.view || "");
    window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
  };

  const tableViewFor = (payload, selectedView) => payload.views.find((candidate) => (
    candidate.scope[0] === selectedView.scope[0]
      && candidate.scope[1] === "all"
      && candidate.scope[2] === selectedView.scope[2]
  )) || selectedView;

  const selectTab = async (tab, { historyMode = "push", focus = false } = {}) => {
    if (!(tab instanceof HTMLButtonElement)) {
      return;
    }
    const viewKey = tab.dataset.view;
    const filename = tab.dataset.downloadFilename;
    const label = tab.dataset.label;
    if (!viewKey || !filename || !label) {
      return;
    }

    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", selected ? "true" : "false");
      candidate.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", tab.id);
    selectedLabel.textContent = label;
    disableDownload();
    resetFinancialTable(label, "表を読み込んでいます…");
    setHistory(tab, historyMode);
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focus) {
      tab.focus();
    }

    clearViewer();
    const currentToken = ++requestToken;
    panel.setAttribute("aria-busy", "true");
    loading.setAttribute("role", "status");
    loading.classList.remove("overview-load-error");
    loading.textContent = "SVGを読み込んでいます…";
    loading.hidden = false;

    try {
      const payload = await payloadPromise;
      if (currentToken !== requestToken) {
        return;
      }
      const view = payload.views.find((candidate) => candidate.viewKey === viewKey);
      if (!view) {
        throw new Error("Selected view is missing");
      }
      let cached = viewCache.get(viewKey);
      if (!cached) {
        const overview = renderer.canonicalOverview(payload, view);
        const tableModel = renderer.overviewTableModel(payload, tableViewFor(payload, view));
        cached = {
          ...overview,
          tableModel,
        };
        cached.svgElement.setAttribute("role", "group");
        cached.svgElement.classList.add("overview-svg");
        bindTooltips(cached.svgElement);
        viewCache.set(viewKey, cached);
      }
      const svg = cached.svgElement;
      currentSvg = svg;
      canvas.replaceChildren(svg);
      maxZoom = maximumZoomForSvg(svg);
      resetViewer();
      enableDownload(cached.canonicalMarkup, filename);
      commitFinancialTable(cached.tableModel);
      loading.hidden = true;
      panel.setAttribute("aria-busy", "false");
    } catch (_error) {
      if (currentToken !== requestToken) {
        return;
      }
      clearViewer();
      disableDownload();
      resetFinancialTable(label, "財務諸表を表形式で読み込めませんでした。");
      pdfLinksContainer.replaceChildren(
        htmlElement("p", "financial-pdf-state", "PDF一覧を読み込めませんでした。"),
      );
      tableSection.setAttribute("aria-busy", "false");
      loading.textContent = "財務グラフを読み込めませんでした。ページを再読み込みしてください。";
      loading.setAttribute("role", "alert");
      loading.classList.add("overview-load-error");
      loading.hidden = false;
      panel.setAttribute("aria-busy", "false");
    }
  };

  zoomOutButton.addEventListener("click", () => {
    wheelZoomDelta = 0;
    setZoom(zoom - ZOOM_STEP);
  });
  fitButton.addEventListener("click", () => {
    wheelZoomDelta = 0;
    setZoom(1);
    display.scrollLeft = 0;
    display.scrollTop = 0;
  });
  zoomInButton.addEventListener("click", () => {
    wheelZoomDelta = 0;
    setZoom(zoom + ZOOM_STEP);
  });
  downloadLink.addEventListener("click", (event) => {
    if (downloadLink.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });
  display.addEventListener("wheel", (event) => {
    clearTooltip();
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    event.preventDefault();
    const deltaScale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? display.clientHeight
        : 1;
    const zoomDelta = -event.deltaY * deltaScale;
    if (!Number.isFinite(zoomDelta) || zoomDelta === 0) {
      return;
    }
    if (wheelZoomDelta !== 0 && Math.sign(wheelZoomDelta) !== Math.sign(zoomDelta)) {
      wheelZoomDelta = 0;
    }
    wheelZoomDelta += zoomDelta;
    const zoomSteps = Math.trunc(wheelZoomDelta / WHEEL_ZOOM_THRESHOLD);
    if (zoomSteps === 0) {
      return;
    }
    wheelZoomDelta -= zoomSteps * WHEEL_ZOOM_THRESHOLD;
    const bounds = display.getBoundingClientRect();
    setZoom(zoom + zoomSteps * ZOOM_STEP, {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  }, { passive: false });

  display.addEventListener("scroll", () => clearTooltip());
  display.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      wheelZoomDelta = 0;
      setZoom(zoom + ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      wheelZoomDelta = 0;
      setZoom(zoom - ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      wheelZoomDelta = 0;
      setZoom(1);
      display.scrollLeft = 0;
      display.scrollTop = 0;
    }
  });

  display.addEventListener("pointerdown", (event) => {
    if (zoom <= 1 || !event.isPrimary || event.button !== 0) {
      return;
    }
    endDrag();
    clearTooltip();
    suppressSegmentClick = false;
    dragState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: display.scrollLeft,
      scrollTop: display.scrollTop,
    };
    display.setPointerCapture(event.pointerId);
    display.classList.add("is-dragging");
    event.preventDefault();
  });
  display.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    display.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.clientX);
    display.scrollTop = dragState.scrollTop - (event.clientY - dragState.clientY);
    if (
      Math.abs(event.clientX - dragState.clientX) > 4 ||
      Math.abs(event.clientY - dragState.clientY) > 4
    ) {
      suppressSegmentClick = true;
    }
    clearTooltip();
  });
  display.addEventListener("pointerup", endDrag);
  display.addEventListener("pointercancel", endDrag);
  display.addEventListener("lostpointercapture", endDrag);
  document.addEventListener("click", () => clearTooltip());

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft") {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      }
      if (nextIndex !== null) {
        event.preventDefault();
        selectTab(tabs[nextIndex], { focus: true });
      }
    });
  });

  window.addEventListener("popstate", () => {
    const view = new URL(window.location.href).searchParams.get("view");
    const tab = tabs.find((candidate) => candidate.dataset.view === view) || tabs[0];
    selectTab(tab, { historyMode: "none" });
  });
  window.addEventListener("pagehide", releaseDownload);

  new ResizeObserver(scheduleViewerResize).observe(display);
  updateZoomControls();
  const initialView = new URL(window.location.href).searchParams.get("view");
  const initialTab = tabs.find((tab) => tab.dataset.view === initialView) || tabs[0];
  selectTab(initialTab, { historyMode: "none" });
})();
