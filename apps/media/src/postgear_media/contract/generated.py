# Do not edit: generated from packages/media-contract/schema/contract.json
# by `npm run contract:python`. Change the Zod shapes, then regenerate.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class Binding(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Annotated[str, Field(max_length=64, min_length=1)]
    state: Literal["simulation", "live", "off"]


class FaceBox(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    h: Annotated[float, Field(ge=0.0, le=1.0)]
    score: Annotated[float, Field(ge=0.0, le=1.0)]
    w: Annotated[float, Field(ge=0.0, le=1.0)]
    x: Annotated[float, Field(ge=0.0, le=1.0)]
    y: Annotated[float, Field(ge=0.0, le=1.0)]


class FacePicture(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    boxes: Annotated[list[FaceBox], Field(max_length=8)]
    t: Annotated[int, Field(ge=0, le=86400000)]


class FaceTracksFile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    frames: Annotated[list[FacePicture], Field(max_length=54000)]
    sample_fps: Annotated[Literal[5], Field(alias="sampleFps")]
    version: Literal[1]


class Sample(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z0-9-]{1,32}$")]


class FacesSimulationHint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    force: Literal["fail", "slow"] | None
    sample: Sample | None


class Values(RootModel[float]):
    root: Annotated[float, Field(ge=0.0, le=1.0)]


class Speech(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    sample_rate_hz: Annotated[Literal[2], Field(alias="sampleRateHz")]
    values: Annotated[list[Values | None], Field(max_length=172800)]


class HeardWord(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    end: Annotated[int, Field(ge=0, le=86400000)]
    start: Annotated[int, Field(ge=0, le=86400000)]
    sure: Annotated[float, Field(ge=0.0, le=1.0)]
    text: Annotated[str, Field(max_length=80, min_length=1)]


class MediaPyHealthInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Literal[1]


class Bindings(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    faces: Binding
    motion: Binding
    speaker: Binding
    stills: Binding
    transcriber: Binding


class MediaPyHealthOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    bindings: Bindings
    contract_version: Annotated[
        int, Field(alias="contractVersion", ge=1, le=9007199254740991)
    ]
    models_present: Annotated[bool, Field(alias="modelsPresent")]
    python_version: Annotated[
        str, Field(alias="pythonVersion", max_length=32, min_length=1)
    ]
    service_version: Annotated[
        str, Field(alias="serviceVersion", max_length=32, min_length=1)
    ]
    simulation: bool
    task_queue: Annotated[str, Field(alias="taskQueue", max_length=64, min_length=1)]


class MomentsM(RootModel[int]):
    root: Annotated[int, Field(ge=0, le=86400000)]


class LanguageProbability(RootModel[float]):
    root: Annotated[float, Field(ge=0.0, le=1.0)]


class Values1(RootModel[float]):
    root: Annotated[float, Field(ge=0.0, le=255.0)]


class SimulationHint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    force: Literal["fail", "no-speech", "slow"] | None
    sample: Sample | None


class SpeakSimulationHint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    force: Literal["fail", "slow"] | None


class SpeechTextFile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    text: Annotated[str, Field(max_length=500, min_length=1)]
    version: Literal[1]


class StorageKey(RootModel[str]):
    root: Annotated[
        str,
        Field(
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """


class TimeRange(BaseModel):
    """
    A stretch of the video, in its own milliseconds
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    from_ms: Annotated[int, Field(alias="fromMs", ge=0, le=86400000)]
    to_ms: Annotated[int, Field(alias="toMs", ge=0, le=86400000)]


class VisualSimulationHint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    force: Literal["fail", "slow"] | None
    sample: Sample | None


class VoiceInfo(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[
        str, Field(max_length=32, pattern="^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,3}$")
    ]
    languages: Annotated[
        list[Literal["en", "hi", "ta"]], Field(max_length=3, min_length=1)
    ]
    name: Annotated[str, Field(max_length=40, min_length=1)]


class VoiceList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    speaker: Binding
    voices: Annotated[list[VoiceInfo], Field(max_length=64)]


class HeardFile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    language: Annotated[str, Field(pattern="^[a-z]{2,3}$")]
    model: Annotated[str, Field(max_length=80, min_length=1)]
    ranges: Annotated[list[TimeRange], Field(max_length=64, min_length=1)]
    speech: Speech
    version: Literal[1]
    words: Annotated[list[HeardWord], Field(max_length=400000)]


class MediaPyDetectFacesInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    duration_ms: Annotated[int, Field(alias="durationMs", ge=0, le=86400000)]
    job_id: Annotated[
        str,
        Field(
            alias="jobId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]
    max_width: Annotated[Literal[640], Field(alias="maxWidth")]
    org_id: Annotated[
        str,
        Field(
            alias="orgId",
            max_length=64,
            pattern="^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$",
        ),
    ]
    proxy_key: Annotated[
        str,
        Field(
            alias="proxyKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    ranges: Annotated[list[TimeRange], Field(max_length=16, min_length=1)]
    sample_fps: Annotated[Literal[5], Field(alias="sampleFps")]
    simulation: FacesSimulationHint | None
    version: Literal[1]
    video_id: Annotated[
        str,
        Field(
            alias="videoId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]


class MediaPyDetectFacesOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    faces_key: Annotated[
        str,
        Field(
            alias="facesKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    found: Annotated[int, Field(ge=0, le=9007199254740991)]
    producer: Annotated[str, Field(max_length=80, min_length=1)]
    sampled: Annotated[int, Field(ge=0, le=9007199254740991)]


class MediaPyMotionInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    duration_ms: Annotated[int, Field(alias="durationMs", ge=0, le=86400000)]
    job_id: Annotated[
        str,
        Field(
            alias="jobId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]
    org_id: Annotated[
        str,
        Field(
            alias="orgId",
            max_length=64,
            pattern="^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$",
        ),
    ]
    proxy_key: Annotated[
        str,
        Field(
            alias="proxyKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    ranges: Annotated[list[TimeRange], Field(max_length=64, min_length=1)]
    sample_fps: Annotated[Literal[2], Field(alias="sampleFps")]
    simulation: VisualSimulationHint | None
    version: Literal[1]
    video_id: Annotated[
        str,
        Field(
            alias="videoId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]


class MediaPyMotionOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    producer: Annotated[str, Field(max_length=80, min_length=1)]
    sampled: Annotated[int, Field(ge=0, le=9007199254740991)]
    track_key: Annotated[
        str,
        Field(
            alias="trackKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """


class MediaPySpeakInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job_id: Annotated[
        str,
        Field(
            alias="jobId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]
    org_id: Annotated[
        str,
        Field(
            alias="orgId",
            max_length=64,
            pattern="^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$",
        ),
    ]
    out_key: Annotated[
        str,
        Field(
            alias="outKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    simulation: SpeakSimulationHint | None
    text_key: Annotated[
        str,
        Field(
            alias="textKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    version: Literal[1]
    voice_id: Annotated[
        str,
        Field(
            alias="voiceId",
            max_length=32,
            pattern="^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,3}$",
        ),
    ]


class MediaPySpeakOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    duration_ms: Annotated[int, Field(alias="durationMs", ge=1, le=600000)]
    producer: Annotated[str, Field(max_length=80, min_length=1)]
    sample_rate: Annotated[Literal[24000], Field(alias="sampleRate")]
    sound_key: Annotated[
        str,
        Field(
            alias="soundKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """


class MediaPyStillsInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    duration_ms: Annotated[int, Field(alias="durationMs", ge=0, le=86400000)]
    job_id: Annotated[
        str,
        Field(
            alias="jobId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]
    moments_ms: Annotated[
        list[MomentsM], Field(alias="momentsMs", max_length=48, min_length=1)
    ]
    org_id: Annotated[
        str,
        Field(
            alias="orgId",
            max_length=64,
            pattern="^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$",
        ),
    ]
    proxy_key: Annotated[
        str,
        Field(
            alias="proxyKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    simulation: VisualSimulationHint | None
    version: Literal[1]
    video_id: Annotated[
        str,
        Field(
            alias="videoId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]
    width: Annotated[int, Field(ge=160, le=1280)]


class MediaPyStillsOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    keys: Annotated[list[StorageKey], Field(max_length=48, min_length=1)]


class MediaPyTranscribeInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    audio_key: Annotated[
        str,
        Field(
            alias="audioKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    duration_ms: Annotated[int, Field(alias="durationMs", ge=0, le=86400000)]
    job_id: Annotated[
        str,
        Field(
            alias="jobId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]
    language: Annotated[str, Field(pattern="^(?:auto|[a-z]{2,3})$")]
    org_id: Annotated[
        str,
        Field(
            alias="orgId",
            max_length=64,
            pattern="^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$",
        ),
    ]
    ranges: Annotated[list[TimeRange], Field(max_length=64, min_length=1)]
    simulation: SimulationHint | None
    version: Literal[1]
    video_id: Annotated[
        str,
        Field(
            alias="videoId",
            pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        ),
    ]


class MediaPyTranscribeOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    heard_key: Annotated[
        str,
        Field(
            alias="heardKey",
            max_length=512,
            pattern="^clips\\/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}\\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library\\/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$",
        ),
    ]
    """
    A private Clips storage key, never a path
    """
    language: Annotated[str, Field(pattern="^[a-z]{2,3}$")]
    language_probability: Annotated[
        LanguageProbability | None, Field(alias="languageProbability")
    ]
    model: Annotated[str, Field(max_length=80, min_length=1)]
    no_speech: Annotated[bool, Field(alias="noSpeech")]
    seconds_listened: Annotated[float, Field(alias="secondsListened", ge=0.0)]
    word_count: Annotated[int, Field(alias="wordCount", ge=0, le=9007199254740991)]


class MotionFile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    producer: Annotated[str, Field(max_length=80, min_length=1)]
    ranges: Annotated[list[TimeRange], Field(max_length=64, min_length=1)]
    sample_rate_hz: Annotated[Literal[2], Field(alias="sampleRateHz")]
    values: Annotated[list[Values1 | None], Field(max_length=172800)]
    version: Literal[1]


class MediaContract(BaseModel):
    """
    Generated from packages/media-contract. Contract version 1. Do not edit.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    file_face_tracks_file: Annotated[
        FaceTracksFile | None, Field(alias="file_FaceTracksFile")
    ] = None
    file_heard_file: Annotated[HeardFile | None, Field(alias="file_HeardFile")] = None
    file_motion_file: Annotated[MotionFile | None, Field(alias="file_MotionFile")] = (
        None
    )
    file_speech_text_file: Annotated[
        SpeechTextFile | None, Field(alias="file_SpeechTextFile")
    ] = None
    http_voice_list: Annotated[VoiceList | None, Field(alias="http_VoiceList")] = None
    media_py_detect_faces_input: Annotated[
        MediaPyDetectFacesInput | None, Field(alias="mediaPyDetectFaces_input")
    ] = None
    media_py_detect_faces_output: Annotated[
        MediaPyDetectFacesOutput | None, Field(alias="mediaPyDetectFaces_output")
    ] = None
    media_py_health_input: Annotated[
        MediaPyHealthInput | None, Field(alias="mediaPyHealth_input")
    ] = None
    media_py_health_output: Annotated[
        MediaPyHealthOutput | None, Field(alias="mediaPyHealth_output")
    ] = None
    media_py_motion_input: Annotated[
        MediaPyMotionInput | None, Field(alias="mediaPyMotion_input")
    ] = None
    media_py_motion_output: Annotated[
        MediaPyMotionOutput | None, Field(alias="mediaPyMotion_output")
    ] = None
    media_py_speak_input: Annotated[
        MediaPySpeakInput | None, Field(alias="mediaPySpeak_input")
    ] = None
    media_py_speak_output: Annotated[
        MediaPySpeakOutput | None, Field(alias="mediaPySpeak_output")
    ] = None
    media_py_stills_input: Annotated[
        MediaPyStillsInput | None, Field(alias="mediaPyStills_input")
    ] = None
    media_py_stills_output: Annotated[
        MediaPyStillsOutput | None, Field(alias="mediaPyStills_output")
    ] = None
    media_py_transcribe_input: Annotated[
        MediaPyTranscribeInput | None, Field(alias="mediaPyTranscribe_input")
    ] = None
    media_py_transcribe_output: Annotated[
        MediaPyTranscribeOutput | None, Field(alias="mediaPyTranscribe_output")
    ] = None
