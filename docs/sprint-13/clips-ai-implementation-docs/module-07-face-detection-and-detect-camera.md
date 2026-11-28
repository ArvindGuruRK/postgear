# Module 07: Face Detection And Detect Camera

> **Sprint 13, Clips AI** | Status: Done, except the real wide-shot check (2026-11-26) | Size: L (one full session)
> **Depends on**: [Module 01](module-01-media-service-foundations.md)
> **Stories**: CA-4.1; foundations for CA-4.2
> **Next**: [Module 08](module-08-auto-reframe.md) (Auto-Reframe)

## Goal

After this module PostGear can say where faces are in a stretch of video, as boxes over time grouped into people, without ever knowing who anyone is. On top of that sits the first feature that uses it: **Detect Camera** in the Layouts tab, which finds a streamer's face camera (a small face that stays in one place) and puts the Camera box on it in one press.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) section 6.
- User stories: Journey B step 3; CA-4.1; CA-10.3; section 5 (no face camera).
- Sprint doc: What The Research Settled (item 7); Jobs (FACES).
- Research: [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md), the face section: which MediaPipe detector and model, the sampling rate and size, that detection is not tracking so matching boxes into people is ours, the face-camera heuristic. [`02-libraries.md`](../research/02-libraries.md), the mediapipe and OpenCV rows and their install traps. [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md), face data and privacy (boxes only, deleted with the video, "needs a legal read").
- Code: Module 01's contract pattern; Module 06's decode loop if built; Sprint 12 Module 10 (`layout/`, the Camera area, crop boxes); `packages/video-engine/src/geometry.ts`.

## Design

### 1. The Face File

