<script setup lang="ts">
import { usePlayground } from "./playground";

const {
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
  outputCopied,
  renderError,
  startDrag,
  themeButtonLabel,
  toggleTheme,
  yamlInput,
  yamlCopied,
  syncYamlScroll,
  setSplitFromPointer,
} = usePlayground();
</script>

<template>
  <main class="page-shell">
    <header class="topbar">
      <div class="topbar-main">
        <div class="brand-block">
          <strong class="brand">yaml-rs</strong>
        </div>
        <div class="topbar-links">
          <a
            class="topbar-link"
            href="https://github.com/lava-sh/yaml-rs"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub"
            title="GitHub"
          >
            <img
              class="topbar-icon topbar-icon-dark"
              src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/github-light.svg"
              alt=""
              aria-hidden="true"
            />
            <img
              class="topbar-icon topbar-icon-light"
              src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/github.svg"
              alt=""
              aria-hidden="true"
            />
          </a>
          <a
            class="topbar-link"
            href="https://pypi.org/project/yaml-rs/"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="PyPI"
            title="PyPI"
          >
            <img
              class="topbar-icon"
              src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/pypi.svg"
              alt=""
              aria-hidden="true"
            />
          </a>
        </div>
      </div>
      <div class="topbar-side">
        <div class="toolbar-badges">
          <span class="badge" :data-tone="engineTone">{{ engineBadge }}</span>
          <span class="badge" :data-tone="configTone">{{ configBadge }}</span>
        </div>
        <button
          class="theme-btn"
          type="button"
          :aria-label="themeButtonLabel"
          role="switch"
          :aria-checked="themeButtonLabel === 'Switch to light'"
          :title="themeButtonLabel"
          @click="toggleTheme"
        >
          <span class="theme-check">
            <span class="theme-icon-wrap">
              <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12,18c-3.3,0-6-2.7-6-6s2.7-6,6-6s6,2.7,6,6S15.3,18,12,18zM12,8c-2.2,0-4,1.8-4,4c0,2.2,1.8,4,4,4c2.2,0,4-1.8,4-4C16,9.8,14.2,8,12,8z"
                />
                <path
                  d="M12,4c-0.6,0-1-0.4-1-1V1c0-0.6,0.4-1,1-1s1,0.4,1,1v2C13,3.6,12.6,4,12,4z"
                />
                <path
                  d="M12,24c-0.6,0-1-0.4-1-1v-2c0-0.6,0.4-1,1-1s1,0.4,1,1v2C13,23.6,12.6,24,12,24z"
                />
                <path
                  d="M5.6,6.6c-0.3,0-0.5-0.1-0.7-0.3L3.5,4.9c-0.4-0.4-0.4-1,0-1.4s1-0.4,1.4,0l1.4,1.4c0.4,0.4,0.4,1,0,1.4C6.2,6.5,5.9,6.6,5.6,6.6z"
                />
                <path
                  d="M19.8,20.8c-0.3,0-0.5-0.1-0.7-0.3l-1.4-1.4c-0.4-0.4-0.4-1,0-1.4s1-0.4,1.4,0l1.4,1.4c0.4,0.4,0.4,1,0,1.4C20.3,20.7,20,20.8,19.8,20.8z"
                />
                <path d="M3,13H1c-0.6,0-1-0.4-1-1s0.4-1,1-1h2c0.6,0,1,0.4,1,1S3.6,13,3,13z" />
                <path d="M23,13h-2c-0.6,0-1-0.4-1-1s0.4-1,1-1h2c0.6,0,1,0.4,1,1S23.6,13,23,13z" />
                <path
                  d="M4.2,20.8c-0.3,0-0.5-0.1-0.7-0.3c-0.4-0.4-0.4-1,0-1.4l1.4-1.4c0.4-0.4,1-0.4,1.4,0s0.4,1,0,1.4l-1.4,1.4C4.7,20.7,4.5,20.8,4.2,20.8z"
                />
                <path
                  d="M18.4,6.6c-0.3,0-0.5-0.1-0.7-0.3c-0.4-0.4-0.4-1,0-1.4l1.4-1.4c0.4-0.4,1-0.4,1.4,0s0.4,1,0,1.4l-1.4,1.4C18.9,6.5,18.6,6.6,18.4,6.6z"
                />
              </svg>
              <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12.1,22c-0.3,0-0.6,0-0.9,0c-5.5-0.5-9.5-5.4-9-10.9c0.4-4.8,4.2-8.6,9-9c0.4,0,0.8,0.2,1,0.5c0.2,0.3,0.2,0.8-0.1,1.1c-2,2.7-1.4,6.4,1.3,8.4c2.1,1.6,5,1.6,7.1,0c0.3-0.2,0.7-0.3,1.1-0.1c0.3,0.2,0.5,0.6,0.5,1c-0.2,2.7-1.5,5.1-3.6,6.8C16.6,21.2,14.4,22,12.1,22zM9.3,4.4c-2.9,1-5,3.6-5.2,6.8c-0.4,4.4,2.8,8.3,7.2,8.7c2.1,0.2,4.2-0.4,5.8-1.8c1.1-0.9,1.9-2.1,2.4-3.4c-2.5,0.9-5.3,0.5-7.5-1.1C9.2,11.4,8.1,7.7,9.3,4.4z"
                />
              </svg>
            </span>
          </span>
        </button>
      </div>
    </header>

    <section class="workbench">
      <section class="split">
        <article class="panel">
          <header class="panel-head">
            <h2>YAML v1.2</h2>
            <button
              class="copy-btn"
              :class="{ copied: yamlCopied }"
              type="button"
              aria-label="Copy YAML"
              title="Copy YAML"
              @click="copyText(yamlInput, 'yaml')"
            >
              <svg class="copy-icon copy-idle" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v4" />
                <path d="M21 14H11" />
                <path d="m15 10-4 4 4 4" />
              </svg>
              <svg class="copy-icon copy-done" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v4" />
                <path d="m9 14 2 2 4-4" />
              </svg>
            </button>
          </header>

          <div class="editor-wrap">
            <pre ref="lineNumbersRef" class="yaml-lines" aria-hidden="true"></pre>
            <pre ref="highlightRef" class="yaml-highlight" aria-hidden="true"></pre>
            <textarea
              ref="inputRef"
              v-model="yamlInput"
              spellcheck="false"
              aria-label="YAML input"
              @scroll="syncYamlScroll"
            ></textarea>
          </div>
        </article>

        <div
          ref="dividerRef"
          class="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          @pointerdown.prevent="
            ($event) => {
              startDrag();
              setSplitFromPointer($event.clientX, $event.clientY);
            }
          "
        ></div>

        <article class="panel panel-output" :class="{ 'is-busy': busy }">
          <header class="panel-head">
            <h2>Python</h2>
            <button
              class="copy-btn"
              :class="{ copied: outputCopied }"
              type="button"
              aria-label="Copy output"
              title="Copy output"
              @click="copyText(output, 'output')"
            >
              <svg class="copy-icon copy-idle" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v4" />
                <path d="M21 14H11" />
                <path d="m15 10-4 4 4 4" />
              </svg>
              <svg class="copy-icon copy-done" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v4" />
                <path d="m9 14 2 2 4-4" />
              </svg>
            </button>
          </header>

          <div class="output-wrap">
            <pre :class="{ err: renderError }">{{ output }}</pre>
            <div class="py-status" aria-live="polite" :aria-hidden="busy ? 'false' : 'true'">
              <span class="py-spinner" aria-hidden="true"></span>
              <span>{{ busyLabel }}</span>
            </div>
          </div>
        </article>
      </section>
    </section>
  </main>
</template>
