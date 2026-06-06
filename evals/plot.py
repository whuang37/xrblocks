#!/usr/bin/env python3
"""Render result charts for the eval. Reads from
evals/results/<model>/{with-skill,without-skill,judge}/ for every model dir
present and emits png files under evals/charts/.

Usage:
  python evals/plot.py
"""
from __future__ import annotations

import json
import pathlib
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
RESULTS = ROOT / "evals" / "results"
CHARTS = ROOT / "evals" / "charts"

MODEL_COLORS_WITH = {
    "gemini-2.5-pro": "#0b8043",
    "gemini-2.5-flash": "#1a73e8",
}
MODEL_COLORS_WITHOUT = {
    "gemini-2.5-pro": "#c5221f",
    "gemini-2.5-flash": "#f9ab00",
}


def discover_models() -> list[str]:
    if not RESULTS.exists():
        return []
    return sorted(
        d.name for d in RESULTS.iterdir()
        if d.is_dir() and (d / "with-skill").exists()
    )


def load_model(model: str) -> tuple[dict, dict, dict]:
    base = RESULTS / model
    w = {f.stem: json.loads(f.read_text()) for f in sorted((base / "with-skill").glob("*.json"))}
    wo = {f.stem: json.loads(f.read_text()) for f in sorted((base / "without-skill").glob("*.json"))}
    judges = {}
    jdir = base / "judge"
    if jdir.exists():
        for f in jdir.glob("*.json"):
            try:
                text = f.read_text()
                if not text.strip():
                    continue
                judges[f.stem] = json.loads(text)
            except json.JSONDecodeError:
                continue
    return w, wo, judges


def plot_composite_multi_model(tasks: list[str], by_model: dict) -> pathlib.Path:
    n_models = len(by_model)
    x = np.arange(len(tasks))
    group_width = 0.85
    bar_width = group_width / (2 * n_models)

    fig, ax = plt.subplots(figsize=(13, 5))
    for i, (model, (w, wo, _)) in enumerate(by_model.items()):
        w_vals = [w.get(t, {}).get("composite", 0) for t in tasks]
        wo_vals = [wo.get(t, {}).get("composite", 0) for t in tasks]
        offset_w = (i * 2) * bar_width - group_width / 2 + bar_width / 2
        offset_wo = (i * 2 + 1) * bar_width - group_width / 2 + bar_width / 2
        ax.bar(
            x + offset_w, w_vals, bar_width,
            label=f"{model} w/",
            color=MODEL_COLORS_WITH.get(model, "#666"),
        )
        ax.bar(
            x + offset_wo, wo_vals, bar_width,
            label=f"{model} w/o",
            color=MODEL_COLORS_WITHOUT.get(model, "#aaa"),
        )

    ax.set_xticks(x)
    ax.set_xticklabels(tasks, rotation=30, ha="right")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("composite score (0-1)")
    ax.set_title("xrblocks skill eval — composite score per task, with vs without skill, across models")
    ax.legend(fontsize=8, ncol=2)
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    out = CHARTS / "composite_per_task.png"
    fig.savefig(out, dpi=144)
    plt.close(fig)
    return out


def plot_judge_multi_model(tasks: list[str], by_model: dict) -> pathlib.Path | None:
    have_judges = any(j for _, _, j in by_model.values())
    if not have_judges:
        return None

    n_models = len(by_model)
    x = np.arange(len(tasks))
    group_width = 0.85
    bar_width = group_width / (2 * n_models)

    fig, ax = plt.subplots(figsize=(13, 5))
    for i, (model, (_, _, judges)) in enumerate(by_model.items()):
        w_idiom = [judges.get(f"{t}-with-skill", {}).get("idiomatic_xrblocks", 0) for t in tasks]
        wo_idiom = [judges.get(f"{t}-without-skill", {}).get("idiomatic_xrblocks", 0) for t in tasks]
        offset_w = (i * 2) * bar_width - group_width / 2 + bar_width / 2
        offset_wo = (i * 2 + 1) * bar_width - group_width / 2 + bar_width / 2
        ax.bar(
            x + offset_w, w_idiom, bar_width,
            label=f"{model} w/",
            color=MODEL_COLORS_WITH.get(model, "#666"),
        )
        ax.bar(
            x + offset_wo, wo_idiom, bar_width,
            label=f"{model} w/o",
            color=MODEL_COLORS_WITHOUT.get(model, "#aaa"),
        )

    ax.set_xticks(x)
    ax.set_xticklabels(tasks, rotation=30, ha="right")
    ax.set_ylim(0, 5.5)
    ax.set_ylabel("judge `idiomatic_xrblocks` (1-5, judged by gemini-2.5-pro)")
    ax.set_title("llm judge: idiomatic xrblocks usage, with vs without skill, across models")
    ax.legend(fontsize=8, ncol=2)
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    out = CHARTS / "judge_per_task.png"
    fig.savefig(out, dpi=144)
    plt.close(fig)
    return out


