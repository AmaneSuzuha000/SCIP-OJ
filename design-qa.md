# SCIP/LAB — restore visual hierarchy

## Brief and evidence

The user clarified that concise copy should retain the selected visual design. The previous reduction flattened headlines and experimental content too aggressively. This correction restores the earlier typography, content depth and illustration composition while keeping redundant section labels absent and preserving the teaching / extension boundary.

- Style truth: `docs/design-evidence/reference-learning.jpg` (1487 × 1058), with purpose-corrected source captures `course-desktop.jpg` and `learning-desktop.jpg` (1348 × 926 each).
- Previous over-reduction: `concise-course-desktop.jpg` and `concise-learning-desktop.jpg` in the same directory.
- Current implementation: `visual-course-desktop.jpg` and `visual-learning-desktop.jpg` (1348 × 926 each).
- Desktop viewport: 1363 × 936 CSS px, DPR 1; source and implementation capture content dimensions match. Anonymous, loaded index and illustration, top of each route.
- Full paired evidence: `visual-learning-comparison.jpg`, 2696 × 926, original source left / current implementation right. Images pasted at original size without scaling.
- Focused evidence: `visual-course-detail.jpg`, 2050 × 130, original-size crops of the P001 row. The crops follow the row's changed page position and demonstrate restored number, title, supporting detail and action hierarchy.
- Mobile: `visual-learning-mobile.jpg`, 390 × 844 exact crop of a cloud-browser capture of a 390 × 844 iframe, DPR 1. Content width 375 plus native scrollbar. Illustration renders at 300 × 200 CSS px and is fully loaded and visible.

## Findings and comparison history

1. **[P1, fixed] Copy reduction also weakened the selected visual hierarchy.** The concise captures replace the two-line feature headline with a short title and reduce course experiments to nearly uniform single-line rows. Current captures restore the original display headline, large course numbers, separate problem IDs, subject-specific experiment descriptions and model summaries. Generic page subtitles, sidebar group captions and decorative eyebrows remain absent.
2. **[P2, fixed] Phone layout omitted the illustration entirely.** Earlier phone captures and the inherited responsive rule hide the artwork below 1050 px. The revised layout retains the same real asset below the primary action, with a 300 px maximum width on phones. Current phone evidence shows the complete three-station image, reachable action and all three extension navigation entries; measured document width equals client width.

No actionable P0/P1/P2 findings remain under the corrected brief. Intentional differences from the source are concise navigation copy, fewer repeated labels, and visible phone artwork.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts / typography | Original font system and weights restored. Desktop feature uses the selected two-line 40 px headline; phone uses 29 px. Course rows again distinguish large sequence numbers, small problem IDs, titles and model details. |
| Spacing / layout | Original section rhythm and course row proportions restored. Feature artwork top margin is adjusted to the shorter supporting copy. Phone artwork follows the action, keeping the main task accessible without hiding the illustration. |
| Colors / tokens | Existing white, dark text, teal actions, pale selected navigation and amber secondary icon accent retained. |
| Image quality / assets | Original 1536 × 1024 workshop WebP remains unchanged, proportionally displayed without cropping. Original Phosphor icons remain unchanged. No substitute artwork, drawn imitations or new raster assets. |
| Copy / content | Course / extension ownership retained. Concise “练习评分 / 正式提交” buttons and access requirements retained. Restored descriptions identify model content rather than explaining the surrounding layout. |

## Interaction and accessibility

- Cloud browser reviewed both desktop spaces, phone purpose switching, four course navigation entries, three extension entries, and resources expansion/collapse.
- Phone content measures 375 / 375 px scroll / client width; illustration measured 300 × 200 px and complete.
- No application console errors in the reviewed desktop session; browser-extension metadata errors excluded.
- Existing navigation names, heading relationships, current-link states, field labels, draft guards and submission handlers retained. No authentication or student records changed.
- Local UI contract and purpose routing regressions passed. Existing Chromium journey and complete judge CI run before merge.

## Checklist

- [x] Compare original and rendered implementation together.
- [x] Inspect headline, image composition and detailed course typography.
- [x] Restore phone illustration and check width / navigation.
- [x] Keep concise operational copy and purpose boundaries.

final result: passed
