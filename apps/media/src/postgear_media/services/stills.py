"""A few still pictures of a video: the work behind `mediaPyStills` (Module 06).

One JPEG at each asked moment, `width` pixels wide, stored under the video's
own key space at a key made from the job's id and the moment's place in the
list (`still-<n>-<job hex>.jpg`). The Node side removes every one of them when
its run ends, whatever happened, by those same keys. Nothing here keeps a
still: the scratch folder goes with the attempt.

The simulated binding stores one test-pattern picture at every key; it never
decodes and never holds a real frame.
"""

from __future__ import annotations

from temporalio.exceptions import ApplicationError

from postgear_media.contract.generated import MediaPyStillsInput, MediaPyStillsOutput
from postgear_media.core.keys import job_file_key
from postgear_media.core.scratch import scratch_folder
from postgear_media.core.storage import StorageNotFoundError
from postgear_media.providers.vision.simulation import placeholder_still
from postgear_media.services.motion import VisualDeps, bad_input


def still_key(org_id: str, video_id: str, job_id: str, index: int) -> str:
    """The key of a run's `index`th still."""
    return job_file_key(org_id, video_id, f"still-{index}", job_id, "jpg")


def cut_stills(payload: MediaPyStillsInput, deps: VisualDeps) -> MediaPyStillsOutput:
    """Cuts and stores one still at each moment; answers their keys in the order asked."""
    moments = list(payload.moments_ms)
    for moment in moments:
        if int(moment.root) >= payload.duration_ms:
            raise bad_input("A still was asked for past the end of the video")
    keys: list[str] = []
    with scratch_folder(deps.scratch_root, payload.job_id) as folder:
        missing = ApplicationError(
            "The light copy is not in storage", type="MEDIA_KEY_NOT_FOUND", non_retryable=True
        )
        if deps.simulated:
            if not deps.storage.exists(payload.proxy_key):
                raise missing
            hint = payload.simulation
            if hint and hint.force == "fail":
                raise ApplicationError(
                    "The simulated still cutter failed on purpose", type="MEDIA_TOOL_FAILED"
                )
            pictures = [placeholder_still() for _ in moments]
        else:
            proxy = folder / "proxy.mp4"
            try:
                deps.storage.get_to_file(payload.proxy_key, proxy)
            except StorageNotFoundError:
                raise missing from None
            source = deps.open_source(proxy)
            try:
                pictures = []
                for index, moment in enumerate(moments):
                    deps.checkpoint({"still": index, "of": len(moments)})
                    pictures.append(source.still(int(moment.root), payload.width))
            finally:
                source.close()
        for index, picture in enumerate(pictures):
            deps.checkpoint({"stored": index, "of": len(pictures)})
            path = folder / f"still-{index}.jpg"
            path.write_bytes(picture)
            key = still_key(payload.org_id, payload.video_id, payload.job_id, index)
            deps.storage.put_file(path, key, "image/jpeg")
            keys.append(key)
    return MediaPyStillsOutput.model_validate({"keys": keys})
