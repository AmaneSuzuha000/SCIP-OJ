#!/usr/bin/env python3
"""Offline, privacy-preserving first-pass review of Python OJ submissions.

Input: JSON list [{id, user_id, assignment_id, code_text}, ...]
Output: candidate pairs only, NEVER an automatic cheating accusation.

Examples:
  python scripts/audit_similarity.py submissions.json --threshold 0.72
  python scripts/audit_similarity.py submissions.json --template problems/P001_knapsack/template.py
Notes:
- Compare within the same assignment, across different users.
- Normalize identifiers and literals; discard comments and shared template n-grams.
- Any high score can be a false positive from common solutions or scaffolding.
"""
import argparse
import hashlib
import io
import json
import keyword
from pathlib import Path
import tokenize
from typing import Any


def tokens(source: str) -> list[str]:
    out = []
    try:
        items = tokenize.generate_tokens(io.StringIO(source).readline)
        for item in items:
            if item.type in {tokenize.COMMENT, tokenize.ENCODING,
                             tokenize.NL, tokenize.NEWLINE, tokenize.INDENT,
                             tokenize.DEDENT, tokenize.ENDMARKER}:
                continue
            if item.type == tokenize.NAME:
                out.append(item.string if keyword.iskeyword(item.string) else "IDENT")
            elif item.type == tokenize.NUMBER:
                out.append("NUMBER")
            elif item.type == tokenize.STRING:
                out.append("STRING")
            else:
                out.append(item.string)
    except (tokenize.TokenError, IndentationError):
        # Malformed code is not comparable; the judge handles syntax failures.
        return []
    return out


def grams(source: str, width: int = 7) -> set[tuple[str, ...]]:
    items = tokens(source)
    return {tuple(items[i:i+width]) for i in range(max(0, len(items) - width + 1))}


def candidates(submissions: list[dict[str, Any]], threshold: float = 0.72,
               template_code: str = "") -> list[dict[str, Any]]:
    common = grams(template_code) if template_code else set()
    entries = []
    for sub in submissions:
        text = sub.get("code_text")
        if not isinstance(text, str) or not text.strip():
            continue
        entries.append((sub, hashlib.sha256(text.encode("utf-8")).hexdigest(),
                        grams(text) - common))

    ranked = []
    for i, (first, first_hash, left) in enumerate(entries):
        for second, second_hash, right in entries[i + 1:]:
            if not first.get("assignment_id") or first["assignment_id"] != second.get("assignment_id"):
                continue
            if not first.get("user_id") or not second.get("user_id") or first["user_id"] == second["user_id"]:
                continue
            exact = first_hash == second_hash
            union = left | right
            similarity = len(left & right) / len(union) if union else 0.0
            # Trivial solutions can share syntax by coincidence. Exact code
            # matches are still reviewable but not conclusive.
            if exact or (len(left) >= 8 and len(right) >= 8 and similarity >= threshold):
                ranked.append({
                    "assignment_id": first["assignment_id"],
                    "submission_a": first.get("id"),
                    "submission_b": second.get("id"),
                    "same_code_sha256": exact,
                    "normalized_token_7gram_jaccard": round(similarity, 4),
                    "review_status": "manual_review_only",
                })
    return sorted(ranked, key=lambda r: (not r["same_code_sha256"],
                                         -r["normalized_token_7gram_jaccard"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Teacher-authorized JSON export")
    parser.add_argument("--template", type=Path, help="Starter template to discount")
    parser.add_argument("--threshold", type=float, default=0.72)
    args = parser.parse_args()
    if not (0 < args.threshold <= 1):
        parser.error("--threshold must be in (0, 1]")
    records = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        parser.error("Input must be a JSON array")
    template = args.template.read_text(encoding="utf-8") if args.template else ""
    output = {
        "candidate_pairs": candidates(records, args.threshold, template),
        "input_submissions": len(records),
        "notice": "Similarity is a review lead only. Shared templates, common algorithms, and collaboration policies can produce false positives. Never automatically penalize.",
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
