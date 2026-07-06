/* eslint-disable unicorn/require-post-message-target-origin */
type PyodideRuntime = {
  globals: {
    set: (name: string, value: string) => void;
  };
  loadPackage: (name: string) => Promise<void>;
  runPythonAsync: (code: string) => Promise<string>;
};

type BootMessage = {
  type: "boot";
  pyodideVersion: string;
  yamlRsVersion: string;
  yaml: string;
};

type RenderMessage = {
  type: "render";
  yaml: string;
};

type PyodideModule = {
  loadPyodide: (options?: { indexURL?: string }) => Promise<PyodideRuntime>;
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

let pyodide: PyodideRuntime | undefined;
let latestYaml = "";
let rendering = false;

function status(label: string, busy = true, extra: Record<string, string> = {}): void {
  self.postMessage({ type: "status", label, busy, ...extra });
}

async function findWheelUrl(version: string, pythonVersion: string): Promise<string> {
  const url = `https://pypi.org/pypi/yaml-rs/${version}/json`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (error) {
    throw new Error(`PyPI lookup failed for ${url}`, { cause: error });
  }
  if (!resp.ok) {
    throw new Error(`PyPI lookup failed for ${url}: ${resp.status}`);
  }
  const data = await resp.json();
  const pythonTag = `cp${pythonVersion.replace(".", "")}`;
  const whl = (data.urls as { filename: string; url: string }[]).find(
    (u) => u.filename.includes(`-${pythonTag}-${pythonTag}-`) && u.filename.includes("_wasm32"),
  );
  if (!whl) {
    throw new Error(`No ${pythonTag} wasm32 wheel found for yaml-rs==${version}`);
  }
  return whl.url;
}

async function renderLatest(): Promise<void> {
  if (!pyodide || rendering) {
    return;
  }

  rendering = true;
  const source = latestYaml;
  status("Parsing YAML");
  pyodide.globals.set("yaml_input", source);

  try {
    const output = await pyodide.runPythonAsync(PARSE_CODE);
    self.postMessage({ type: "result", output, engineTone: "ready" });
  } catch (error) {
    self.postMessage({
      type: "error",
      output: String(error),
      engineBadge: "Runtime error",
      engineTone: "warn",
    });
  } finally {
    rendering = false;
    if (latestYaml !== source) {
      await renderLatest();
    } else {
      status("Idle", false);
    }
  }
}

async function boot(message: BootMessage): Promise<void> {
  try {
    latestYaml = message.yaml;
    const pyodideBase = `https://cdn.jsdelivr.net/pyodide/v${message.pyodideVersion}/full/`;

    status("Loading Pyodide", true, { engineBadge: `Pyodide ${message.pyodideVersion}` });
    let pyodideModule: PyodideModule;
    try {
      pyodideModule = (await import(
        /* @vite-ignore */ `${pyodideBase}pyodide.mjs`
      )) as PyodideModule;
    } catch (error) {
      throw new Error(`Pyodide module load failed for ${pyodideBase}pyodide.mjs`, {
        cause: error,
      });
    }

    pyodide = await pyodideModule.loadPyodide({ indexURL: pyodideBase });
    const pyVersion = await pyodide.runPythonAsync(
      "import sys; f'{sys.version_info.major}.{sys.version_info.minor}'",
    );
    status("Loading micropip", true, { configBadge: `Python ${pyVersion}` });
    await pyodide.loadPackage("micropip");

    status("Installing yaml-rs");
    const wheelUrl = await findWheelUrl(message.yamlRsVersion, pyVersion);
    try {
      await pyodide.runPythonAsync(`
import micropip
await micropip.install("${wheelUrl}")
`);
    } catch (error) {
      throw new Error(`yaml-rs wheel install failed for ${wheelUrl}`, { cause: error });
    }

    await renderLatest();
  } catch (error) {
    self.postMessage({
      type: "error",
      output: String(error),
      engineBadge: "Boot failed",
      engineTone: "warn",
    });
    status("Idle", false);
  }
}

self.addEventListener("message", ({ data }: MessageEvent<BootMessage | RenderMessage>) => {
  if (data.type === "boot") {
    void boot(data);
    return;
  }

  latestYaml = data.yaml;
  void renderLatest();
});
