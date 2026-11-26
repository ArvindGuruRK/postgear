#!/bin/sh
# Runs the worker image's pinned FFmpeg or ffprobe on this machine's files
# (Sprint 13). For a development machine with Docker but no FFmpeg of its own:
#
#   docker build -f infra/docker/Dockerfile.worker -t postgear-worker:local .
#   FFMPEG_PATH="$PWD/infra/docker/worker/bin/ffmpeg"
#   FFPROBE_PATH="$PWD/infra/docker/worker/bin/ffprobe"
#
# `ffmpeg` and `ffprobe` beside this file call it with the program's name. The
# program runs inside a throwaway container of the image, as the calling user,
# in the same working directory, with the folders the tools read and write
# mounted at the same paths: the repository, the system temp folders and the
# folder CLIPS_SCRATCH_DIR names. Nothing else of the machine is visible to it
# and it has no network (FFmpeg only ever reads and writes files here).
#
# Never for production: there the worker runs inside the image itself.
set -eu

tool="$1"
shift

image="${POSTGEAR_TOOLS_IMAGE:-postgear-worker:local}"
here="$(cd "$(dirname "$0")" && pwd -P)"
repo="$(cd "$here/../../../.." && pwd -P)"

mounts="-v $repo:$repo"
for dir in /tmp /private/tmp /var/folders /private/var/folders "${CLIPS_SCRATCH_DIR:-}" "${TMPDIR:-}"; do
  [ -n "$dir" ] && [ -d "$dir" ] || continue
  real="$(cd "$dir" && pwd -P)"
  case "$real" in
    "$repo"/*|"$repo") continue ;;
  esac
  mounts="$mounts -v $dir:$dir"
  [ "$real" = "$dir" ] || mounts="$mounts -v $real:$real"
done

# shellcheck disable=SC2086  # the mounts are a list of flags built above from fixed folders
exec docker run --rm -i --init --network none \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -w "$(pwd -P)" \
  $mounts \
  --entrypoint "/opt/postgear/bin/$tool" \
  "$image" "$@"
