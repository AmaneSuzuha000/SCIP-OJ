# Teaching and extension learning — scoped design QA

## Brief and evidence

The user corrected the product boundary: original course teaching / programming assignments / grades must be separated from later open cases and advanced resources. This supersedes the previous “course information / combined learning workbench” split; the selected visual system is retained.

- Source style truth: `docs/design-evidence/reference-learning.jpg`, 1487 × 1058, copied from the selected Product Design image. Its combined-workbench labels are superseded by the user's correction; it remains the layout, typography and asset direction.
- Browser implementation: `course-desktop.jpg` and `learning-desktop.jpg` in `docs/design-evidence/`, 1348 × 926. CSS viewport 1363 × 936, DPR 1, anonymous state, loaded index and illustration.
- Full paired input: `docs/design-evidence/purpose-learning-comparison.jpg`, source left / current extension learning right. Source uniformly resized to 1348 × 959, then cropped by 33 px at the bottom; no nonuniform scaling.
- Focused paired input: `docs/design-evidence/purpose-detail-comparison.jpg`, readable 1:1 crops of the same heading, task copy, steps and artwork edges.
- Mobile: `teaching-mobile.jpg` and `learning-mobile.jpg`, 390 × 844 exact crops from cloud-browser captures of an unscaled 390 × 844 iframe, DPR 1; content width 375 plus native scrollbar.
- Preview: `http://terminal.local:4173/index.html` defaults to teaching; `#learn` opens extension learning.

## Findings and comparison history

1. **[P1, fixed] Purpose ownership was wrong.** Earlier workbench screenshots show simulation cases, coding and submissions in the same sidebar, with cases also duplicated in course information. The editor, question list and history now physically belong to `#course-space`, the default area. Original P001/P002 modeling notebooks stay there. Extension owns three simulations, four advanced notebooks and official examples. It has its own navigation, guide and footer, without course authentication, teacher entry, assignment or grade controls. Current desktop/mobile evidence and DOM ownership checks confirm this correction.
2. **[P2, fixed] Extension resource label wrapped to a single final character.** Evidence: `purpose-learning-before.jpg`. Shortened the sidebar label to “官方建模示例”; the destination retains SCIP/Gurobi names. Post-fix: `learning-desktop.jpg` and the current paired view show one-line navigation.
3. **[P2, previously fixed] Desktop task block too tall / illustration too small.** Earlier evidence: `learning-desktop-before.jpg`. Reduced gaps and enlarged the real artwork; both secondary case rows remain visible in the current desktop capture.
4. **[P2, previously fixed] Fourth mobile navigation entry clipped.** Earlier evidence: `learning-mobile-before.jpg`. Current teaching uses four equal columns; extension uses three. Both current phone captures show all primary entries without horizontal navigation scrolling.

No actionable P0/P1/P2 visual findings remain in the reviewed main UI states.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts / typography | Inter / Noto Sans SC / Microsoft YaHei / system fallbacks retained. Desktop heading 44 px, task 40 px / 1.35; phone 30/29 px. Bold CJK hierarchy and two-line task title retained; focused comparison checks readable small step labels. Exact generated-font glyphs and platform rasterization vary (P3 portability). |
| Spacing / layout | White header, narrow rail, teal primary action and flat exploration rows retained. Teaching reuses the same components for its banner, assignment action and four-step workflow. Changed content density follows the corrected purpose. Mobile primary CTA and navigation remain reachable. |
| Colors / tokens | White surface, text `#132931`, primary `#076a6c`, selection `#e7f6f2`. Course authentication and the extension “开放学习” indicator intentionally differ by purpose. |
| Assets / image quality | Existing 1536 × 1024 WebP retained: three independent rail-component inspection stations, sharp with a white fade. No CSS or handcrafted SVG imitation. Original Phosphor regular icon files retained. Course overview intentionally uses its teaching workflow instead of the extension illustration. |
| Copy / content | Course owns班级、P001/P002、提交、成绩；extension owns open cases and 03–06 notebooks. Cases return to extension, teachers return to teaching, extension docs have their own navigation. New labels and removed cross-purpose actions implement the user's correction. |

## Interaction and accessibility

- Cloud browser verified default teaching, extension switching, hidden course/auth panels, return to question list and genuine anonymous submission prompt. DOM confirms no assignment/history links inside extension content.
- Cloud browser verified four mobile teaching entries, three extension entries, purpose switching and expansion/collapse of extension resources.
- Chromium regressions cover purpose boundaries, legacy bookmarks, exam draft cancel/confirm and one prompt per switch, delayed assignment responses, server `passed` rendering, responsive editor, extension guide navigation, three labs, downloads and independent replay.
- Named regions/navigation, current-link state, skip-to-content focus and field labels retained. Artwork is decorative for assistive technology.
- Cloud-browser main UI console has no application errors. Extension metadata errors are excluded by their `chrome-extension://` source.

## Runtime repair and release checks

An existing JupyterLite blank page was reproduced: its loader fetches root `index.html` and expects `jupyter-config-data`, removed when the custom homepage was installed. The build now copies generated JSON configuration into the shell. Three regressions cover configuration preservation, failing without writing when data is absent, and build ordering. The merge was verified against the actual public generated `lite.html` (its empty root config `{}` is preserved correctly).

Notebook links target existing files with the [official path/mode parameters](https://jupyterlite.readthedocs.io/en/stable/howto/configure/urls.html). Live Lab opening is checked after the Pages build; this pre-release visual report does not claim a signed-in grade submission or notebook execution test. Scoring, database schema and authorization are unchanged.

## Checklist

- [x] Source and browser output compared together, including focused detail.
- [x] Correct purpose ownership, contextual navigation and default entry.
- [x] Fix sidebar wrapping and recapture.
- [x] Inspect desktop/mobile states and controls.
- [x] Retain teaching contracts and add Jupyter build regression coverage.

final result: passed
