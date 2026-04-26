const CATEGORY_FILTERS = [
  { id: "all", label: "全部", keywords: [] },
  {
    id: "portrait",
    label: "个人资料 / 头像",
    keywords: ["头像", "个人资料", "肖像", "人像", "自拍", "角色", "portrait", "profile", "avatar", "headshot"]
  },
  {
    id: "social",
    label: "社交媒体帖子",
    keywords: ["社交", "帖子", "小红书", "instagram", "tiktok", "facebook", "推文", "卡片", "post", "feed"]
  },
  {
    id: "infographic",
    label: "信息图 / 教育视觉图",
    keywords: ["信息图", "教育", "图表", "地图", "流程", "说明", "教程", "infographic", "diagram", "chart", "map"]
  },
  {
    id: "youtube",
    label: "YouTube 缩略图",
    keywords: ["youtube", "缩略图", "封面", "thumbnail", "视频封面"]
  },
  {
    id: "comic",
    label: "漫画 / 故事板",
    keywords: ["漫画", "故事板", "分镜", "四格", "comic", "storyboard", "manga", "panel"]
  },
  {
    id: "poster",
    label: "海报 / 传单",
    keywords: ["海报", "传单", "广告", "专利", "poster", "flyer", "banner", "campaign"]
  },
  {
    id: "ui",
    label: "App / 网页设计",
    keywords: ["app", "网页", "网站", "界面", "ui", "saas", "dashboard", "landing", "电商", "应用"]
  }
];

const state = {
  prompts: [],
  filtered: [],
  activeCategory: "all",
  query: "",
  sort: "featured",
  featuredOnly: false,
  referenceOnly: false,
  activePrompt: null,
  activeModalPrompt: null,
  modalMode: "translated",
  argumentValues: {}
};

