(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_STRING_CODEPOINTS = 4096;
  const STATEMENTS = ["PL", "BS", "CF"];
  const DOCUMENT_LABELS = {
    Annual: "通期",
    SemiAnnual: "半期",
    Quarterly: "四半期",
  };
  const STATEMENT_NAMES = {
    PL: "損益計算書",
    BS: "貸借対照表",
    CF: "キャッシュ・フロー計算書",
  };
  const BAR_LABELS = {
    PL: ["費用・営業利益", "売上高"],
    BS: ["資産", "負債・純資産"],
    CF: ["営業", "投資", "財務", "FCF"],
  };
  const LEGENDS = {
    PL: [["費用", "expenses"], ["営業利益", "operating-income"], ["売上高", "net-sales"]],
    BS: [
      ["流動資産", "current-assets"],
      ["固定・非流動資産", "noncurrent-assets"],
      ["その他資産", "other-assets"],
      ["資産（未分類）", "assets"],
      ["負債", "liabilities"],
      ["純資産", "net-assets"],
    ],
    CF: [["営業CF", "operating"], ["投資CF", "investing"], ["財務CF", "financing"], ["FCF", "free-cash-flow"]],
  };
  const SLOT_CATEGORIES = {
    PL: [["operating-income", "expenses"], ["net-sales"]],
    BS: [["assets", "current-assets", "noncurrent-assets", "other-assets"], ["net-assets", "liabilities"]],
    CF: [["operating"], ["investing"], ["financing"], ["free-cash-flow"]],
  };
  const STYLE = `
    text { fill: #17202a; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .page-background { fill: #f4f6f8; }
    .company-name { font-size: 30px; font-weight: 750; }
    .company-code { fill: #52616f; font-size: 16px; }
    .table-heading { font-size: 24px; font-weight: 750; }
    .statement-label { font-size: 25px; font-weight: 800; }
    .statement-name { font-size: 14px; font-weight: 650; }
    .period-count-label { fill: #52616f; font-size: 13px; }
    .column-header-label { fill: #52616f; font-size: 13px; font-weight: 700; }
    .period-meta { fill: #52616f; font-size: 12px; }
    .period-label { font-size: 14px; font-weight: 700; }
    .chart-footer { font-size: 12px; }
    .accounting-standard-transition-line { stroke: #b7473e; stroke-width: 2; }
    .accounting-standard-transition-label { fill: #8f2f28; font-size: 12px; font-weight: 700; }
    .annual-period-header-marker { stroke: #075a9c; stroke-width: 2.5; }
    .zero-line { stroke: #1d2730; stroke-width: 1.5; }
    .bar-segment, .zero-marker { stroke: #17202a; stroke-width: .8; }
    .expenses { fill: #4a9b72; }
    .operating-income { fill: #e6a04b; }
    .net-sales, .assets { fill: #4f83cc; }
    .current-assets { fill: #2f6fb2; }
    .noncurrent-assets { fill: #9a6fc2; }
    .other-assets { fill: #9fb8c8; }
    .liabilities { fill: #d16b63; }
    .net-assets { fill: #79a858; }
    .operating { fill: #007c83; }
    .investing { fill: #c44569; }
    .financing { fill: #5c6bc0; }
    .free-cash-flow { fill: #f2c14e; }
    .bar-label { fill: #17202a; font-size: 11px; font-weight: 650; }
    .statement-legend-swatch { stroke: #17202a; stroke-width: .8; }
    .statement-legend-label { fill: #17202a; font-size: 9px; font-weight: 650; }
    .missing-data { fill: #52616f; font-size: 9px; }
  `;

  const element = (name, attributes = {}, text = null) => {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== null) {
      node.textContent = text;
    }
    return node;
  };

  const requireValue = (condition, message) => {
    if (!condition) {
      throw new Error(`Invalid company chart payload: ${message}`);
    }
  };

  const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const validateStrings = (value) => {
    if (typeof value === "string") {
      requireValue(Array.from(value).length <= MAX_STRING_CODEPOINTS, "string is too long");
    } else if (Array.isArray(value)) {
      value.forEach(validateStrings);
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => {
        validateStrings(key);
        validateStrings(child);
      });
    }
  };

  const validateCell = (cell, index) => {
    requireValue(Array.isArray(cell) && cell.length === 10, `cell[${index}] shape`);
    const [statement, documentType, standard, unit, docId, isCurrent, periodEnd, label, stacks, footer] = cell;
    requireValue(STATEMENTS.includes(statement), `cell[${index}] statement`);
    requireValue(Object.hasOwn(DOCUMENT_LABELS, documentType), `cell[${index}] document type`);
    requireValue([standard, unit, docId, label].every((value) => typeof value === "string") && (footer === null || typeof footer === "string"), `cell[${index}] strings`);
    requireValue(typeof isCurrent === "boolean" && isDate(periodEnd), `cell[${index}] period`);
    const allowedSlots = SLOT_CATEGORIES[statement];
    requireValue(Array.isArray(stacks) && stacks.length === allowedSlots.length, `cell[${index}] stacks`);
    stacks.forEach((stack, slotIndex) => {
      if (stack === null) return;
      requireValue(Array.isArray(stack) && stack.length >= 1 && stack.length <= 3, "stack size");
      const categories = [];
      stack.forEach((segment) => {
        requireValue(Array.isArray(segment) && segment.length === 3, "segment shape");
        const [category, value, tooltip] = segment;
        requireValue(allowedSlots[slotIndex].includes(category), "segment category");
        requireValue(isFiniteNumber(value) && typeof tooltip === "string", "segment value");
        categories.push(category);
      });
      requireValue(new Set(categories).size === categories.length, "duplicate category");
      requireValue(
        JSON.stringify(categories) === JSON.stringify(allowedSlots[slotIndex].filter((category) => categories.includes(category))),
        "category order",
      );
      if (statement === "BS" && slotIndex === 0 && categories.includes("assets")) {
        requireValue(categories.length === 1, "classified and unclassified assets mixed");
      }
    });
  };

  const validateTable = (table, cells, disclosureScope) => {
    requireValue(table && typeof table === "object" && !Array.isArray(table), "table");
    const keys = Object.keys(table).sort().join(",");
    requireValue(keys === "annualMarkerColumnIndexes,consolidated,periodEnds,rows,transitions", "table keys");
    const { periodEnds, annualMarkerColumnIndexes: markers, rows, transitions } = table;
    requireValue(typeof table.consolidated === "boolean", "table consolidation");
    requireValue(Array.isArray(periodEnds) && periodEnds.length >= 1 && periodEnds.length <= 512, "periodEnds");
    requireValue(periodEnds.every(isDate) && new Set(periodEnds).size === periodEnds.length, "periodEnds values");
    requireValue(JSON.stringify(periodEnds) === JSON.stringify([...periodEnds].sort()), "periodEnds order");
    requireValue(Array.isArray(markers) && markers.every((index) => Number.isInteger(index) && index >= 0 && index < periodEnds.length), "annual markers");
    requireValue(new Set(markers).size === markers.length && (disclosureScope !== "annual" || markers.length === 0), "annual marker scope");
    requireValue(Array.isArray(rows) && rows.length === 3 && rows.map((row) => row[0]).join(",") === "PL,BS,CF", "rows");
    const standards = Array(periodEnds.length).fill(null);
    const currentColumns = new Set();
    rows.forEach((row) => {
      requireValue(Array.isArray(row) && row.length === 3, "row shape");
      const [statement, domains, references] = row;
      requireValue(Array.isArray(domains) && Array.isArray(references) && references.length === periodEnds.length, "row fields");
      const units = new Set();
      domains.forEach((domain) => {
        requireValue(Array.isArray(domain) && domain.length === 3, "domain shape");
        requireValue(typeof domain[0] === "string" && !units.has(domain[0]) && isFiniteNumber(domain[1]) && isFiniteNumber(domain[2]) && domain[1] < domain[2], "domain");
        units.add(domain[0]);
      });
      references.forEach((reference, columnIndex) => {
        if (reference === null) return;
        requireValue(Number.isInteger(reference) && reference >= 0 && reference < cells.length, "cell reference");
        const cell = cells[reference];
        requireValue(cell[0] === statement && cell[6] === periodEnds[columnIndex] && units.has(cell[3]), "cell correlation");
        requireValue(standards[columnIndex] === null || standards[columnIndex] === cell[2], "column standard");
        standards[columnIndex] = cell[2];
        if (cell[5]) currentColumns.add(columnIndex);
      });
    });
    const expectedTransitions = [];
    let previousStandard = null;
    [...currentColumns].sort((left, right) => left - right).forEach((columnIndex) => {
      const standard = standards[columnIndex];
      if (previousStandard !== null && standard !== previousStandard) {
        expectedTransitions.push([columnIndex, previousStandard, standard]);
      }
      previousStandard = standard;
    });
    requireValue(JSON.stringify(transitions) === JSON.stringify(expectedTransitions), "transitions");
  };

  const validatePayload = (payload) => {
    requireValue(payload && typeof payload === "object" && !Array.isArray(payload), "payload");
    requireValue(Object.keys(payload).sort().join(",") === "cells,company,v,views" && payload.v === 1, "top-level");
    requireValue(payload.company && Object.keys(payload.company).sort().join(",") === "edinetCode,name" && typeof payload.company.edinetCode === "string" && typeof payload.company.name === "string", "company");
    requireValue(Array.isArray(payload.cells) && payload.cells.length <= 4096, "cells");
    requireValue(Array.isArray(payload.views) && payload.views.length >= 1 && payload.views.length <= 12, "views");
    validateStrings(payload);
    payload.cells.forEach(validateCell);
    const viewKeys = new Set();
    const filenames = new Set();
    payload.views.forEach((view) => {
      requireValue(view && Object.keys(view).sort().join(",") === "downloadFilename,label,scope,tables,viewKey", "view");
      requireValue(typeof view.viewKey === "string" && !viewKeys.has(view.viewKey), "view key");
      requireValue(typeof view.label === "string" && typeof view.downloadFilename === "string" && !filenames.has(view.downloadFilename), "view labels");
      viewKeys.add(view.viewKey);
      filenames.add(view.downloadFilename);
      requireValue(Array.isArray(view.scope) && view.scope.length === 3, "scope");
      requireValue(["all", "five-year"].includes(view.scope[0]) && ["all", "consolidated", "nonconsolidated"].includes(view.scope[1]) && ["all", "annual"].includes(view.scope[2]), "scope values");
      requireValue(Array.isArray(view.tables) && view.tables.length >= 1 && view.tables.length <= 2, "tables");
      view.tables.forEach((table) => validateTable(table, payload.cells, view.scope[2]));
      if (view.scope[1] === "all") {
        const consolidations = view.tables.map((table) => table.consolidated);
        requireValue(["true", "false", "true,false"].includes(consolidations.join(",")), "table order");
        if (view.tables.length === 2) {
          requireValue(JSON.stringify(view.tables[0].periodEnds) === JSON.stringify(view.tables[1].periodEnds), "cross-table periodEnds");
        }
      } else {
        requireValue(view.tables.length === 1 && view.tables[0].consolidated === (view.scope[1] === "consolidated"), "table scope");
      }
    });
    return payload;
  };

  const appendText = (parent, className, attributes, text) => {
    const node = element("text", { class: className, ...attributes }, text);
    parent.append(node);
    return node;
  };

  const valueY = (value, domain) => 20 + ((domain[2] - value) / (domain[2] - domain[1])) * 230;

  const appendStatementChart = (parent, statement, cell, domain) => {
    const chart = element("svg", {
      class: "statement-chart",
      x: 40,
      y: 64,
      width: 260,
      height: 292,
      viewBox: "0 0 260 292",
      role: "img",
      "aria-label": `${STATEMENT_NAMES[statement]} chart`,
    });
    chart.append(element("title", {}, `${STATEMENT_NAMES[statement]} chart`));
    const zeroY = valueY(0, domain);
    chart.append(element("line", { class: "zero-line", x1: 18, x2: 242, y1: zeroY.toFixed(2), y2: zeroY.toFixed(2) }));
    const stacks = cell[8];
    const count = stacks.length;
    const barWidth = count === 2 ? 46 : 38;
    stacks.forEach((stack, stackIndex) => {
      const center = (260 * (stackIndex + 1)) / (count + 1);
      if (stack === null) {
        appendText(chart, "missing-data", { x: center.toFixed(2), y: 140, "text-anchor": "middle" }, "該当データなし");
      } else {
        let positive = 0;
        let negative = 0;
        stack.forEach(([category, value, tooltip]) => {
          const start = value >= 0 ? positive : negative;
          const end = start + value;
          const attributes = {
            class: `${value === 0 ? "zero-marker" : "bar-segment"} ${category}`,
            "data-tooltip": tooltip,
            "data-value": value,
            "aria-label": tooltip,
          };
          let segment;
          if (value === 0) {
            segment = element("circle", { ...attributes, cx: center.toFixed(2), cy: valueY(0, domain).toFixed(2), r: 5 });
          } else {
            const startY = valueY(start, domain);
            const endY = valueY(end, domain);
            segment = element("rect", {
              ...attributes,
              x: (center - barWidth / 2).toFixed(2),
              y: Math.min(startY, endY).toFixed(2),
              width: barWidth.toFixed(2),
              height: Math.abs(endY - startY).toFixed(2),
            });
          }
          segment.append(element("title", {}, tooltip));
          chart.append(segment);
          if (value >= 0) positive = end;
          else negative = end;
        });
      }
      appendText(chart, "bar-label", { x: center.toFixed(2), y: 278, "text-anchor": "middle" }, BAR_LABELS[statement][stackIndex]);
    });
    parent.append(chart);
  };

  const appendLegend = (parent, statement) => {
    const legend = element("g", { class: "statement-legend", "aria-label": `${statement}の色分け凡例` });
    LEGENDS[statement].forEach(([label, category], index) => {
      const item = element("g", { class: "statement-legend-item", transform: `translate(${22 + (index % 2) * 108} ${132 + Math.floor(index / 2) * 22})` });
      item.append(element("rect", { class: `statement-legend-swatch ${category}`, width: 10, height: 10 }));
      appendText(item, "statement-legend-label", { x: 15, y: 9 }, label);
      legend.append(item);
    });
    parent.append(legend);
  };

  const buildOverviewSvg = (payload, view) => {
    const outerMargin = 36;
    const labelWidth = 246;
    const periodStride = 358;
    const headerHeight = 116;
    const tableHeadingHeight = 100;
    const rowHeight = 420;
    const tableHeight = tableHeadingHeight + rowHeight * 3;
    const maxPeriods = Math.max(...view.tables.map((table) => table.periodEnds.length));
    const width = Math.max(1400, outerMargin * 2 + labelWidth + maxPeriods * periodStride);
    const height = headerHeight + tableHeight * view.tables.length + 30;
    const [rangeScope, consolidationScope, disclosureScope] = view.scope;
    const rangeLabel = rangeScope === "five-year" ? "直近5年" : "全期間";
    const consolidationLabel = consolidationScope === "all" ? "全部" : consolidationScope === "consolidated" ? "連結" : "非連結";
    const disclosureLabel = disclosureScope === "annual" ? "通期のみ" : "四半期単位";
    const titleText = `${payload.company.name} ${disclosureScope === "annual" ? "通期" : ""}財務諸表全体図（${rangeLabel}・${consolidationLabel}・${disclosureLabel}）`;
    let description = `${rangeLabel}の${consolidationLabel}財務諸表を、期間列を揃えてPL、BS、CFを3行で配置した${disclosureLabel}の全体図`;
    if (disclosureScope === "all") description += "。ヘッダの縦線は通期列の右端を示す";
    const svg = element("svg", {
      xmlns: SVG_NS,
      width: "100vw",
      height: "100vh",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "xMidYMid meet",
      style: "display:block; overflow:hidden",
      role: "img",
      "data-range": rangeLabel,
      "data-consolidation-scope": consolidationScope,
      "data-disclosure-scope": disclosureLabel,
      "aria-labelledby": "overview-title overview-description",
    });
    svg.append(element("title", { id: "overview-title" }, titleText));
    svg.append(element("desc", { id: "overview-description" }, description));
    svg.append(element("style", {}, STYLE));
    svg.append(element("rect", { class: "page-background", width, height }));
    appendText(svg, "company-name", { x: 36, y: 48 }, payload.company.name);
    appendText(svg, "company-code", { x: 36, y: 76 }, payload.company.edinetCode);

    let tableY = headerHeight;
    view.tables.forEach((table) => {
      const consolidated = String(table.consolidated);
      const tableGroup = element("g", {
        class: "overview-table",
        "data-consolidated": consolidated,
        "data-column-count": table.periodEnds.length,
        transform: `translate(${outerMargin} ${tableY})`,
      });
      appendText(tableGroup, "table-heading", { x: 0, y: 32 }, table.consolidated ? "連結" : "非連結");
      table.periodEnds.forEach((periodEnd, columnIndex) => {
        const header = element("g", {
          class: "overview-column-header",
          "data-column-index": columnIndex,
          "data-period-end": periodEnd,
          transform: `translate(${labelWidth + columnIndex * periodStride} 0)`,
        });
        const date = new Date(`${periodEnd}T00:00:00Z`);
        appendText(header, "column-header-label", { x: 170, y: 76, "text-anchor": "middle" }, `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`);
        tableGroup.append(header);
      });
      table.annualMarkerColumnIndexes.forEach((columnIndex) => {
        const periodEnd = table.periodEnds[columnIndex];
        const markerX = labelWidth + (columnIndex + 1) * periodStride - 9;
        const marker = element("line", { class: "annual-period-header-marker", "data-period-end": periodEnd, x1: markerX, x2: markerX, y1: 42, y2: 94 });
        marker.append(element("title", {}, `${periodEnd} 通期`));
        tableGroup.append(marker);
      });
      table.rows.forEach(([statement, domains, references], rowIndex) => {
        const row = element("g", {
          class: "overview-row",
          "data-consolidated": consolidated,
          "data-statement-type": statement,
          "data-period-count": references.filter((reference) => reference !== null).length,
          "data-total-period-count": references.filter((reference) => reference !== null).length,
          transform: `translate(0 ${tableHeadingHeight + rowIndex * rowHeight})`,
        });
        appendText(row, "statement-label", { x: 22, y: 48 }, statement);
        appendText(row, "statement-name", { x: 22, y: 76 }, STATEMENT_NAMES[statement]);
        appendText(row, "period-count-label", { x: 22, y: 104 }, `全${references.filter((reference) => reference !== null).length}期`);
        appendLegend(row, statement);
        const domainByUnit = new Map(domains.map((domain) => [domain[0], domain]));
        references.forEach((reference, columnIndex) => {
          const periodX = labelWidth + columnIndex * periodStride;
          if (reference === null) {
            row.append(element("g", { class: "overview-empty-period", "data-column-index": columnIndex, "data-period-end": table.periodEnds[columnIndex], transform: `translate(${periodX} 6)` }));
            return;
          }
          const cell = payload.cells[reference];
          const period = element("g", {
            class: "overview-period",
            "data-column-index": columnIndex,
            "data-period-end": cell[6],
            "data-document-type": cell[1],
            "data-account-standard": cell[2],
            "data-source-doc-id": cell[4],
            "data-unit": cell[3],
            transform: `translate(${periodX} 6)`,
          });
          appendText(period, "period-meta", { x: 170, y: 22, "text-anchor": "middle" }, `${DOCUMENT_LABELS[cell[1]]} / ${cell[2]} / ${cell[3]}`);
          appendText(period, "period-label", { x: 170, y: 46, "text-anchor": "middle" }, cell[7]);
          appendStatementChart(period, statement, cell, domainByUnit.get(cell[3]));
          if (cell[9] !== null) {
            appendText(period, "chart-footer", { x: 170, y: 378, "text-anchor": "middle" }, cell[9]);
          }
          row.append(period);
        });
        tableGroup.append(row);
      });
      table.transitions.forEach(([columnIndex, fromStandard, toStandard]) => {
        const transitionX = labelWidth + columnIndex * periodStride - 9;
        const labelX = transitionX + 16;
        const transitionY2 = tableHeadingHeight + rowHeight * 2 + 400;
        const transition = element("g", { class: "accounting-standard-transition", "data-from-standard": fromStandard, "data-to-standard": toStandard });
        transition.append(element("line", { class: "accounting-standard-transition-line", x1: transitionX, x2: transitionX, y1: tableHeadingHeight, y2: transitionY2 }));
        appendText(transition, "accounting-standard-transition-label", { x: labelX, y: transitionY2 - 14, transform: `rotate(-90 ${labelX} ${transitionY2 - 14})` }, `${fromStandard} → ${toStandard}`);
        tableGroup.append(transition);
      });
      svg.append(tableGroup);
      tableY += tableHeight;
    });
    return svg;
  };

  const canonicalOverview = (payload, view) => {
    const svgElement = buildOverviewSvg(payload, view);
    const canonicalMarkup = new XMLSerializer().serializeToString(svgElement);
    return { svgElement, canonicalMarkup };
  };

  const statementCellModel = (cell) => {
    if (cell === null) {
      return null;
    }
    const details = [];
    cell[8].forEach((stack) => {
      if (stack === null) return;
      stack.forEach((segment) => {
        segment[2].split("\n").forEach((line) => {
          if (line && !details.includes(line)) details.push(line);
        });
      });
    });
    return {
      docId: cell[4],
      documentType: DOCUMENT_LABELS[cell[1]],
      meta: `${DOCUMENT_LABELS[cell[1]]} / ${cell[2]} / ${cell[3]}`,
      periodLabel: cell[7],
      details,
      footer: cell[9],
    };
  };

  const sourceDocumentsForTables = (tables) => {
    const documents = new Map();
    tables.forEach((table) => {
      table.rows.forEach((row) => {
        row.statements.forEach((statement) => {
          if (statement === null || statement.docId.length === 0) return;
          let document = documents.get(statement.docId);
          if (!document) {
            document = {
              docId: statement.docId,
              periodEnd: row.periodEnd,
              documentTypes: new Set(),
            };
            documents.set(statement.docId, document);
          }
          if (row.periodEnd > document.periodEnd) document.periodEnd = row.periodEnd;
          document.documentTypes.add(statement.documentType);
        });
      });
    });
    const documentTypeOrder = ["通期", "半期", "四半期"];
    return Array.from(documents.values())
      .map((document) => ({
        docId: document.docId,
        periodEnd: document.periodEnd,
        documentTypes: documentTypeOrder.filter((type) => document.documentTypes.has(type)),
      }))
      .sort((left, right) => (
        right.periodEnd.localeCompare(left.periodEnd) || left.docId.localeCompare(right.docId)
      ));
  };

  const overviewTableModel = (payload, view) => {
    const tables = view.tables.map((table) => {
      const referencesByStatement = new Map(
        table.rows.map(([statement, _domains, references]) => [statement, references]),
      );
      return {
        label: table.consolidated ? "連結" : "非連結",
        rows: table.periodEnds.map((periodEnd, columnIndex) => ({
          periodEnd,
          statements: STATEMENTS.map((statement) => {
            const reference = referencesByStatement.get(statement)[columnIndex];
            return statementCellModel(reference === null ? null : payload.cells[reference]);
          }),
        })),
      };
    });
    return {
      companyName: payload.company.name,
      edinetCode: payload.company.edinetCode,
      viewLabel: view.label,
      tables,
      sourceDocuments: sourceDocumentsForTables(tables),
    };
  };

  const markdownCell = (cell) => {
    if (cell === null) return "—";
    const parts = [cell.meta, cell.periodLabel, ...cell.details];
    if (cell.footer !== null) parts.push(cell.footer);
    return parts
      .map((part) => part.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "<br>"))
      .join("<br>");
  };

  const overviewTableMarkdown = (model) => {
    const headingName = model.companyName.replaceAll("\n", " ");
    const lines = [
      `# ${headingName}（${model.edinetCode}）財務諸表`,
      "",
      `表示範囲: ${model.viewLabel.replaceAll("\n", " ")}`,
      "",
    ];
    model.tables.forEach((table) => {
      lines.push(`## ${table.label}`, "", "| 期末 | PL | BS | CF |", "| --- | --- | --- | --- |");
      table.rows.forEach((row) => {
        lines.push(`| ${row.periodEnd} | ${row.statements.map(markdownCell).join(" | ")} |`);
      });
      lines.push("");
    });
    return `${lines.join("\n").trimEnd()}\n`;
  };

  window.CompanyChartRenderer = {
    validatePayload,
    canonicalOverview,
    overviewTableModel,
    overviewTableMarkdown,
  };
})();
