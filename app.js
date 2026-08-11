const SUPABASE_URL = "https://uefhikvumolbmwaifbyb.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlZmhpa3Z1bW9sYm13YWlmYnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MTEzMjcsImV4cCI6MjEwMTk4NzMyN30.w97gzePYp4j93AL_R48dbyqbMekMrMXzG40prRiQY4g";
const BUCKET = "report-screenshots";

const state = {
  issues: [],
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

function setSync(message) {
  syncState.textContent = message;
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Request failed (${response.status})`);
  }
  return data;
}

async function refreshData() {
  setSync("Loading...");
  try {
    const rows = await requestJson(
      `${SUPABASE_URL}/rest/v1/report_issues?select=*&order=created_at.desc`,
      { headers: headers() }
    );
    state.issues = rows.map(fromRow);
    render();
    setSync("Cloud saved");
  } catch (error) {
    setSync(cleanError(error));
  }
}

async function addIssue(event) {
  event.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding...";
  setSync("Saving...");

  try {
    const data = new FormData(form);
    const screenshotFile = data.get("screenshot");
    let screenshotPath = "";
    let screenshotName = "";

    if (screenshotFile && screenshotFile.size) {
      const image = await compressImage(screenshotFile);
      screenshotPath = `${crypto.randomUUID()}.jpg`;
      screenshotName = screenshotFile.name || "screenshot.jpg";
      await uploadScreenshot(screenshotPath, image.blob);
    }

    const payload = {
      url: data.get("url").trim(),
      platform: data.get("platform"),
      severity: data.get("severity"),
      description: data.get("description").trim(),
      report_content: data.get("reportContent").trim(),
      screenshot_path: screenshotPath || null,
      screenshot_name: screenshotName || null,
      status: "Open",
      checklist: {},
    };

    const [row] = await requestJson(`${SUPABASE_URL}/rest/v1/report_issues`, {
      method: "POST",
      headers: headers({
        "content-type": "application/json",
        prefer: "return=representation",
      }),
      body: JSON.stringify(payload),
    });

    state.issues = [fromRow(row), ...state.issues];
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

async function uploadScreenshot(path, blob) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: headers({
        "content-type": "image/jpeg",
        "x-upsert": "true",
      }),
      body: blob,
    }
  );
  const text = await response.text();
  if (!response.ok) {
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}
    throw new Error(data.message || data.error || "Screenshot upload failed");
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
    const payload = {};
    if (changes.status) payload.status = changes.status;
    if (changes.checklist) payload.checklist = changes.checklist;
    payload.updated_at = new Date().toISOString();

    await requestJson(`${SUPABASE_URL}/rest/v1/report_issues?id=eq.${issue.id}`, {
      method: "PATCH",
      headers: headers({
        "content-type": "application/json",
        prefer: "return=minimal",
      }),
      body: JSON.stringify(payload),
    });
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
    await requestJson(`${SUPABASE_URL}/rest/v1/report_issues?id=eq.${issue.id}`, {
      method: "DELETE",
      headers: headers({ prefer: "return=minimal" }),
    });
    setSync("Cloud saved");
  } catch (error) {
    setSync(cleanError(error));
    await refreshData();
  }
}

function fromRow(row) {
  return normalizeIssue({
    id: row.id,
    url: row.url,
    platform: row.platform,
    severity: row.severity,
    description: row.description,
    reportContent: row.report_content,
    screenshot:
      row.screenshot_path
        ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(row.screenshot_path)}`
        : "",
    screenshotName: row.screenshot_name || "",
    status: row.status,
    checklist: row.checklist || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
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
    screenshotName: issue.screenshotName || "",
    status: issue.status || "Open",
    checklist: issue.checklist || {},
    createdAt: issue.createdAt || new Date().toISOString(),
    updatedAt: issue.updatedAt || new Date().toISOString(),
  };
}

async function compressImage(file) {
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(imageUrl);

  for (const quality of [0.78, 0.62, 0.48, 0.34]) {
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob && blob.size <= 2.8 * 1024 * 1024) {
      return { blob };
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
  if (message.includes("Failed to fetch")) return "Cloud connection failed";
  if (message.includes("row-level security")) return "Cloud permission error";
  if (message.includes("too large")) return "Too large: crop screenshot or shorten text";
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