def plot_metric_grid(tasks: list[str], w: dict, wo: dict, model: str) -> pathlib.Path:
    metrics = ["import_match", "api_match", "forbidden_clean", "parse_ok"]
    fig, axes = plt.subplots(2, 2, figsize=(12, 8))
    for ax, m in zip(axes.flat, metrics):
        x = np.arange(len(tasks))
        width = 0.38
        w_vals = [w.get(t, {}).get(m, 0) for t in tasks]
        wo_vals = [wo.get(t, {}).get(m, 0) for t in tasks]
        ax.bar(x - width / 2, w_vals, width, label="with", color="#34a853")
        ax.bar(x + width / 2, wo_vals, width, label="without", color="#ea4335")
        ax.set_title(m)
        ax.set_xticks(x)
        ax.set_xticklabels([t.split("-")[0] for t in tasks], rotation=30, ha="right", fontsize=8)
        ax.set_ylim(0, 1.05)
        ax.grid(axis="y", alpha=0.3)
    axes[0, 0].legend()
    fig.suptitle(f"per-metric breakdown ({model})", y=0.99)
    fig.tight_layout()
    out = CHARTS / f"metrics_grid_{model}.png"
    fig.savefig(out, dpi=144)
    plt.close(fig)
    return out


def main() -> int:
    CHARTS.mkdir(parents=True, exist_ok=True)
    models = discover_models()
    if not models:
        print("no model result dirs found under evals/results/", file=sys.stderr)
        return 1

    by_model = {m: load_model(m) for m in models}

    # Tasks = union across all models.
    tasks = sorted({t for m in models for t in by_model[m][0]})

    out1 = plot_composite_multi_model(tasks, by_model)
    print(f"wrote {out1}")

    out2 = plot_judge_multi_model(tasks, by_model)
    if out2:
        print(f"wrote {out2}")

    for m in models:
        w, wo, _ = by_model[m]
        out3 = plot_metric_grid(tasks, w, wo, m)
        print(f"wrote {out3}")

    out4 = plot_prompt_style_breakdown(by_model)
    if out4:
        print(f"wrote {out4}")

    return 0


def plot_prompt_style_breakdown(by_model: dict) -> pathlib.Path | None:
    ENG = {
        "ai-describe-camera", "depth-occlusion", "gestures-thumbs-up",
        "hands-pinch-spawn", "modelviewer-gltf", "netblocks-presence",
        "physics-falling-cube", "sound-spatial-audio", "ui-button-hud",
        "world-plane-detection",
    }
    CANVAS_PREFIX = "canvas-"

    rows = []
    for model, (w, wo, _) in by_model.items():
        for label, picker in [
            ("engineer-spec", lambda t: t in ENG),
            ("canvas-faithful", lambda t: t.startswith(CANVAS_PREFIX)),
        ]:
            tasks = [t for t in w if picker(t)]
            if not tasks:
                continue
            ws = [w[t]["composite"] for t in tasks if t in w]
            wos = [wo[t]["composite"] for t in tasks if t in wo]
            n = min(len(ws), len(wos))
            if n == 0:
                continue
            rows.append({
                "model": model,
                "style": label,
                "with": sum(ws) / n,
                "without": sum(wos) / n,
                "delta": sum(ws) / n - sum(wos) / n,
                "n": n,
            })

    if not rows:
        return None

    fig, ax = plt.subplots(figsize=(10, 5))
    x = np.arange(len(rows))
    width = 0.38
    ax.bar(x - width / 2, [r["with"] for r in rows], width,
           label="with skill", color="#34a853")
    ax.bar(x + width / 2, [r["without"] for r in rows], width,
           label="without skill", color="#ea4335")
    ax.set_xticks(x)
    ax.set_xticklabels(
        [f"{r['model'].replace('gemini-2.5-', '')}\n{r['style']}" for r in rows],
        fontsize=9,
    )
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("mean composite score")
    ax.set_title("skill effect by model and prompt style")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    for i, r in enumerate(rows):
        ax.text(i - width / 2, r["with"] + 0.01, f"{r['with']:.2f}", ha="center", fontsize=8)
        ax.text(i + width / 2, r["without"] + 0.01, f"{r['without']:.2f}", ha="center", fontsize=8)
        ax.text(i, -0.07, f"delta {r['delta']:+.2f}", ha="center", fontsize=9, fontweight="bold")
    fig.tight_layout()
    out = CHARTS / "prompt_style_breakdown.png"
    fig.savefig(out, dpi=144)
    plt.close(fig)
    return out


if __name__ == "__main__":
    sys.exit(main())