const elements = {
  total: document.querySelector("#stat-total"),
  local: document.querySelector("#stat-local"),
  featured: document.querySelector("#stat-featured"),
  updated: document.querySelector("#stat-updated"),
  heroImage: document.querySelector("#hero-image"),
  heroTitle: document.querySelector("#hero-title"),
  heroDescription: document.querySelector("#hero-description"),
  heroRandom: document.querySelector("#hero-random"),
  workbenchRandom: document.querySelector("#workbench-random"),
  copyWorkbench: document.querySelector("#copy-workbench"),
  workbenchImage: document.querySelector("#workbench-image"),
  workbenchSourceTag: document.querySelector("#workbench-source-tag"),
  workbenchTitle: document.querySelector("#workbench-title"),
  workbenchSummary: document.querySelector("#workbench-summary"),
  argumentFields: document.querySelector("#argument-fields"),
  promptVersion: document.querySelector("#prompt-version"),
  workbenchOutputText: document.querySelector("#workbench-output-text"),
  search: document.querySelector("#search-input"),
  sortSelect: document.querySelector("#sort-select"),
  toggleFeatured: document.querySelector("#toggle-featured"),
  toggleReference: document.querySelector("#toggle-reference"),
  clearFilters: document.querySelector("#clear-filters"),
  categoryStrip: document.querySelector("#category-strip"),
  resultCount: document.querySelector("#result-count"),
  cards: document.querySelector("#cards"),
  empty: document.querySelector("#empty-state"),
  modal: document.querySelector("#detail-modal"),
  closeModal: document.querySelector("#close-modal"),
  modalImageStage: document.querySelector("#modal-image-stage"),
  modalThumbs: document.querySelector("#modal-thumbs"),
  modalFeatured: document.querySelector("#modal-featured"),
  modalAuthor: document.querySelector("#modal-author"),
  modalDate: document.querySelector("#modal-date"),
  modalTitle: document.querySelector("#modal-title"),
  modalDescription: document.querySelector("#modal-description"),
  modalTags: document.querySelector("#modal-tags"),
  modalUseWorkbench: document.querySelector("#modal-use-workbench"),
  modalCopy: document.querySelector("#modal-copy"),
  modalYoumind: document.querySelector("#modal-youmind"),
  modalSource: document.querySelector("#modal-source"),
  tabTranslated: document.querySelector("#tab-translated"),
  tabOriginal: document.querySelector("#tab-original"),
  modalPrompt: document.querySelector("#modal-prompt")
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatDate(isoString, compact = false) {
  if (!isoString) return "Unknown";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat("zh-CN", {
    year: compact ? "2-digit" : "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function truncate(value, length = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function getPromptText(prompt, mode = "translated") {
  if (!prompt) return "";
  return mode === "original"
    ? prompt.prompt || prompt.translatedPrompt || ""
    : prompt.translatedPrompt || prompt.prompt || "";
}

function getSearchText(prompt) {
  return [
    prompt.id,
    prompt.title,
    prompt.description,
    prompt.authorName,
    prompt.language,
    prompt.sourcePlatform,
    ...(prompt.categories || []),
    prompt.prompt,
    prompt.translatedPrompt
  ]
    .join("\n")
    .toLowerCase();
}

function getCategoryIds(prompt) {
  const searchText = getSearchText(prompt);
  const matches = CATEGORY_FILTERS.filter((category) => {
    if (category.id === "all") return false;
    return category.keywords.some((keyword) => searchText.includes(keyword.toLowerCase()));
  }).map((category) => category.id);

  return matches.length ? matches : ["poster"];
}

function getCategoryLabels(prompt) {
  const ids = getCategoryIds(prompt);
  return ids
    .map((id) => CATEGORY_FILTERS.find((category) => category.id === id)?.label)
    .filter(Boolean);
}

function getPreviewImage(prompt) {
  return prompt?.thumbnailUrl || prompt?.mediaThumbnails?.[0] || prompt?.media?.[0] || "";
}

function getImages(prompt) {
  const images = prompt?.media?.length ? prompt.media : prompt?.mediaThumbnails || [];
  return images.filter(Boolean);
}

function extractArguments(text) {
  const args = [];
  const seen = new Set();
  const patterns = [
    /\{argument name="([^"]+)" default="([^"]*)"\}/g,
    /\{argument name=\\?"([^"\\]+)\\?" default=\\?"([^"\\]*)\\?"\}/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (seen.has(key)) continue;
      seen.add(key);
      args.push({ key, defaultValue: match[2] || "" });
    }
  }

  return args;
}

function replaceArguments(text) {
  return text.replace(/\{argument name=(?:\\?")([^"\\]+)(?:\\?") default=(?:\\?")([^"\\]*)(?:\\?")\}/g, (_, key, fallback) => {
    const value = state.argumentValues[key];
    return value === undefined || value === "" ? fallback : value;
  });
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Use textarea fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function showTemporaryLabel(button, label = "已复制") {
  const original = button.dataset.label || button.textContent || "";
  button.dataset.label = original;
  button.textContent = label;
  window.clearTimeout(button._labelTimer);
  button._labelTimer = window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function pickRandomPrompt(pool = state.filtered.length ? state.filtered : state.prompts) {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderCategories() {
  elements.categoryStrip.innerHTML = "";
  for (const category of CATEGORY_FILTERS) {
    const count =
      category.id === "all"
        ? state.prompts.length
        : state.prompts.filter((prompt) => getCategoryIds(prompt).includes(category.id)).length;
    const button = document.createElement("button");
    button.className = `category-button ${state.activeCategory === category.id ? "active" : ""}`;
    button.type = "button";
    button.textContent = `${category.label} ${count}`;
    button.addEventListener("click", () => {
      state.activeCategory = category.id;
      renderCategories();
      applyFilters();
    });
    elements.categoryStrip.appendChild(button);
  }
}

function sortPrompts(prompts) {
  return prompts.slice().sort((left, right) => {
    if (state.sort === "newest") {
      return Date.parse(right.sourcePublishedAt || "") - Date.parse(left.sourcePublishedAt || "");
    }
    if (state.sort === "images") {
      return getImages(right).length - getImages(left).length;
    }
    if (state.sort === "longest") {
      return getPromptText(right).length - getPromptText(left).length;
    }

    const featuredDelta = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
    if (featuredDelta !== 0) return featuredDelta;
    return Date.parse(right.sourcePublishedAt || "") - Date.parse(left.sourcePublishedAt || "");
  });
}

function applyFilters() {
  const tokens = state.query
    .trim()
    .toLowerCase()
    .split(/[\s,，;；、]+/)
    .filter(Boolean);

  const filtered = state.prompts.filter((prompt) => {
    if (state.activeCategory !== "all" && !getCategoryIds(prompt).includes(state.activeCategory)) {
      return false;
    }

    if (state.featuredOnly && !prompt.featured) {
      return false;
    }

    if (state.referenceOnly && !prompt.needReferenceImages && !prompt.referenceImages?.length) {
      return false;
    }

    if (!tokens.length) {
      return true;
    }

    const searchText = getSearchText(prompt);
    return tokens.every((token) => searchText.includes(token));
  });

  state.filtered = sortPrompts(filtered);
  renderCards();
}

function renderStats(payload) {
  const featuredCount = state.prompts.filter((prompt) => prompt.featured).length;
  elements.total.textContent = formatNumber(payload.total || state.prompts.length);
  elements.local.textContent = formatNumber(state.prompts.length);
  elements.featured.textContent = formatNumber(featuredCount);
  elements.updated.textContent = formatDate(payload.generatedAt, true);
}

function setHeroPrompt(prompt) {
  if (!prompt) return;
  elements.heroTitle.textContent = prompt.title || "Untitled";
  elements.heroDescription.textContent = truncate(prompt.description || getPromptText(prompt), 110);
  const image = getPreviewImage(prompt);
  elements.heroImage.src = image;
  elements.heroImage.alt = prompt.title || "";
}

function selectWorkbenchPrompt(prompt) {
  if (!prompt) return;
  state.activePrompt = prompt;
  state.argumentValues = {};

  const image = getPreviewImage(prompt);
  elements.workbenchImage.src = image;
  elements.workbenchImage.alt = prompt.title || "";
  elements.workbenchSourceTag.textContent = prompt.featured ? "精选提示词" : `#${prompt.id}`;
  elements.workbenchTitle.textContent = prompt.title || "Untitled";
  elements.workbenchSummary.textContent = truncate(prompt.description || getPromptText(prompt), 150);

  renderArgumentFields();
  updateWorkbenchOutput();
  setHeroPrompt(prompt);
}

function renderArgumentFields() {
  elements.argumentFields.innerHTML = "";
  const args = extractArguments(getPromptText(state.activePrompt, elements.promptVersion.value));

  for (const arg of args) {
    state.argumentValues[arg.key] = arg.defaultValue;
    const label = document.createElement("label");
    label.className = "text-field";
    label.innerHTML = `
      <span>${escapeHtml(arg.key)}</span>
      <input type="text" value="${escapeHtml(arg.defaultValue)}" data-arg="${escapeHtml(arg.key)}" />
    `;
    label.querySelector("input").addEventListener("input", (event) => {
      state.argumentValues[event.currentTarget.dataset.arg] = event.currentTarget.value;
      updateWorkbenchOutput();
    });
    elements.argumentFields.appendChild(label);
  }
}

function updateWorkbenchOutput() {
  if (!state.activePrompt) {
    elements.workbenchOutputText.textContent = "选择一个提示词后，这里会显示可直接复制的最终输出。";
    return;
  }

  const source = getPromptText(state.activePrompt, elements.promptVersion.value);
  elements.workbenchOutputText.textContent = replaceArguments(source);
}

function renderCards() {
  elements.cards.innerHTML = "";
  elements.resultCount.textContent = `${formatNumber(state.filtered.length)} / ${formatNumber(state.prompts.length)}`;

  if (!state.filtered.length) {
    elements.empty.classList.remove("hidden");
    return;
  }

  elements.empty.classList.add("hidden");
  const fragment = document.createDocumentFragment();

  for (const prompt of state.filtered) {
    const article = document.createElement("article");
    article.className = "prompt-card";
    const image = getPreviewImage(prompt);
    const promptText = getPromptText(prompt);
    const tags = getCategoryLabels(prompt).slice(0, 3);

    article.innerHTML = `
      <div class="card-thumb">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(prompt.title)}" loading="lazy" />`
            : `<div class="modal-placeholder">No preview</div>`
        }
        ${prompt.featured ? `<span class="pill accent badge">精选</span>` : ""}
      </div>
      <div class="card-body">
        <p class="card-meta">${escapeHtml(prompt.authorName || "Unknown")} · ${escapeHtml(formatDate(prompt.sourcePublishedAt))}</p>
        <h3>${escapeHtml(prompt.title || "Untitled")}</h3>
        <p>${escapeHtml(truncate(prompt.description || promptText, 124))}</p>
        <div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
      <pre class="card-prompt">${escapeHtml(truncate(promptText, 260))}</pre>
      <div class="card-actions">
        <button class="button ghost" type="button" data-action="open">查看</button>
        <button class="button secondary" type="button" data-action="workbench">工作台</button>
        <button class="button primary" type="button" data-action="copy">复制</button>
      </div>
    `;

    article.querySelector('[data-action="open"]').addEventListener("click", () => openModal(prompt.id));
    article.querySelector('[data-action="workbench"]').addEventListener("click", (event) => {
      selectWorkbenchPrompt(prompt);
      showTemporaryLabel(event.currentTarget, "已加入");
    });
    article.querySelector('[data-action="copy"]').addEventListener("click", async (event) => {
      await writeClipboardText(getPromptText(prompt));
      showTemporaryLabel(event.currentTarget);
    });

    fragment.appendChild(article);
  }

  elements.cards.appendChild(fragment);
}

function renderModalMedia(prompt, activeIndex = 0) {
  const images = getImages(prompt);
  elements.modalImageStage.innerHTML = "";
  elements.modalThumbs.innerHTML = "";

  if (!images.length) {
    elements.modalImageStage.innerHTML = `<div class="modal-placeholder">No preview</div>`;
    return;
  }

  const image = document.createElement("img");
  image.src = images[activeIndex] || images[0];
  image.alt = prompt.title || "";
  elements.modalImageStage.appendChild(image);

  if (images.length <= 1) return;

  images.slice(0, 8).forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === activeIndex ? "active" : "";
    button.innerHTML = `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`;
    button.addEventListener("click", () => renderModalMedia(prompt, index));
    elements.modalThumbs.appendChild(button);
  });
}

function renderModalPrompt() {
  elements.modalPrompt.textContent = getPromptText(state.activeModalPrompt, state.modalMode);
  elements.tabTranslated.classList.toggle("active", state.modalMode === "translated");
  elements.tabOriginal.classList.toggle("active", state.modalMode === "original");
}

function openModal(promptId) {
  const prompt = state.prompts.find((item) => String(item.id) === String(promptId));
  if (!prompt) return;

  state.activeModalPrompt = prompt;
  state.modalMode = prompt.translatedPrompt ? "translated" : "original";
  renderModalMedia(prompt);
  elements.modalFeatured.classList.toggle("hidden", !prompt.featured);
  elements.modalAuthor.textContent = prompt.authorName || "Unknown";
  elements.modalDate.textContent = formatDate(prompt.sourcePublishedAt);
  elements.modalTitle.textContent = prompt.title || "Untitled";
  elements.modalDescription.textContent = prompt.description || "";
  elements.modalTags.innerHTML = getCategoryLabels(prompt)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  elements.modalYoumind.href = prompt.detailUrl || "https://youmind.com/zh-CN/nano-banana-pro-prompts";
  elements.modalSource.href = prompt.sourceLink || prompt.detailUrl || "#";
  elements.modalSource.classList.toggle("hidden", !prompt.sourceLink);
  renderModalPrompt();

  if (!elements.modal.open) {
    elements.modal.showModal();
  }
}

function closeModal() {
  elements.modal.close();
}

function bindEvents() {
  elements.heroRandom.addEventListener("click", () => {
    const prompt = pickRandomPrompt(state.prompts);
    selectWorkbenchPrompt(prompt);
    document.querySelector("#workbench").scrollIntoView({ block: "start" });
  });

  elements.workbenchRandom.addEventListener("click", () => {
    selectWorkbenchPrompt(pickRandomPrompt());
  });

  elements.copyWorkbench.addEventListener("click", async () => {
    await writeClipboardText(elements.workbenchOutputText.textContent || "");
    showTemporaryLabel(elements.copyWorkbench);
  });

  elements.promptVersion.addEventListener("change", () => {
    renderArgumentFields();
    updateWorkbenchOutput();
  });

  elements.search.addEventListener("input", (event) => {
    state.query = event.currentTarget.value;
    applyFilters();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.currentTarget.value;
    applyFilters();
  });

  elements.toggleFeatured.addEventListener("click", () => {
    state.featuredOnly = !state.featuredOnly;
    elements.toggleFeatured.classList.toggle("active", state.featuredOnly);
    applyFilters();
  });

  elements.toggleReference.addEventListener("click", () => {
    state.referenceOnly = !state.referenceOnly;
    elements.toggleReference.classList.toggle("active", state.referenceOnly);
    applyFilters();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.query = "";
    state.activeCategory = "all";
    state.featuredOnly = false;
    state.referenceOnly = false;
    state.sort = "featured";
    elements.search.value = "";
    elements.sortSelect.value = "featured";
    elements.toggleFeatured.classList.remove("active");
    elements.toggleReference.classList.remove("active");
    renderCategories();
    applyFilters();
  });

  elements.closeModal.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeModal();
  });

  elements.tabTranslated.addEventListener("click", () => {
    state.modalMode = "translated";
    renderModalPrompt();
  });

  elements.tabOriginal.addEventListener("click", () => {
    state.modalMode = "original";
    renderModalPrompt();
  });

  elements.modalCopy.addEventListener("click", async () => {
    await writeClipboardText(elements.modalPrompt.textContent || "");
    showTemporaryLabel(elements.modalCopy);
  });

  elements.modalUseWorkbench.addEventListener("click", () => {
    selectWorkbenchPrompt(state.activeModalPrompt);
    closeModal();
    document.querySelector("#workbench").scrollIntoView({ block: "start" });
  });
}

async function init() {
  bindEvents();

  const response = await fetch("./data/prompts.json");
  if (!response.ok) throw new Error(`Failed to load prompts: ${response.status}`);
  const payload = await response.json();

  state.prompts = payload.prompts || [];
  state.filtered = sortPrompts(state.prompts);

  renderStats(payload);
  renderCategories();
  applyFilters();

  const firstFeatured = state.prompts.find((prompt) => prompt.featured) || state.prompts[0];
  setHeroPrompt(firstFeatured);
  selectWorkbenchPrompt(firstFeatured);
}

init().catch((error) => {
  console.error(error);
  elements.resultCount.textContent = "加载失败";
  elements.empty.classList.remove("hidden");
});
