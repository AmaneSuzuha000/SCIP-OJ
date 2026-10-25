# SCIP/LAB — concise interface QA

## Brief and evidence

The user asked to remove unnecessary secondary labels and descriptions and let the layout explain the structure. This is a scoped edit to the existing design. The course / extension purpose boundary remains the source of navigation and content ownership.

- Source: `docs/design-evidence/course-desktop.jpg` and `learning-desktop.jpg`, both 1348 × 926. The selected style reference remains `reference-learning.jpg`; its earlier copy is superseded by this request.
- Implementation: `concise-course-desktop.jpg` and `concise-learning-desktop.jpg`, both 1348 × 926, in `docs/design-evidence/`.
- Desktop state: anonymous, loaded course index and artwork, top of each route. Cloud browser CSS viewport 1363 × 936, DPR 1; source and implementation captures use the same content dimensions and need no scaling.
- Full paired inputs: `concise-course-comparison.jpg` and `concise-learning-comparison.jpg`, 2696 × 926, source left / implementation right, pasted at original size.
- Focused input: `concise-detail-comparison.jpg`, 2060 × 181. Original-size course-flow crops show the removal of the duplicated heading and step descriptions; padding aligns the unequal heights without scaling.
- Mobile: `concise-course-mobile.jpg` and `concise-learning-mobile.jpg`, 390 × 844 exact crops from cloud-browser screenshots of a 390 × 844 iframe. Content width 375 plus the native scrollbar; no horizontal overflow.

## Findings and comparison history

No actionable P0/P1/P2 differences were found in the first scoped comparison. The visible density changes are requested: shorter headings, single-line notebook rows, fewer sidebar captions, and four step names without repeated explanations. The original purpose split, teal actions, spacing system, illustration and icons remain intact.

An early phone capture caught an incomplete compositor frame for the resources button. The settled capture `concise-learning-mobile.jpg` shows its label and caret correctly; no speculative CSS fix was made.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts / typography | Existing families, CJK fallbacks, weights and sizes retained. Primary headings remain distinct from section headings and row titles. Shorter copy wraps cleanly on phones. |
| Spacing / layout | Sidebar groups use spacing and rules. Course workflows use four ordered names; notebook rows use problem IDs, titles and actions. The extension illustration's top margin was adjusted after reducing the hero copy. Both mobile navigation layouts remain complete. |
| Colors / tokens | White background, dark text, teal primary action and pale active navigation retained. No new color or badge system. |
| Image quality / assets | Existing workshop WebP and Phosphor assets retained. No replacement drawings, new raster assets or font substitutions. |
| Copy / content | Removed brand subtitle, decorative eyebrows, resource captions, generic page descriptions, redundant step text and notebook summaries. Kept concrete experiment goal, class access requirements, draft status, scoring distinction and detailed scoring disclosure. Button names use “练习评分 / 正式提交”. |

## Interaction and accessibility

- Cloud browser verified default teaching, extension switching, course problem list, P001 editor, and scoring disclosure expansion/collapse.
- Phone verified four course entries, three extension entries, purpose switching, and resources expansion/collapse. The extension menu exposes only extension resources.
- Both editor actions keep their existing IDs and handlers. Class state and formal submission restrictions retain their logic; no real student records were read or submitted.
- Named navigation landmarks, headings, field labels, accessible current state and skip link retained. Removing visible group captions does not remove navigation names.
- No application console errors in the reviewed editor session; extension-origin metadata errors were excluded.
- Local checks: UI DOM contract, purpose routing, four Python UI integration tests, JS syntax and whitespace checks passed. Repository CI runs the existing Chromium journey and full judge regressions before merge.

## Checklist

- [x] Compare before / after together at full and focused sizes.
- [x] Check desktop and phone layout.
- [x] Keep actionable status and scoring guidance.
- [x] Preserve course / extension ownership and navigation.

final result: passed
