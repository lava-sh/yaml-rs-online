/* eslint-disable unicorn/require-post-message-target-origin */
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import yaml from "highlight.js/lib/languages/yaml";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import configRaw from "../../config.toml?raw";

hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("python", python);

type Theme = "light" | "dark";

type Tone = "ready" | "warn";

type SiteConfig = {
  pyodide_version: string;
  yaml_rs_version: string;
};

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

    return await Promise.race<string | null>([
      compression,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 150);
      }),
    ]);
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

function parseConfig(source: string): SiteConfig {
  const entries = Object.fromEntries(
    Array.from(source.matchAll(/^\s*([a-z_]+)\s*=\s*"([^"]*)"\s*$/gim), ([, key, value]) => [
      key,
      value,
    ]),
  );
  const pyodideVersion = entries.pyodide_version;
  const yamlRsVersion = entries.yaml_rs_version;

  if (!pyodideVersion || !yamlRsVersion) {
    throw new Error("Invalid config.toml: expected pyodide_version and yaml_rs_version");
  }

  return {
    pyodide_version: pyodideVersion,
    yaml_rs_version: yamlRsVersion,
  };
}

const CONFIG = parseConfig(configRaw);

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
  let n = 1;
  let i = source.indexOf("\n");
  while (i !== -1) {
    n += 1;
    i = source.indexOf("\n", i + 1);
  }
  return n;
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
  const versionBadge = ref("yaml-rs");
  const engineTone = ref<Tone>("ready");
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

  let runtimeWorker: Worker | undefined;
  let renderTimer = 0;
  let highlightFrame = 0;
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

  function renderYaml(): void {
    if (!runtimeWorker) {
      return;
    }
    runtimeWorker.postMessage({ type: "render", yaml: yamlInput.value });
  }

  function boot(): void {
    engineBadge.value = `Pyodide ${CONFIG.pyodide_version}`;
    versionBadge.value = `yaml-rs ${CONFIG.yaml_rs_version}`;
    setBusy(true, "Loading Pyodide");

    runtimeWorker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), {
      type: "module",
    });
    runtimeWorker.addEventListener("message", ({ data }) => {
      if (data.type === "status") {
        setBusy(data.busy, data.label);
        if (data.engineBadge) engineBadge.value = data.engineBadge;
        if (data.configBadge) configBadge.value = data.configBadge;
        if (data.engineTone) engineTone.value = data.engineTone;
        return;
      }

      if (data.type === "result" || data.type === "error") {
        renderError.value = data.type === "error";
        output.value = data.output;
        if (data.type === "result") {
          renderOutputHighlight(data.output);
        }
        if (data.engineBadge) engineBadge.value = data.engineBadge;
        if (data.engineTone) engineTone.value = data.engineTone;
      }
    });
    runtimeWorker.postMessage({
      type: "boot",
      pyodideVersion: CONFIG.pyodide_version,
      yamlRsVersion: CONFIG.yaml_rs_version,
      yaml: yamlInput.value,
    });
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

  const feedbackRefs = { yaml: yamlCopied, output: outputCopied, share: yamlShared };

  function flashFeedback(kind: "yaml" | "output" | "share"): void {
    if (feedbackTimers[kind]) {
      window.clearTimeout(feedbackTimers[kind]);
    }
    const target = feedbackRefs[kind];
    target.value = true;
    feedbackTimers[kind] = window.setTimeout(() => {
      target.value = false;
    }, 1100);
  }

  async function copyText(text: string, kind: "yaml" | "output"): Promise<void> {
    flashFeedback(kind);
    try {
      await writeClipboardText(text);
    } catch {}
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
      renderYaml();
    }, 120);
  });

  onMounted(() => {
    theme.value = readTheme();
    applyTheme(theme.value);
    restoreSplitRatio();
    scheduleHighlight();

    void (async () => {
      const sharedYaml = await readSharedYaml();
      if (sharedYaml !== null) {
        yamlInput.value = sharedYaml;
        scheduleHighlight();
      }
      boot();
    })();

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
    runtimeWorker?.terminate();
  });

  return {
    busy,
    busyLabel,
    configBadge,
    versionBadge,
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
    startDrag(event: PointerEvent) {
      dragging = true;
      document.body.classList.add("is-resizing");
      document.body.style.userSelect = "none";
      (event.currentTarget as Element)?.setPointerCapture(event.pointerId);
    },
    syncYamlScroll,
  };
}
