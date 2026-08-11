const BUCKET = "JckQNAWfmZCAp4jDg3VzR";
const STORE_BASE = `https://kvdb.io/${BUCKET}`;
const INDEX_KEY = "amanah-index";
const MAX_VALUE_CHARS = 15000;
const IMAGE_CHUNK_SIZE = 12000;
const MAX_IMAGE_CHUNKS = 5;

const state = {
  issues: [],
  index: { ids: [], deletedIds: [] },
  search: "",
  statusFilter: "all",
  severityFilter: "all",
};

const form = document.querySelector("#issueForm");
const issueList = document.querySelector("#issueList");
const emptyState = document.querySelector("#emptyState");
const template = document.querySelector("#issueTemplate");
const syncState = document.querySelector("#syncState");
const submitBtn = document.querySelector("#submitBtn");

function keyUrl(key) {
  return `${STORE_BASE}/${encodeURIComponent(key)}`;
}

function setSync(message) {
  syncState.textContent = message;
}

async function requestText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed (${response.status})`);
  }
  return text;
}

async function getJson(key, fallback = null) {
  try {
    const text = await requestText(keyUrl(key));
    return JSON.parse(text);
  } catch (error) {
    if (String(error.message).includes("404") || String(error.message).includes("Not Found")) {
      return fallback;
    }
    throw error;
  }
}

async function setValue(key, value) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  if (body.length > MAX_VALUE_CHARS) {
    throw new Error("Data is too large. Shorten the text or crop the screenshot.");
  }
  await requestText(keyUrl(key), {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body,
  });
}

async function loadIndex() {
  const index = await getJson(INDEX_KEY, { ids: [], deletedIds: [] });
  return {
    ids: Array.isArray(index.ids) ? index.ids : [],
    deletedIds: Array.isArray(index.deletedIds) ? index.deletedIds : [],
  };
}

async function saveIndex(index) {
  await setValue(INDEX_KEY, index);
}

function issueKey(id) {
  return `issue-${id}`;
}

function imageChunkKey(id, index) {
  return `image-${id}-${index}`;
}

async function saveIssue(issue) {
  const toStore = { ...issue };

  if (toStore.screenshot && !toStore.screenshotChunks) {
    toStore.screenshotChunks = await saveImageChunks(issue.id, toStore.screenshot);
  }

  delete toStore.screenshot;
  await setValue(issueKey(issue.id), toStore);
}

async function saveImageChunks(id, dataUrl) {
  const chunks = [];
  for (let offset = 0; offset < dataUrl.length; offset += IMAGE_CHUNK_SIZE) {
    chunks.push(dataUrl.slice(offset, offset + IMAGE_CHUNK_SIZE));
  }
  if (chunks.length > MAX_IMAGE_CHUNKS) {
    throw new Error("Screenshot is too large after compression. Crop it smaller first.");
  }
  await Promise.all(chunks.map((chunk, index) => setValue(imageChunkKey(id, index), chunk)));
  return chunks.length;
}

async function loadImageChunks(id, count) {
  if (!count) return "";
  const chunks = await Promise.all(
    Array.from({ length: count }, (_, index) => requestText(keyUrl(imageChunkKey(id, index))))
  );
  return chunks.join("");
}

async function loadIssue(id) {
  const issue = normalizeIssue(await getJson(issueKey(id)));
  issue.screenshot = await loadImageChunks(issue.id, issue.screenshotChunks);
  return issue;
}

async function refreshData() {
  setSync("Loading...");
  try {
    state.index = await loadIndex();
    const ids = state.index.ids.filter((id) => !state.index.deletedIds.includes(id));
    const results = await Promise.allSettled(ids.map(loadIssue));
    state.issues = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    render();
    setSync("Cloud saved");
  } catch (error) {
    setSync(cleanError(error));
  }
}

function normalizeIssue(issue = {}) {
  return {
    id: issue.id || crypto.randomUUID(),
    url: issue.url || "",
    platform: issue.platform || "Website",
    severity: issue.severity || "Needs review",
    description: issue.description || "",
    reportContent: issue.reportContent || "",
    screenshot: issue.screenshot || "",
    screenshotChunks: issue.screenshotChunks || 0,
    screenshotName: issue.screenshotName || "",
    status: issue.status || "Open",
    checklist: issue.checklist || {},
    createdAt: issue.createdAt || new Date().toISOString(),
    updatedAt: issue.updatedAt || new Date().toISOString(),
  };
}

async function addIssue(event) {
  event.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding...";
  setSync("Saving...");

  try {
    const data = new FormData(form);
    const screenshotFile = data.get("screenshot");
    const issue = normalizeIssue({
      id: crypto.randomUUID(),
      url: data.get("url").trim(),
      platform: data.get("platform"),
      severity: data.get("severity"),
      description: data.get("description").trim(),
      reportContent: data.get("reportContent").trim(),
      screenshot:
        screenshotFile && screenshotFile.size
          ? await compressImage(screenshotFile)
          : "",
      screenshotName: screenshotFile?.name || "",
      status: "Open",
      checklist: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await saveIssue(issue);
    const latestIndex = await loadIndex();
    const nextIndex = {
      ids: [issue.id, ...latestIndex.ids.filter((id) => id !== issue.id)].slice(0, 160),
      deletedIds: latestIndex.deletedIds || [],
    };
    await saveIndex(nextIndex);

    state.index = nextIndex;
    state.issues = [issue, ...state.issues];
    form.reset();
    render();
    setSync("Cloud saved");
  } catch (error) {
    setSync(cleanError(error));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add to queue";
  }
}

async function updateIssue(issue, changes) {
  const nextIssue = normalizeIssue({
    ...issue,
    ...changes,
    updatedAt: new Date().toISOString(),
  });
  state.issues = state.issues.map((item) => (item.id === issue.id ? nextIssue : item));
  render();
  setSync("Saving...");
  try {
    await saveIssue(nextIssue);
    setSync("Cloud saved");
  } catch (error) {
    setSync(cleanError(error));
    await refreshData();
  }
}

async function deleteIssue(issue) {
  state.issues = state.issues.filter((item) => item.id !== issue.id);
  render();
  setSync("Saving...");
  try {
    const latestIndex = await loadIndex();
    state.index = {
      ids: latestIndex.ids.filter((id) => id !== issue.id),
      deletedIds: [...new Set([...(latestIndex.deletedIds || []), issue.id])].slice(0, 300),
    };
    await saveIndex(state.index);
    setSync("Cloud saved");
  } catch (error) {
    setSync(cleanError(error));
    await refreshData();
  }
}

async function compressImage(file) {
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const maxSide = 540;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(imageUrl);

  for (const quality of [0.68, 0.52, 0.38, 0.26]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= IMAGE_CHUNK_SIZE * MAX_IMAGE_CHUNKS) {
      return dataUrl;
    }
  }

  throw new Error("Screenshot is too large after compression. Crop it smaller first.");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function cleanError(error) {
  const message = error?.message || String(error);
  if (message.includes("too large")) return "Too large: shorten text or crop screenshot";
  if (message.includes("Failed to fetch")) return "Cloud connection failed";
  return message.slice(0, 80);
}

function filteredIssues() {
  const query = state.search.trim().toLowerCase();
  return state.issues.filter((issue) => {
    const text =
      `${issue.url} ${issue.description} ${issue.reportContent} ${issue.platform}`.toLowerCase();
    return (
      (!query || text.includes(query)) &&
      (state.statusFilter === "all" || issue.status === state.statusFilter) &&
      (state.severityFilter === "all" || issue.severity === state.severityFilter)
    );
  });
}

function renderStats() {
  document.querySelector("#totalCount").textContent = state.issues.length;
  document.querySelector("#openCount").textContent = state.issues.filter(
    (issue) => issue.status === "Open"
  ).length;
  document.querySelector("#reportedCount").textContent = state.issues.filter(
    (issue) => issue.status === "Reported"
  ).length;
  document.querySelector("#highCount").textContent = state.issues.filter(
    (issue) => issue.severity === "High"
  ).length;
}

function renderIssues() {
  issueList.innerHTML = "";
  const severityRank = { High: 0, Medium: 1, Low: 2, "Needs review": 3 };
  const visibleIssues = filteredIssues().sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      new Date(b.createdAt) - new Date(a.createdAt)
  );

  emptyState.hidden = visibleIssues.length > 0;

  visibleIssues.forEach((issue) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".issue-card");
    const screenshot = node.querySelector(".screenshot-preview");
    card.dataset.id = issue.id;
    node.querySelector(".meta").textContent = `${issue.platform} · ${issue.status}`;
    node.querySelector("h3").textContent = issueTitle(issue);
    node.querySelector(".badge").textContent = issue.severity;
    node.querySelector(".badge").style.background = badgeColor(issue.severity);
    node.querySelector(".url").textContent = issue.url;
    node.querySelector(".url").href = issue.url;
    node.querySelector(".description").textContent = issue.description;
    node.querySelector(".report-content").textContent = issue.reportContent;

    if (issue.screenshot) {
      screenshot.src = issue.screenshot;
      screenshot.hidden = false;
    } else {
      screenshot.hidden = true;
    }

    node.querySelectorAll(".checklist input").forEach((checkbox) => {
      checkbox.checked = Boolean(issue.checklist?.[checkbox.dataset.step]);
    });
    issueList.appendChild(node);
  });
}

function issueTitle(issue) {
  try {
    return `${issue.platform} issue · ${new URL(issue.url).hostname}`;
  } catch {
    return `${issue.platform} issue`;
  }
}

function badgeColor(severity) {
  if (severity === "High") return "#ffe9e9";
  if (severity === "Medium") return "#fff4d9";
  if (severity === "Low") return "#eaf1ff";
  return "#edf5f1";
}

function render() {
  renderStats();
  renderIssues();
}

form.addEventListener("submit", addIssue);

document.querySelector("#refreshBtn").addEventListener("click", refreshData);

document.querySelector("#search").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderIssues();
});

document.querySelector("#statusFilter").addEventListener("change", (event) => {
  state.statusFilter = event.target.value;
  renderIssues();
});

document.querySelector("#severityFilter").addEventListener("change", (event) => {
  state.severityFilter = event.target.value;
  renderIssues();
});

issueList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const card = event.target.closest(".issue-card");
  const issue = state.issues.find((item) => item.id === card.dataset.id);
  if (!issue) return;

  const action = button.dataset.action;
  if (action === "open") {
    window.open(issue.url, "_blank", "noreferrer");
  }
  if (action === "copy") {
    await copyText(issue.reportContent);
    await updateIssue(issue, {
      checklist: { ...issue.checklist, copied: true },
    });
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy report content"), 1200);
  }
  if (action === "reported") {
    await updateIssue(issue, {
      status: "Reported",
      checklist: { ...issue.checklist, reported: true },
    });
  }
  if (action === "resolved") {
    await updateIssue(issue, { status: "Resolved" });
  }
  if (action === "delete") {
    await deleteIssue(issue);
  }
});

issueList.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input[type='checkbox']");
  if (!checkbox) return;
  const card = event.target.closest(".issue-card");
  const issue = state.issues.find((item) => item.id === card.dataset.id);
  if (!issue) return;

  await updateIssue(issue, {
    checklist: { ...issue.checklist, [checkbox.dataset.step]: checkbox.checked },
    ...(checkbox.dataset.step === "reported" && checkbox.checked
      ? { status: "Reported" }
      : {}),
  });
});

refreshData();
