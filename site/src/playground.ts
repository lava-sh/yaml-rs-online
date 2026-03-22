import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import yaml from "highlight.js/lib/languages/yaml";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("python", python);

type Theme = "light" | "dark";

type Tone = "muted" | "ready" | "warn";

type SiteConfig = {
  pyodide_version: string;
  wheel_file: string;
};

type PyodideRuntime = {
  globals: {
    set: (name: string, value: string) => void;
  };
  loadPackage: (name: string) => Promise<void>;
  runPythonAsync: (code: string) => Promise<string>;
};

declare global {
  interface Window {
    loadPyodide?: (options?: { indexURL?: string }) => Promise<PyodideRuntime>;
  }
}

const DEFAULT_YAML = `# Paste YAML here:
app:
  local: true
  logging:
    level: INFO
  version: 1.7
  release-date: 2015-07-09
  mysql:
    user: "user"
    password: "password"
    host: "127.0.0.1"
    port: 3306
    db_name: "database"`;

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

const THEME_KEY = "yaml-rs-theme";
const SPLIT_KEY = "yaml-rs-split";
const HLJS_MAX_LENGTH = 20_000;
const YAML_HASH_KEY = "yaml";
const YAML_COMPRESSED_HASH_KEY = "yamlz";

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array {
  const normalized = text.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function compressText(text: string): Promise<string | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }

  try {
    const stream = new CompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    const compression = (async () => {
      await writer.write(new TextEncoder().encode(text));
      await writer.close();
      const compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
      return toBase64Url(compressed);
    })();

    const result = await Promise.race<string | null>([
      compression,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 150);
      }),
    ]);
    if (result === null) {
      return null;
    }

    return result;
  } catch {
    return null;
  }
}

async function decompressText(text: string): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") {
    return null;
  }

  try {
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    await writer.write(fromBase64Url(text));
    await writer.close();
    const result = await new Response(stream.readable).arrayBuffer();
    return new TextDecoder().decode(result);
  } catch {
    return null;
  }
}

function encodePlainText(text: string): string {
  return toBase64Url(new TextEncoder().encode(text));
}

function decodePlainText(text: string): string {
  return new TextDecoder().decode(fromBase64Url(text));
}

async function buildShareUrl(yamlSource: string): Promise<string> {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  params.delete(YAML_HASH_KEY);
  params.delete(YAML_COMPRESSED_HASH_KEY);

  const compressed = await compressText(yamlSource);
  if (compressed) {
    params.set(YAML_COMPRESSED_HASH_KEY, compressed);
  } else {
    params.set(YAML_HASH_KEY, encodePlainText(yamlSource));
  }

  url.hash = params.toString();
  return url.toString();
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    helper.style.top = "0";
    helper.setAttribute("readonly", "");
    document.body.append(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) {
      throw new Error("Copy command failed");
    }
  }
}

async function readSharedYaml(): Promise<string | null> {
  const hash = window.location.hash;
  if (!hash.startsWith("#")) {
    return null;
  }

  const params = new URLSearchParams(hash.slice(1));
  const compressed = params.get(YAML_COMPRESSED_HASH_KEY);
  if (compressed) {
    const decoded = await decompressText(compressed);
    if (decoded !== null) {
      return decoded;
    }
  }

  const plain = params.get(YAML_HASH_KEY);
  if (!plain) {
    return null;
  }

  try {
    return decodePlainText(plain);
  } catch {
    return null;
  }
}

function parseSimpleToml(source: string): SiteConfig {
  const entries = Object.fromEntries(
    Array.from(source.matchAll(/^\s*([a-z_]+)\s*=\s*"([^"]*)"\s*$/gim), ([, key, value]) => [
      key,
      value,
    ]),
  );
  const pyodideVersion = entries.pyodide_version;
  const wheelFile = entries.wheel_file;

  if (!pyodideVersion || !wheelFile) {
    throw new Error("Invalid config.toml: expected pyodide_version and wheel_file");
  }

  return {
    pyodide_version: pyodideVersion,
    wheel_file: wheelFile,
  };
}

function getPythonBadgeFromWheelFile(wheelFile: string): string {
  const match = wheelFile.match(/cp(\d)(\d{2})/i);
  if (!match) {
    return "Python";
  }

  return `Python ${match[1]}.${match[2]}`;
}