- Contract: `mediaPyDetectFaces` in `{ version, proxyKey, ranges, sampleFps: 5, maxWidth: 640 }` out `{ facesKey, sampled, found }`.
- The file (a gzipped JSON, a `ClipAsset` of kind `FACE_TRACKS` with `meta { fromMs, toMs, sampleFps }`): `{ version, sampleFps, frames: [{ t, boxes: [{ x, y, w, h, score }] }] }` with boxes as fractions of the picture. Nothing else: no landmarks, no embeddings, no cropped pictures, no names. A test fails if the schema gains another field.
- Python `services/faces.py`: one forward decode of the light copy at 5 pictures a second, scaled to at most 640 px wide; the detector research 06 names (the short-range face model through MediaPipe's Tasks API), with a lowered threshold so partly turned faces are kept and a minimum box size so background posters are not. Heartbeat per chunk. The model file ships in the image (it is small); the simulated provider reads recorded boxes beside the `two-speakers` and stream samples.
- Run a short real check on a wide two-person shot during this module (with Arvind's OK), because a reference project reported the long-range model failing under the Tasks API: if faces far from the camera are missed, record it and what was changed.

### 2. People From Boxes (`packages/video-engine/src/reframe/people.ts`, pure)

Detection gives boxes per picture; a person is a chain of boxes through time.

- `linkPeople(frames)`: greedy matching between successive pictures by overlap and distance, with a short memory so a face that vanishes for under a second (a turned head, a hand) is rejoined. Returns `Person[]`: `{ id, from, to, boxes: [{ t, rect }], avgSize, coverage }`. Chains shorter than two seconds are dropped as noise.
- `smoothBoxes(person)`: a light filter over each person's boxes so jitter does not reach the crop.
- These run in the browser as well as on the server: the editor loads the face file once and computes people locally.
- Tests with made-up frames: two people side by side stay two people; a one-second gap is bridged; a three-second gap makes a new chain only if the box reappears elsewhere; jitter is reduced.

### 3. Finding A Face Camera (`reframe/facecam.ts`, pure)

`findFaceCamera(people, videoSize)`: a face camera is a person whose box stays almost still (its centre moves less than a small fraction of the picture), is small (under about a fifth of the picture's height), sits in the outer third of the picture, and is present for most of the stretch. If one qualifies, return a crop: the face's box grown to include head and shoulders (about three times the face's height, a little more below than above), shaped to the Camera area's frame, clamped to the picture, and snapped to the picture's edge when close (overlays usually sit in a corner). If several qualify, the most constant one wins. If none: null.

Tests: a corner camera is found; a full-frame talking head is not a face camera; a moving face is not; two cameras picks the steadier.

### 4. The Job And The Routes

- `ClipJobKind` gains `FACES`; `ClipAssetKind` gains `FACE_TRACKS` (`prisma-change`).
- `POST /clips/:clipId/faces`: finds the stretch the clip plays (plus handles), reuses a face file that already covers it, else creates a FACES job (free: no AI minutes, no charge) and answers 202. `GET /clips/:clipId/faces` answers a signed address for the face file and its `meta`, or `{ status: 'none' | 'running' }`.
- `clipFacesWorkflow` (`postgear-media`): stage `faces`; calls `mediaPyDetectFaces`; stores the file. A stretch with no face at all is DONE with `output.found = 0`.
- Face files are per video stretch, shared by every clip that plays it. Sprint 12's `removeVideo` deletes them with the video (they are assets under its prefix); add a test that proves it.
- `GET /clips/status` gains `ai.faces`.

### 5. Detect Camera (Layouts Tab)

- **Detect Camera** (secondary) appears under the layout tiles when the layout has a Camera area (Split, or a custom layout with an area named Camera).
- Press: if there is no face file for the clip's stretch, start the job and show a small `Progress` in the `ai` tone with "Finding faces" (a 60 second clip takes a few seconds). Then `linkPeople`, `findFaceCamera` in the browser, and `apply(setAreaCrop(camera, crop))` as one undo step, with the box flashing once so the user sees what moved.
- None found: an `Alert variant="warning"`, "We could not find a face camera. Drag the box yourself.", and nothing changes.
- When AI clips are made from a setup whose layouts include Split (Module 05), the run requests faces for the top few clips and applies Detect Camera to their documents, so they open already framed. A failure there is silent: the default crop stays.

### 6. Tests

- Engine: sections 2 and 3.
- Python: the service with a fake detector (sampling rate, box fractions, heartbeat, an empty result), the file's schema test, the simulated provider.
- API and worker: reuse of a covering file, the job, deletion with the video, tenancy.
- Web: the button's states, one undo step, the warning.

## Scope

**In**: the face file and its strict shape, the Python detector, people from boxes, the face-camera finder, the FACES job and routes, Detect Camera.
**Out**: following the speaker (08), telling who is speaking by voice, recognising people, blurring faces (Module 17).

## Tasks

- [x] `mediaPyDetectFaces` in the contract with fixtures; `services/faces.py`; recorded boxes for the samples; the schema-is-boxes-only test.
- [x] `reframe/people.ts` and `reframe/facecam.ts` with tests.
- [x] Enum values (already added by Module 01); the faces routes; `clipFacesWorkflow`; the deletion test.
- [x] Detect Camera in the Layouts tab.
- [ ] Faces for Split clips made by a setup: **deferred** (Decision Log, 2026-11-26): Module 05's setup has no layout choice, so AI clips open with no Camera area to frame. It lands where setup gains layouts and reuses `faceCameraCrop`. Still deferred after Module 08 (2026-11-27): Module 08 gave setup a follow switch, not a layout choice; next candidate is Module 10's recipes. **Partly closed by Module 10 (2026-11-27)**: a recipe whose layout is a Split marks its clips `meta.cameraOnOpen`, and the editor frames the Camera area on their first open; clips from Clip Setup alone still open with no Camera area, since the setup still has no layout choice.
- [ ] The wide-shot real check (with Arvind's OK) and its note. **Not run**: it needs Arvind's OK to install the `ml` group (`mediapipe`, OpenCV) and to place `blaze_face_short_range.tflite` in `MEDIA_MODEL_DIR`, plus a wide two-person video he may use. Nothing was downloaded. What to look for when it runs: faces far from the camera missed (the reference project's report), whether MediaPipe needs the contrib headless OpenCV build, and whether `sounddevice` imports without PortAudio in the slim image.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js reframe
npm run test --workspace=apps/media
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels
```

## Done When

- On the stream sample (which has a face-like marker in a corner), Detect Camera moves the Camera box onto it in one press and one undo step.
- On the talk sample it says it found no face camera and changes nothing.
- The face file holds only boxes and times, and is deleted when its video is.
- A second clip from the same stretch reuses the file and starts no job.
- On the `two-speakers` sample, `linkPeople` returns two people for the whole length.

## Hand Check

With the three simulation flags on and the demo admin:

1. Open a Vertical clip from the stream sample, Layouts, Split. Press Detect Camera: "Finding faces", then the Camera box jumps to the corner marker. Ctrl+Z puts it back.
2. Do the same on a clip from the talk sample: the warning.
3. Delete a video that has a face file; check its folder in the private bucket is gone.

## Handoff

Module 08 turns people into a moving frame. The face file, `linkPeople` and `smoothBoxes` are its inputs. Module 15 measures face detection's speed on a real video and adds it to the cost table.
