const els = {
  input: document.getElementById("yamlInput"),
  lineNumbers: document.getElementById("yamlLineNumbers"),
  highlight: document.getElementById("yamlHighlight"),
  output: document.getElementById("output"),
  split: document.getElementById("split"),
  divider: document.getElementById("divider"),
  copyYamlBtn: document.getElementById("copyYamlBtn"),
  copyOutputBtn: document.getElementById("copyOutputBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  hljsTheme: document.getElementById("hljsTheme"),
};

const PARSE_CODE = `
from pprint import pformat
import yaml_rs

try:
    parsed = yaml_rs.loads(yaml_input)
    result = pformat(parsed, width=80, sort_dicts=False)
except yaml_rs.YAMLDecodeError as exc:
    result = f"YAML error: {exc}"

result
`;

const WHEEL_CANDIDATES_FALLBACK = [
  "yaml_rs.whl",
  "yaml_rs-0.0.14-cp313-cp313-emscripten_4_0_9_wasm32.whl",
  "yaml_rs-0.0.14-cp312-cp312-emscripten_3_1_58_wasm32.whl",
];

const THEME_KEY = "yaml-rs-theme";
const HLJS_LIGHT =
  "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github.min.css";
const HLJS_DARK =
  "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github-dark.min.css";

let pyodide;
let isReady = false;
let renderTimer;
let highlightFrame = 0;
let lastHighlightSource = "";
let lastLineCount = 0;
const copyTimers = new WeakMap();
const HLJS_MAX_LENGTH = 12000;

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (els.themeToggleBtn) {
    const next = theme === "dark" ? "light" : "dark";
    els.themeToggleBtn.setAttribute("aria-label", `Switch to ${next} theme`);
    els.themeToggleBtn.setAttribute("title", `Switch to ${next} theme`);
  }
  if (els.hljsTheme) {
    els.hljsTheme.href = theme === "dark" ? HLJS_DARK : HLJS_LIGHT;
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    applyTheme(savedTheme);
    return;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function renderYamlHighlight() {
  if (!els.input || !els.highlight) {
    return;
  }

  const source = els.input.value.replace(/\r\n/g, "\n");
  if (source === lastHighlightSource) {
    return;
  }
  lastHighlightSource = source;

  if (source.length > HLJS_MAX_LENGTH) {
    els.highlight.innerHTML = `${escapeHtml(source)}\n`;
    return;
  }

  if (window.hljs) {
    try {
      const highlighted = window.hljs.highlight(source, {
        language: "yaml",
        ignoreIllegals: true,
      }).value;
      els.highlight.innerHTML = `${highlighted}\n`;
      return;
    } catch {
      // fallback below
    }
  }

  els.highlight.innerHTML = `${escapeHtml(source)}\n`;
}

function renderYamlLineNumbers() {
  if (!els.input || !els.lineNumbers) {
    return;
  }

  const source = els.input.value.replace(/\r\n/g, "\n");
  const lineCount = source.split("\n").length;
  if (lineCount === lastLineCount) {
    return;
  }
  lastLineCount = lineCount;

  const lines = Array.from({ length: lineCount }, (_, idx) => String(idx + 1)).join("\n");
  els.lineNumbers.textContent = `${lines}\n`;
}

function scheduleHighlight() {
  if (highlightFrame) {
    return;
  }
  highlightFrame = window.requestAnimationFrame(() => {
    highlightFrame = 0;
    renderYamlHighlight();
    renderYamlLineNumbers();
    syncYamlScroll();
  });
}

function syncYamlScroll() {
  if (!els.input || !els.highlight || !els.lineNumbers) {
    return;
  }
  els.highlight.scrollTop = els.input.scrollTop;
  els.highlight.scrollLeft = els.input.scrollLeft;
  els.lineNumbers.scrollTop = els.input.scrollTop;
}

function flashCopied(button) {
  button.classList.add("copied");
  const activeTimer = copyTimers.get(button);
  if (activeTimer) {
    clearTimeout(activeTimer);
  }
  const timerId = setTimeout(() => {
    button.classList.remove("copied");
    copyTimers.delete(button);
  }, 900);
  copyTimers.set(button, timerId);
}

async function copyText(value, button) {
  const text = value ?? "";

  try {
    await navigator.clipboard.writeText(text);
    flashCopied(button);
    return;
  } catch {
    // fallback below
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "fixed";
  helper.style.left = "-9999px";
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
  flashCopied(button);
}

function setSplitFromClientX(clientX) {
  const rect = els.split.getBoundingClientRect();
  const raw = ((clientX - rect.left) / rect.width) * 100;
  const clamped = Math.max(20, Math.min(80, raw));
  document.documentElement.style.setProperty("--left-width", `${clamped}%`);
}

async function renderYaml() {
  if (!isReady || !pyodide || !els.input || !els.output) {
    return;
  }

  pyodide.globals.set("yaml_input", els.input.value);

  try {
    const result = await pyodide.runPythonAsync(PARSE_CODE);
    els.output.classList.remove("err");
    els.output.textContent = result;
  } catch (err) {
    els.output.classList.add("err");
    els.output.textContent = String(err);
  }
}

async function installWheel() {
  const candidates = [];

  try {
    const response = await fetch("./wheels/latest.txt", { cache: "no-store" });
    if (response.ok) {
      const wheelName = (await response.text()).trim();
      if (wheelName) {
        candidates.push(wheelName);
      }
    }
  } catch {
    // ignore and use fallbacks
  }

  candidates.push(...WHEEL_CANDIDATES_FALLBACK);

  const uniqueCandidates = [...new Set(candidates)];
  let lastError = "unknown error";

  for (const wheel of uniqueCandidates) {
    try {
      pyodide.globals.set("wheel_name", wheel);
      await pyodide.runPythonAsync(`
import micropip
await micropip.install(f'./wheels/{wheel_name}')
`);
      return;
    } catch (err) {
      lastError = String(err);
    }
  }

  throw new Error(
    `Failed to install wheel from ./wheels (tried ${uniqueCandidates.length} candidates). Last error: ${lastError}`,
  );
}

async function boot() {
  try {
    pyodide = await loadPyodide();
    await pyodide.loadPackage("micropip");
    await installWheel();
    isReady = true;
    await renderYaml();
  } catch (err) {
    if (els.output) {
      els.output.classList.add("err");
      els.output.textContent = String(err);
    }
  }
}

function initEvents() {
  if (!els.input || !els.output || !els.divider || !els.split) {
    return;
  }

  let dragging = false;

  els.input.addEventListener("input", () => {
    scheduleHighlight();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      void renderYaml();
    }, 130);
  });

  els.input.addEventListener("scroll", syncYamlScroll, { passive: true });

  els.divider.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      return;
    }
    dragging = true;
    els.divider.setPointerCapture(event.pointerId);
    setSplitFromClientX(event.clientX);
  });

  els.divider.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    setSplitFromClientX(event.clientX);
  });

  els.divider.addEventListener("pointerup", (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    els.divider.releasePointerCapture(event.pointerId);
  });

  els.divider.addEventListener("pointercancel", () => {
    dragging = false;
  });

  els.copyYamlBtn?.addEventListener("click", () => {
    void copyText(els.input.value, els.copyYamlBtn);
  });

  els.copyOutputBtn?.addEventListener("click", () => {
    void copyText(els.output.textContent, els.copyOutputBtn);
  });

  els.themeToggleBtn?.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    lastHighlightSource = "";
    lastLineCount = 0;
    scheduleHighlight();
  });
}

initTheme();
initEvents();
scheduleHighlight();
void boot();
