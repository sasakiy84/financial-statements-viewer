(() => {
  "use strict";

  const pageSize = 50;
  const searchForm = document.querySelector("#company-search-form");
  const searchInput = document.querySelector("#company-search");
  const sortSelect = document.querySelector("#company-sort");
  const companyList = document.querySelector("#company-list");
  const hitCounts = Array.from(document.querySelectorAll(".hit-count"));
  const pageStatuses = Array.from(document.querySelectorAll(".page-status"));
  const previousButtons = Array.from(
    document.querySelectorAll('[data-page-direction="previous"]'),
  );
  const nextButtons = Array.from(document.querySelectorAll('[data-page-direction="next"]'));
  const emptyResults = document.querySelector("#empty-results");
  const dataStatus = document.querySelector("#data-status");
  let companies = null;
  let companyOrder = null;

  if (!(searchForm instanceof HTMLFormElement)
      || !(searchInput instanceof HTMLInputElement)
      || !(sortSelect instanceof HTMLSelectElement)
      || !(companyList instanceof HTMLElement)
      || hitCounts.length !== 2
      || pageStatuses.length !== 2
      || previousButtons.length !== 2
      || nextButtons.length !== 2
      || !(emptyResults instanceof HTMLElement)
      || !(dataStatus instanceof HTMLElement)) {
    return;
  }

  document.body.classList.add("js-enhanced");

  const normalizeSearch = (value) => value.normalize("NFKC").toLowerCase().trim();
  const defaultSort = "sales-desc";
  const sortKeys = new Set([
    "name",
    "assets-desc",
    "assets-asc",
    "sales-desc",
    "sales-asc",
    "fcf-desc",
    "fcf-asc",
  ]);
  const sortDefinitions = {
    "assets-desc": { metricIndex: 0, direction: "desc" },
    "assets-asc": { metricIndex: 0, direction: "asc" },
    "sales-desc": { metricIndex: 1, direction: "desc" },
    "sales-asc": { metricIndex: 1, direction: "asc" },
    "fcf-desc": { metricIndex: 2, direction: "desc" },
    "fcf-asc": { metricIndex: 2, direction: "asc" },
  };

  const svgNamespace = "http://www.w3.org/2000/svg";
  const plotTop = 20;
  const plotBottom = 250;
  const chartDefinitions = {
    PL: { title: "最新通期PLグラフ", labels: ["費用・営業利益", "売上高"] },
    BS: { title: "最新通期BSグラフ", labels: ["資産", "負債・純資産"] },
    CF: { title: "最新通期CFグラフ", labels: ["営業", "投資", "財務", "FCF"] },
  };
  const chartCategories = new Set([
    "expenses", "operating-income", "net-sales", "assets", "current-assets",
    "noncurrent-assets", "other-assets", "liabilities", "net-assets", "operating",
    "investing", "financing", "free-cash-flow",
  ]);

  const svgElement = (name, attributes = {}) => {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  };

  const parsedChart = (metric) => {
    if (!Array.isArray(metric) || metric.length !== 5) {
      return null;
    }
    const [label, formattedValue, domainMin, domainMax, rawStacks] = metric;
    if (typeof label !== "string"
        || (typeof formattedValue !== "string" && formattedValue !== null)
        || !Number.isFinite(domainMin)
        || !Number.isFinite(domainMax)
        || domainMin >= domainMax
        || !Array.isArray(rawStacks)) {
      return null;
    }
    const stacks = [];
    for (const rawStack of rawStacks) {
      if (rawStack === null) {
        stacks.push(null);
        continue;
      }
      if (!Array.isArray(rawStack)) {
        return null;
      }
      const stack = [];
      for (const rawSegment of rawStack) {
        if (!Array.isArray(rawSegment)
            || rawSegment.length !== 2
            || !chartCategories.has(rawSegment[0])
            || !Number.isFinite(rawSegment[1])) {
          return null;
        }
        stack.push({ category: rawSegment[0], value: rawSegment[1] });
      }
      stacks.push(stack);
    }
    return { label, formattedValue, domainMin, domainMax, stacks };
  };

  const createSummaryChart = (statementType, metric) => {
    const chart = parsedChart(metric);
    const definition = chartDefinitions[statementType];
    if (!chart || !definition || chart.stacks.length !== definition.labels.length) {
      return null;
    }
    const valueY = (value) => (
      plotTop + (chart.domainMax - value) / (chart.domainMax - chart.domainMin)
        * (plotBottom - plotTop)
    );
    const svg = svgElement("svg", {
      class: "statement-chart annual-summary-chart",
      viewBox: "0 0 260 292",
      role: "img",
      "aria-label": `${definition.title}、主要金額 ${chart.formattedValue || "データなし"}`,
    });
    const title = svgElement("title");
    title.textContent = `${definition.title}、主要金額 ${chart.formattedValue || "データなし"}`;
    svg.append(title, svgElement("line", {
      class: "zero-line",
      x1: 18,
      x2: 242,
      y1: valueY(0).toFixed(2),
      y2: valueY(0).toFixed(2),
    }));
    const count = chart.stacks.length;
    const barWidth = count === 2 ? 46 : 38;
    chart.stacks.forEach((stack, index) => {
      const center = 260 * (index + 1) / (count + 1);
      if (stack === null) {
        const missing = svgElement("text", {
          class: "missing-data",
          x: center.toFixed(2),
          y: 140,
          "text-anchor": "middle",
        });
        missing.textContent = "データなし";
        svg.append(missing);
      } else {
        let positive = 0;
        let negative = 0;
        stack.forEach((segment) => {
          const start = segment.value >= 0 ? positive : negative;
          const end = start + segment.value;
          if (segment.value >= 0) positive = end;
          else negative = end;
          if (segment.value === 0) {
            svg.append(svgElement("circle", {
              class: `zero-marker ${segment.category}`,
              cx: center.toFixed(2),
              cy: valueY(0).toFixed(2),
              r: 5,
            }));
            return;
          }
          const yStart = valueY(start);
          const yEnd = valueY(end);
          svg.append(svgElement("rect", {
            class: `bar-segment ${segment.category}`,
            x: (center - barWidth / 2).toFixed(2),
            y: Math.min(yStart, yEnd).toFixed(2),
            width: barWidth.toFixed(2),
            height: Math.abs(yEnd - yStart).toFixed(2),
          }));
        });
      }
      const label = svgElement("text", {
        class: "bar-label",
        x: center.toFixed(2),
        y: 278,
        "text-anchor": "middle",
      });
      label.textContent = definition.labels[index];
      svg.append(label);
    });
    return svg;
  };

  const requestedState = () => {
    const url = new URL(window.location.href);
    const q = (url.searchParams.get("q") || "").trim();
    const rawPage = url.searchParams.get("page") || "";
    const parsedPage = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
    const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    const requestedSort = url.searchParams.get("sort") || defaultSort;
    const sort = sortKeys.has(requestedSort) ? requestedSort : defaultSort;
    return { q, page, sort };
  };

  const parsedSortValue = (company, metricIndex) => {
    const rawValues = company?.s?.o;
    if (!Array.isArray(rawValues) || rawValues.length !== 3) return null;
    const rawValue = rawValues[metricIndex];
    if (!Array.isArray(rawValue)
        || rawValue.length !== 2
        || !Number.isFinite(rawValue[0])
        || typeof rawValue[1] !== "string"
        || rawValue[1].length === 0) {
      return null;
    }
    return { value: Object.is(rawValue[0], -0) ? 0 : rawValue[0], unit: rawValue[1] };
  };

  const sortedCompanies = (matches, sort) => {
    const definition = sortDefinitions[sort];
    if (!definition || !(companyOrder instanceof Map)) return matches;
    return [...matches].sort((left, right) => {
      const leftValue = parsedSortValue(left, definition.metricIndex);
      const rightValue = parsedSortValue(right, definition.metricIndex);
      const leftIsComparable = leftValue?.unit === "JPY";
      const rightIsComparable = rightValue?.unit === "JPY";
      if (leftIsComparable !== rightIsComparable) return leftIsComparable ? -1 : 1;
      if (leftIsComparable && rightIsComparable && leftValue.value !== rightValue.value) {
        const ascending = leftValue.value < rightValue.value ? -1 : 1;
        return definition.direction === "asc" ? ascending : -ascending;
      }
      return companyOrder.get(left) - companyOrder.get(right);
    });
  };

  const matchingCompanies = (q) => {
    const normalizedQuery = normalizeSearch(q);
    if (!Array.isArray(companies)) {
      return [];
    }
    return companies.filter((company) => {
      const searchText = `${company.n || ""} ${company.c || ""}`;
      return normalizeSearch(searchText).includes(normalizedQuery);
    });
  };

  const canonicalState = () => {
    const requested = requestedState();
    const matches = sortedCompanies(matchingCompanies(requested.q), requested.sort);
    const totalPages = Math.ceil(matches.length / pageSize);
    const page = totalPages === 0 ? 1 : Math.min(requested.page, totalPages);
    const url = new URL(window.location.href);
    url.search = "";
    if (requested.q) {
      url.searchParams.set("q", requested.q);
    }
    if (requested.sort !== defaultSort) {
      url.searchParams.set("sort", requested.sort);
    }
    url.searchParams.set("page", String(page));
    if (url.href !== window.location.href) {
      window.history.replaceState(null, "", url);
    }
    return { q: requested.q, page, sort: requested.sort, matches, totalPages };
  };

  const appendMetric = (summaryList, label, metric) => {
    const wrapper = document.createElement("div");
    wrapper.className = "summary-metric";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    if (Array.isArray(metric)) {
      const chart = createSummaryChart(label, metric);
      if (chart) {
        const chartWrapper = document.createElement("div");
        chartWrapper.className = "summary-chart";
        chartWrapper.append(chart);
        description.append(chartWrapper);
      }
      if (typeof metric[1] === "string") {
        const value = document.createElement("span");
        value.className = "metric-value";
        value.textContent = metric[1];
        const metricLabel = document.createElement("span");
        metricLabel.className = "metric-label";
        metricLabel.textContent = metric[0];
        description.append(value, metricLabel);
      } else {
        const missing = document.createElement("span");
        missing.className = "metric-missing";
        missing.textContent = `${metric[0]}: データなし`;
        description.append(missing);
      }
    } else {
      const missing = document.createElement("span");
      missing.className = "metric-missing";
      missing.textContent = "データなし";
      description.append(missing);
    }
    wrapper.append(term, description);
    summaryList.append(wrapper);
  };

  const formatPeriodEnd = (value) => {
    const [year, month, day] = String(value).split("-").map(Number);
    return `${year}年${month}月${day}日`;
  };

  const createCompanyRow = (company) => {
    const row = document.createElement("article");
    row.className = "company-row";
    const identity = document.createElement("div");
    identity.className = "company-identity";
    const heading = document.createElement("h2");
    const link = document.createElement("a");
    link.className = "company-link";
    link.href = `company/${encodeURIComponent(company.c)}/index.html`;
    link.textContent = company.n;
    const code = document.createElement("span");
    code.className = "edinet-code";
    code.textContent = company.c;
    heading.append(link);
    identity.append(heading, code);
    row.append(identity);

    const summary = company.s;
    if (!summary) {
      const missing = document.createElement("p");
      missing.className = "annual-summary-missing";
      missing.textContent = "通期データなし";
      row.append(missing);
      return row;
    }

    const context = document.createElement("div");
    context.className = "summary-context";
    [
      formatPeriodEnd(summary.p),
      summary.k ? "連結" : "非連結",
      summary.a,
    ].forEach((text) => {
      const item = document.createElement("span");
      item.textContent = text;
      context.append(item);
    });
    const summaryList = document.createElement("dl");
    summaryList.className = "company-summary";
    appendMetric(summaryList, "PL", summary.pl);
    appendMetric(summaryList, "BS", summary.bs);
    appendMetric(summaryList, "CF", summary.cf);
    row.append(context, summaryList);
    return row;
  };

  const renderFromUrl = () => {
    if (!Array.isArray(companies)) {
      return;
    }
    const state = canonicalState();
    searchInput.value = state.q;
    sortSelect.value = state.sort;
    const start = (state.page - 1) * pageSize;
    companyList.replaceChildren(
      ...state.matches.slice(start, start + pageSize).map(createCompanyRow),
    );
    hitCounts.forEach((hitCount) => { hitCount.textContent = `${state.matches.length}件`; });
    pageStatuses.forEach((pageStatus) => {
      pageStatus.textContent = state.totalPages === 0
        ? "0 / 0"
        : `${state.page} / ${state.totalPages}`;
    });
    previousButtons.forEach((button) => {
      button.disabled = state.totalPages === 0 || state.page === 1;
    });
    nextButtons.forEach((button) => {
      button.disabled = state.totalPages === 0 || state.page === state.totalPages;
    });
    emptyResults.hidden = state.matches.length !== 0;
  };

  const updateUrl = ({ q, page, sort }, mode) => {
    const url = new URL(window.location.href);
    const trimmedQuery = q.trim();
    const normalizedSort = sortKeys.has(sort) ? sort : "name";
    url.search = "";
    if (trimmedQuery) {
      url.searchParams.set("q", trimmedQuery);
    }
    if (normalizedSort !== defaultSort) {
      url.searchParams.set("sort", normalizedSort);
    }
    url.searchParams.set("page", String(page));
    window.history[mode](null, "", url);
    renderFromUrl();
  };

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    updateUrl({ q: searchInput.value, page: 1, sort: requestedState().sort }, "pushState");
  });
  searchInput.addEventListener("input", () => {
    updateUrl({ q: searchInput.value, page: 1, sort: requestedState().sort }, "replaceState");
  });
  sortSelect.addEventListener("change", () => {
    updateUrl({ q: searchInput.value, page: 1, sort: sortSelect.value }, "pushState");
  });
  previousButtons.forEach((button) => button.addEventListener("click", () => {
    const state = canonicalState();
    updateUrl({ q: state.q, page: Math.max(1, state.page - 1), sort: state.sort }, "pushState");
  }));
  nextButtons.forEach((button) => button.addEventListener("click", () => {
    const state = canonicalState();
    updateUrl({ q: state.q, page: state.page + 1, sort: state.sort }, "pushState");
    window.scrollTo(0, 0);
  }));
  window.addEventListener("popstate", renderFromUrl);

  const initialState = requestedState();
  searchInput.value = initialState.q;
  fetch(new URL("assets/companies.json", document.baseURI))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      if (!Array.isArray(payload)) {
        throw new TypeError("企業データの形式が不正です");
      }
      companies = payload;
      companyOrder = new Map(companies.map((company, index) => [company, index]));
      sortSelect.disabled = false;
      dataStatus.hidden = true;
      renderFromUrl();
    })
    .catch(() => {
      dataStatus.textContent = "企業データを読み込めませんでした。先頭50社を表示しています。";
      dataStatus.hidden = false;
    });
})();
