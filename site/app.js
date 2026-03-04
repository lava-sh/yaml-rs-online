const inputEl = document.getElementById("yamlInput");
const yamlHighlightEl = document.getElementById("yamlHighlight");
const outputEl = document.getElementById("output");
const splitEl = document.getElementById("split");
const dividerEl = document.getElementById("divider");
const copyYamlBtn = document.getElementById("copyYamlBtn");
const copyOutputBtn = document.getElementById("copyOutputBtn");

let pyodide;
let ready = false;

const parseCode = `
import pprint
import yaml_rs

try:
    parsed = yaml_rs.loads(yaml_input)
    pprint.pformat(parsed, width=80, sort_dicts=False)
except yaml_rs.YAMLDecodeError as exc:
    f"YAML error: {exc}"
`;

async function renderYaml() {
  if (!ready) {
    return;
  }

  const text = inputEl.value;
  pyodide.globals.set("yaml_input", text);

  try {
    const result = await pyodide.runPythonAsync(parseCode);
    outputEl.classList.remove("err");
    outputEl.textContent = result;
  } catch (err) {
    outputEl.classList.add("err");
    outputEl.textContent = String(err);
  }
}

async function boot() {
  try {
    const wheelResp = await fetch("./wheels/latest.txt", { cache: "no-store" });
    if (!wheelResp.ok) {
      throw new Error(`Failed to load wheels/latest.txt: HTTP ${wheelResp.status}`);
    }
    const wheelName = (await wheelResp.text()).trim();
    if (!wheelName) {
      throw new Error("wheels/latest.txt is empty");
    }

    pyodide = await loadPyodide();
    await pyodide.loadPackage("micropip");
    pyodide.globals.set("wheel_name", wheelName);
    await pyodide.runPythonAsync(`
import micropip
await micropip.install(f'./wheels/{wheel_name}')
`);
    ready = true;
    await renderYaml();
  } catch (err) {
    outputEl.classList.add("err");
    outputEl.textContent = String(err);
  }
}

let timer;
const copyFlashTimers = new WeakMap();

if (window.hljs && window.hljsDefineYaml) {
  window.hljs.registerLanguage("yaml", window.hljsDefineYaml);
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderYamlHighlight() {
  const source = inputEl.value.replace(/\r\n/g, "\n");
  if (window.hljs) {
    const highlighted = window.hljs.highlight(source, { language: "yaml", ignoreIllegals: true }).value;
    yamlHighlightEl.innerHTML = `${highlighted}\n`;
    return;
  }
  yamlHighlightEl.innerHTML = `${escapeHtml(source)}\n`;
}

function syncYamlScroll() {
  yamlHighlightEl.scrollTop = inputEl.scrollTop;
  yamlHighlightEl.scrollLeft = inputEl.scrollLeft;
}

inputEl.addEventListener("input", () => {
  renderYamlHighlight();
  syncYamlScroll();
  clearTimeout(timer);
  timer = setTimeout(() => {
    void renderYaml();
  }, 140);
});
inputEl.addEventListener("scroll", syncYamlScroll);

let dragging = false;

function flashCopied(button) {
  button.classList.add("copied");
  const activeTimer = copyFlashTimers.get(button);
  if (activeTimer) {
    clearTimeout(activeTimer);
  }
  const timerId = setTimeout(() => {
    button.classList.remove("copied");
    copyFlashTimers.delete(button);
  }, 900);
  copyFlashTimers.set(button, timerId);
}

async function copyText(text, button) {
  const value = text ?? "";
  try {
    await navigator.clipboard.writeText(value);
    flashCopied(button);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    flashCopied(button);
  }
}

function setSplitFromClientX(clientX) {
  const rect = splitEl.getBoundingClientRect();
  const raw = ((clientX - rect.left) / rect.width) * 100;
  const clamped = Math.max(20, Math.min(80, raw));
  document.documentElement.style.setProperty("--left-width", clamped + "%");
}

dividerEl.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(max-width: 900px)").matches) {
    return;
  }
  dragging = true;
  dividerEl.setPointerCapture(event.pointerId);
  setSplitFromClientX(event.clientX);
});

dividerEl.addEventListener("pointermove", (event) => {
  if (!dragging) {
    return;
  }
  setSplitFromClientX(event.clientX);
});

dividerEl.addEventListener("pointerup", (event) => {
  if (!dragging) {
    return;
  }
  dragging = false;
  dividerEl.releasePointerCapture(event.pointerId);
});

dividerEl.addEventListener("pointercancel", () => {
  dragging = false;
});

copyYamlBtn.addEventListener("click", () => {
  void copyText(inputEl.value, copyYamlBtn);
});

copyOutputBtn.addEventListener("click", () => {
  void copyText(outputEl.textContent, copyOutputBtn);
});

renderYamlHighlight();
syncYamlScroll();
void boot();
