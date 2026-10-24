# Course / learning spaces — design QA

## Evidence and comparison conditions

- Source visual truth: `docs/design-evidence/reference-learning.jpg`, a JPEG copy of the selected refined Product Design image (`exec-c1d21959-b3b4-4492-9bf3-cd361ca775ac.png`), 1487 × 1058 px. It is a generated visual reference, not an existing product screenshot.
- Browser implementation: `docs/design-evidence/learning-desktop.jpg`, 1348 × 926 px; `course-desktop.jpg` and `editor-desktop.jpg` at the same returned size.
- Actual preview: `http://terminal.local:4173/index.html#learn`, light theme, anonymous user, fully loaded illustration and question index.
- Desktop cloud browser CSS viewport: 1363 × 936, DPR 1. The screenshot API returned a 1348 × 926 bitmap. The comparison is not an exact 1440 px viewport claim. Source is uniformly resized to 1348 × 959, then the lower 33 px is cropped to match the implementation bitmap. No nonuniform stretching.
- Mobile: `docs/design-evidence/learning-mobile.jpg`, 390 × 844; an exact crop of a browser screenshot containing an unscaled 390 × 844 iframe, DPR 1, content width 375 px plus native scrollbar. No resized phone frame.
- Full-view paired evidence: `docs/design-evidence/learning-comparison.jpg` (source left, implementation right).
- Readable focused comparison: `docs/design-evidence/learning-detail-comparison.jpg` (same source/implementation crops, source left). Used to inspect headings, small step labels, spacing and artwork edges rather than passing from a scaled full-view board alone.

## Findings and iteration history

1. **[P2, fixed] Desktop task block was too tall and the illustration too small.**
   Evidence: `learning-desktop-before.jpg` compared with the source. The second exploration row was partly below the visible viewport, and the illustration sat too low. Fix: reduced the page/heading gaps, task heading line height, step/footer spacing, and enlarged/raised the actual WebP illustration. Post-fix evidence: `learning-desktop.jpg`, `learning-comparison.jpg`, `learning-detail-comparison.jpg`. Both exploration rows now appear in the captured desktop viewport without obscuring task copy or the primary action.
2. **[P2, fixed] The fourth mobile navigation entry required horizontal scrolling.**
   Evidence: `learning-mobile-before.jpg` cuts off “提交记录”. Fix: use four equal mobile navigation columns with icons above labels, and three columns for the course context. Post-fix evidence: `learning-mobile.jpg`; browser-measured right edges are 97.5, 186, 274.5 and 363 px within the 390 px viewport. All four primary entries and the more-resources control are visible.
3. **No remaining actionable P0/P1/P2 visual findings** in the compared states. Course overview, question editor and anonymous history were also inspected as supporting states rather than represented as pixels supplied by the source mock.

## Required fidelity surfaces

| Surface | Review result |
| --- | --- |
| Fonts / typography | Source uses a bold CJK sans hierarchy. Implementation retains Inter / Noto Sans SC / Microsoft YaHei / system fallbacks. Desktop page heading 44 px, task heading 40 px / 1.35; mobile 30 / 29 px. The intended two-line task heading, readable step labels and title/body hierarchy are retained. Font rasterization and exact generated-letter shapes vary; no truncation or collisions remain. |
| Spacing / layout rhythm | White header, narrow left rail, task-first main area, single main action and two flat exploration rows follow the source. Fixed excessive vertical gaps. Mobile deliberately collapses illustration and rearranges steps to 2 × 2; every primary navigation action stays visible. |
| Colors / tokens | Dark blue-green text, white surfaces, teal primary action and pale teal selection follow the source. Main action `#076a6c`, primary text `#132931`, selection `#e7f6f2`. Existing semantic grading colors remain controlled by server results. No decorative gradient or new card grid was introduced. |
| Image quality / assets | Actual 1536 × 1024 generated WebP, 121092 bytes; no CSS/SVG imitation of the reference artwork. Three independent rail-component inspection stations deliberately replace the concept's serial machining scene to reflect the teaching model. White fade, teal/gray palette, scale and sharpness checked in the paired views. Phosphor regular SVG files form one consistent icon family. |
| Copy / content | Course and learning labels are distinct and functional. Four learning steps, task, three case subjects and primary action match the approved framework. Real course enrollment and submission states replace concept-only content. Practice/experiment records are clearly separated from formal grades. |

## Interaction and accessibility checks

- Cloud browser: switched course → learning → records; verified mutually exclusive panels, contextual sidebars and navigation selection. Anonymous history shows a login prompt and no fabricated grades.
- Cloud browser: opened the question list and P001, verified full editor controls, then returned to course with the workspace hidden. Old problem hash links remain supported.
- Cloud browser: mobile course/learning switching, all four navigation entries, submission history and expanding more resources.
- Browser DOM confirms heading hierarchy, named navigation regions, `aria-current`, decorative image alt handling, labelled editor/search controls. Skip-to-content keeps the selected space and focuses main content; the main learning region has a stable accessible label even when its overview heading is hidden.
- Automated Chromium regression additionally exercises exam draft cancel/confirm, exactly one prompt for next-question navigation, delayed assignment responses after leaving the editor, records with problem/class context and server `passed` status, phone/tablet overflow, three simulation labs, real downloads and independent replay.
- Console: no application error entries in the cloud browser. Chrome extension metadata errors were excluded by their `chrome-extension://` source URL.

## Intentional differences and remaining coverage

- Concept-only sidebar duplication was replaced with existing modeling resources; unauthorized teacher navigation remains hidden. Step chevrons were omitted because the numbered ordered list already expresses sequence. These do not change the selected two-space framework.
- Exact font-file identity cannot be inferred from a generated image. System fallback rasterization is a P3 portability consideration, not an unresolved hierarchy or wrapping issue.
- Authenticated production grade rows were not read or created. The existing user ownership filter is retained; the metadata join follows existing foreign keys and the [official nesting syntax](https://supabase.com/docs/guides/database/joins-and-nesting). A read-only anonymous query was rejected with `42501` as expected by current table privileges. UI fixtures validate rendering separately from access control. This is not a claim of a signed-in end-to-end submission test.

## Implementation checklist

- [x] Compare opened source and browser output together.
- [x] Fix and recapture both P2 findings.
- [x] Check the five required fidelity surfaces and focused detail.
- [x] Verify core desktop/mobile navigation, records and editor states.
- [x] Retain scoring, authentication and backend authorization contracts.

final result: passed