async function loadConfig(): Promise<SiteConfig> {
  const response = await fetch("./config.toml", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load config.toml: ${response.status}`);
  }
  return parseSimpleToml(await response.text());
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (typeof window.loadPyodide === "function") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
      once: true,
    });
    document.head.append(script);
  });
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function readTheme(): Theme {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isMobileLayout(): boolean {
  return window.matchMedia("(max-width: 980px)").matches;
}

function setSplitRatio(rawRatio: number): number {
  const clamped = Math.max(28, Math.min(72, rawRatio));
  document.documentElement.style.setProperty(
    isMobileLayout() ? "--top-height" : "--left-width",
    `${clamped}%`,
  );
  localStorage.setItem(SPLIT_KEY, String(clamped));
  return clamped;
}

function restoreSplitRatio(): number {
  const saved = Number(localStorage.getItem(SPLIT_KEY));
  return Number.isFinite(saved) ? setSplitRatio(saved) : setSplitRatio(52);
}

function countLines(source: string): number {
  if (source.length === 0) {
    return 1;
  }

  let lines = 1;
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      lines += 1;
    }
  }
  return lines;
}

export function usePlayground() {
  const theme = ref<Theme>("dark");
  const yamlInput = ref(DEFAULT_YAML);
  const output = ref("");
  const outputHighlight = ref("");
  const busyLabel = ref("Loading runtime");
  const busy = ref(false);
  const renderError = ref(false);
  const engineBadge = ref("Pyodide loading");
  const configBadge = ref("Python");
  const engineTone = ref<Tone>("ready");
  const configTone = ref<Tone>("ready");
  const yamlCopied = ref(false);
  const yamlShared = ref(false);
  const outputCopied = ref(false);

  const inputRef = ref<HTMLTextAreaElement | null>(null);
  const highlightRef = ref<HTMLElement | null>(null);
  const lineNumbersRef = ref<HTMLElement | null>(null);
  const dividerRef = ref<HTMLElement | null>(null);

  const themeButtonLabel = computed(() =>
    theme.value === "dark" ? "Switch to light" : "Switch to dark",
  );

  let pyodide: PyodideRuntime | undefined;
  let renderTimer = 0;
  let highlightFrame = 0;
  let renderSeq = 0;
  let pendingRenders = 0;
  let lastHighlightSource = "";
  let lastLineCount = 0;
  let dragging = false;
  let renderQueuedSource = "";
  const feedbackTimers: Record<"yaml" | "output" | "share", number> = {
    yaml: 0,
    output: 0,
    share: 0,
  };

  function setBusy(active: boolean, label = "Parsing YAML"): void {
    busy.value = active;
    busyLabel.value = label;
  }

  function renderLineNumbers(source: string): void {
    if (!lineNumbersRef.value) {
      return;
    }
    const lineCount = countLines(source);
    if (lineCount === lastLineCount) {
      return;
    }
    lastLineCount = lineCount;

    let content = "";
    for (let i = 1; i <= lineCount; i += 1) {
      content += `${i}\n`;
    }
    lineNumbersRef.value.textContent = content;
  }

  function renderHighlight(source: string): void {
    if (!highlightRef.value) {
      return;
    }
    if (source === lastHighlightSource) {
      return;
    }
    lastHighlightSource = source;

    if (source.length > HLJS_MAX_LENGTH) {
      highlightRef.value.innerHTML = `${escapeHtml(source)}\n`;
      return;
    }

    try {
      highlightRef.value.innerHTML = `${hljs.highlight(source, { language: "yaml", ignoreIllegals: true }).value}\n`;
    } catch {
      highlightRef.value.innerHTML = `${escapeHtml(source)}\n`;
    }
  }

  function renderOutputHighlight(source: string): void {
    if (renderError.value) {
      outputHighlight.value = escapeHtml(source);
      return;
    }

    if (source.length > HLJS_MAX_LENGTH) {
      outputHighlight.value = escapeHtml(source);
      return;
    }

    try {
      outputHighlight.value = hljs.highlight(source, {
        language: "python",
        ignoreIllegals: true,
      }).value;
    } catch {
      outputHighlight.value = escapeHtml(source);
    }
  }

  function syncYamlScroll(): void {
    if (!inputRef.value || !highlightRef.value || !lineNumbersRef.value) {
      return;
    }
    highlightRef.value.scrollTop = inputRef.value.scrollTop;
    highlightRef.value.scrollLeft = inputRef.value.scrollLeft;
    lineNumbersRef.value.scrollTop = inputRef.value.scrollTop;
  }

  function scheduleHighlight(): void {
    renderQueuedSource = yamlInput.value.replace(/\r\n/g, "\n");
    if (highlightFrame) {
      return;
    }
    highlightFrame = window.requestAnimationFrame(() => {
      highlightFrame = 0;
      const source = renderQueuedSource;
      renderHighlight(source);
      renderLineNumbers(source);
      syncYamlScroll();
    });
  }

  async function renderYaml(): Promise<void> {
    if (!pyodide) {
      return;
    }

    const seq = ++renderSeq;
    pendingRenders += 1;
    setBusy(true, "Parsing YAML");
    pyodide.globals.set("yaml_input", yamlInput.value);

    try {
      const result = await pyodide.runPythonAsync(PARSE_CODE);
      if (seq !== renderSeq) {
        return;
      }
      renderError.value = false;
      output.value = result;
      renderOutputHighlight(result);
      engineTone.value = "ready";
    } catch (error) {
      if (seq !== renderSeq) {
        return;
      }
      renderError.value = true;
      output.value = String(error);
      renderOutputHighlight(String(error));
      engineBadge.value = "Runtime error";
      engineTone.value = "warn";
    } finally {
      pendingRenders = Math.max(0, pendingRenders - 1);
      setBusy(pendingRenders > 0, pendingRenders > 0 ? "Parsing YAML" : "Idle");
    }
  }

  async function installWheel(config: SiteConfig): Promise<void> {
    if (!pyodide) {
      throw new Error("Pyodide is not initialized");
    }

    await pyodide.runPythonAsync(`
import micropip
await micropip.install("./wheels/${config.wheel_file}")
`);
  }

  async function boot(): Promise<void> {
    setBusy(true, "Loading config");

    try {
      const config = await loadConfig();
      engineBadge.value = `Pyodide ${config.pyodide_version}`;
      configBadge.value = getPythonBadgeFromWheelFile(config.wheel_file);
      engineTone.value = "ready";
      configTone.value = "ready";

      setBusy(true, "Loading Pyodide");
      const pyodideBase = `https://cdn.jsdelivr.net/pyodide/v${config.pyodide_version}/full/`;
      await loadScript(`${pyodideBase}pyodide.js`);

      if (!window.loadPyodide) {
        throw new Error("loadPyodide is unavailable after script load");
      }

      pyodide = await window.loadPyodide({ indexURL: pyodideBase });
      setBusy(true, "Loading micropip");
      await pyodide.loadPackage("micropip");

      setBusy(true, "Installing yaml-rs");
      await installWheel(config);

      engineTone.value = "ready";
      await renderYaml();
    } catch (error) {
      renderError.value = true;
      output.value = String(error);
      renderOutputHighlight(String(error));
      engineBadge.value = "Boot failed";
      engineTone.value = "warn";
    } finally {
      setBusy(false, "Idle");
    }
  }

  function setSplitFromPointer(clientX: number, clientY: number): void {
    const split = dividerRef.value?.parentElement;
    if (!split) {
      return;
    }
    const rect = split.getBoundingClientRect();
    const ratio = isMobileLayout()
      ? ((clientY - rect.top) / rect.height) * 100
      : ((clientX - rect.left) / rect.width) * 100;
    setSplitRatio(ratio);
  }

  function toggleTheme(): void {
    theme.value = theme.value === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, theme.value);
    applyTheme(theme.value);
  }

  function flashFeedback(kind: "yaml" | "output" | "share"): void {
    if (feedbackTimers[kind]) {
      window.clearTimeout(feedbackTimers[kind]);
    }

    if (kind === "yaml") {
      yamlCopied.value = true;
    } else if (kind === "share") {
      yamlShared.value = true;
    } else {
      outputCopied.value = true;
    }

    feedbackTimers[kind] = window.setTimeout(() => {
      if (kind === "yaml") {
        yamlCopied.value = false;
      } else if (kind === "share") {
        yamlShared.value = false;
      } else {
        outputCopied.value = false;
      }
    }, 1100);
  }

  async function copyText(text: string, kind: "yaml" | "output"): Promise<void> {
    await writeClipboardText(text);
    flashFeedback(kind);
  }

  async function shareYamlLink(): Promise<void> {
    try {
      const shareUrl = await buildShareUrl(yamlInput.value);
      window.history.replaceState(null, "", shareUrl);

      yamlCopied.value = false;
      if (feedbackTimers.yaml) {
        window.clearTimeout(feedbackTimers.yaml);
      }
      flashFeedback("share");
      await writeClipboardText(shareUrl);
    } catch {
      yamlShared.value = false;
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    setSplitFromPointer(event.clientX, event.clientY);
  };

  const onPointerUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove("is-resizing");
    document.body.style.userSelect = "";
  };

  const onResize = () => {
    restoreSplitRatio();
  };

  watch(yamlInput, () => {
    scheduleHighlight();
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      void renderYaml();
    }, 120);
  });

  onMounted(async () => {
    theme.value = readTheme();
    applyTheme(theme.value);
    restoreSplitRatio();
    const sharedYaml = await readSharedYaml();
    if (sharedYaml !== null) {
      yamlInput.value = sharedYaml;
    }
    scheduleHighlight();
    void boot();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("resize", onResize);
    window.clearTimeout(renderTimer);
    window.clearTimeout(feedbackTimers.yaml);
    window.clearTimeout(feedbackTimers.output);
    window.clearTimeout(feedbackTimers.share);
    if (highlightFrame) {
      window.cancelAnimationFrame(highlightFrame);
    }
  });

  return {
    busy,
    busyLabel,
    configBadge,
    configTone,
    copyText,
    dividerRef,
    engineBadge,
    engineTone,
    highlightRef,
    inputRef,
    lineNumbersRef,
    output,
    outputHighlight,
    outputCopied,
    renderError,
    setSplitFromPointer,
    shareYamlLink,
    themeButtonLabel,
    toggleTheme,
    yamlInput,
    yamlCopied,
    yamlShared,
    startDrag() {
      dragging = true;
      document.body.classList.add("is-resizing");
      document.body.style.userSelect = "none";
    },
    syncYamlScroll,
  };
}
