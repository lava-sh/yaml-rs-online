const els = {
  input: document.getElementById("yamlInput"),
  lineNumbers: document.getElementById("yamlLineNumbers"),
  highlight: document.getElementById("yamlHighlight"),
  output: document.getElementById("output"),
  pyStatus: document.getElementById("pyStatus"),
  pyStatusText: document.getElementById("pyStatusText"),
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
    result = f"{exc}"

result
`;

const YAML_RS_WHEEL_PATH =
  "./wheels/yaml_rs-0.0.15-cp313-cp313-emscripten_4_0_9_wasm32.whl";

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
let renderSeq = 0;
let pendingRenders = 0;
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

function setBusy(active, label = "Working") {
  const panel = els.output?.closest(".panel-right");
  if (panel) {
    panel.classList.toggle("is-busy", active);
  }
  if (els.pyStatus) {
    els.pyStatus.setAttribute("aria-hidden", active ? "false" : "true");
  }
  if (els.pyStatusText) {
    els.pyStatusText.textContent = label;
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

function setSplitFromPointer(clientX, clientY) {
  const rect = els.split.getBoundingClientRect();
  const isVertical = window.matchMedia("(max-width: 900px)").matches;

  if (isVertical) {
    const raw = ((clientY - rect.top) / rect.height) * 100;
    const clamped = Math.max(20, Math.min(80, raw));
    document.documentElement.style.setProperty("--top-height", `${clamped}%`);
    return;
  }

  const raw = ((clientX - rect.left) / rect.width) * 100;
  const clamped = Math.max(20, Math.min(80, raw));
  document.documentElement.style.setProperty("--left-width", `${clamped}%`);
}

async function renderYaml() {
  if (!isReady || !pyodide || !els.input || !els.output) {
    return;
  }

  const seq = ++renderSeq;
  pendingRenders += 1;
  setBusy(true, "Parsing");

  pyodide.globals.set("yaml_input", els.input.value);

  try {
    const result = await pyodide.runPythonAsync(PARSE_CODE);
    if (seq !== renderSeq) {
      return;
    }
    els.output.classList.remove("err");
    els.output.textContent = result;
  } catch (err) {
    if (seq !== renderSeq) {
      return;
    }
    els.output.classList.add("err");
    els.output.textContent = String(err);
  } finally {
    pendingRenders = Math.max(0, pendingRenders - 1);
    setBusy(pendingRenders > 0, "Parsing");
  }
}

async function installWheel() {
  try {
    await pyodide.runPythonAsync(`
import micropip
await micropip.install("${YAML_RS_WHEEL_PATH}")
`);
  } catch (err) {
    throw new Error(`Failed to install yaml_rs wheel from ${YAML_RS_WHEEL_PATH}: ${String(err)}`);
  }
}

async function boot() {
  setBusy(true, "Loading Pyodide");
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
  } finally {
    setBusy(pendingRenders > 0, pendingRenders > 0 ? "Parsing" : "Loading Pyodide");
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

  const startDrag = (clientX, clientY) => {
    dragging = true;
    document.body.style.userSelect = "none";
    document.body.classList.add("is-resizing");
    setSplitFromPointer(clientX, clientY);
  };

  const moveDrag = (clientX, clientY) => {
    if (!dragging) {
      return;
    }
    setSplitFromPointer(clientX, clientY);
  };

  const stopDrag = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.style.userSelect = "";
    document.body.classList.remove("is-resizing");
  };

  els.divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    startDrag(event.clientX, event.clientY);
  });

  window.addEventListener("pointermove", (event) => {
    moveDrag(event.clientX, event.clientY);
  });
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);

  els.divider.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    startDrag(event.clientX, event.clientY);
  });

  window.addEventListener("mousemove", (event) => {
    moveDrag(event.clientX, event.clientY);
  });
  window.addEventListener("mouseup", stopDrag);

  els.divider.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      event.preventDefault();
      startDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (dragging) {
        event.preventDefault();
      }
      moveDrag(touch.clientX, touch.clientY);
    },
    { passive: false },
  );
  window.addEventListener("touchend", stopDrag);
  window.addEventListener("touchcancel", stopDrag);

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
