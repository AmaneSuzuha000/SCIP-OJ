/**
 * Progressive coding editor: CodeMirror 5 enhancement with native textarea fallback.
 * No code leaves the browser except through explicit formal submission.
 */
(() => {
  const textarea = document.getElementById("code");
  let editor = null;
  let initialized = false;

  function getValue() { return editor ? editor.getValue() : (textarea?.value ?? ""); }
  function setValue(value) {
    if (!textarea) return;
    textarea.value = String(value ?? "");
    if (editor) editor.setValue(textarea.value);
  }
  function focus() { if (editor) editor.focus(); else textarea?.focus(); }
  function refresh() { if (editor) requestAnimationFrame(() => editor?.refresh()); }
  function init() {
    if (initialized || !textarea) return;
    initialized = true;
    if (typeof window.CodeMirror === "function") {
      try {
        editor = window.CodeMirror.fromTextArea(textarea, {
          mode: "python", lineNumbers: true, indentUnit: 4,
          tabSize: 4, indentWithTabs: false, lineWrapping: false,
          autofocus: false, viewportMargin: 12,
          extraKeys: {
            "Ctrl-Enter": () => document.getElementById("btn-grade")?.click(),
            "Cmd-Enter": () => document.getElementById("btn-grade")?.click(),
            "Shift-Ctrl-Enter": () => document.getElementById("btn-submit-formal")?.click(),
            "Shift-Cmd-Enter": () => document.getElementById("btn-submit-formal")?.click(),
            "Tab": cm => cm.execCommand("insertSoftTab"),
          }
        });
        editor.on("change", () => {
          textarea.value = editor.getValue();
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        editor.getWrapperElement().setAttribute("aria-label", "Python 代码编辑区");
      } catch (error) {
        console.warn("[Editor] Enhanced editor unavailable; keeping textarea:", error);
        editor = null;
      }
    }
    const font = document.getElementById("editor-font-size");
    const saved = (() => {
      try { return localStorage.getItem("scipoj:editor-font"); } catch { return null; }
    })();
    if (font) {
      if (saved && [...font.options].some(o => o.value === saved)) font.value = saved;
      font.addEventListener("change", () => {
        setFontSize(font.value);
        try { localStorage.setItem("scipoj:editor-font", font.value); } catch { /* storage disabled */ }
      });
      setFontSize(font.value);
    }
    refresh();
  }
  function setFontSize(px) {
    const numeric = Math.max(12, Math.min(20, Number(px) || 14));
    if (editor) {
      editor.getWrapperElement().style.fontSize = numeric + "px";
      refresh();
    } else if (textarea) {
      textarea.style.fontSize = numeric + "px";
    }
  }
  window.ScipOJEditor = {
    dispose:()=>{editor?.toTextArea();editor=null;initialized=false;},
    init, getValue, setValue, focus, refresh,
    getInputElement: () => editor?.getWrapperElement() || textarea,
  };
})();
