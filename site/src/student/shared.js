import {state} from './state.js';
export async function loadJSON(path) {
    const r = await fetch(new URL(path, state.BASE));
    if (!r.ok)
        throw new Error("加载失败: " + path);
    return r.json();
}
export async function loadText(path) {
    const r = await fetch(new URL(path, state.BASE));
    if (!r.ok)
        throw new Error("加载失败: " + path);
    return r.text();
}
export function getCodeValue() {
    return window.ScipOJEditor?.getValue() ?? document.getElementById("code").value;
}
export function setCodeValue(value) {
    if (window.ScipOJEditor)
        window.ScipOJEditor.setValue(value);
    else
        document.getElementById("code").value = value;
}
export function getPracticeProgress(id) {
    try {
        const raw = localStorage.getItem("scip-oj-practice:" + id);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
export function normalizeDifficulty(value) {
    const text = String(value || "").toLowerCase();
    if (["easy", "简单"].includes(text))
        return "easy";
    if (["hard", "困难"].includes(text))
        return "hard";
    return "medium";
}
export function publicSampleInstance(meta) {
    const seed = Number(meta.seed_base || 20261021);
    const instance = (meta.grader === "assignment"
        ? window.ScipOJAssignment?.genAssignment(seed)
        : window.ScipOJJudge?.genKnapsack(seed)) || {};
    const { optimal_value: unusedOracle, ...publicInstance } = instance;
    return publicInstance;
}
export function escapeHtml(s) {
    if (s == null)
        return "";
    return String(s).replace(/[&<>'"]/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
    }[c] || c));
}