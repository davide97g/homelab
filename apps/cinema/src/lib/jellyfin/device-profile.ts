import type { DeviceProfile } from '@jellyfin/sdk/lib/generated-client/models/device-profile'
import type { DirectPlayProfile } from '@jellyfin/sdk/lib/generated-client/models/direct-play-profile'
import type { TranscodingProfile } from '@jellyfin/sdk/lib/generated-client/models/transcoding-profile'
import type { CodecProfile } from '@jellyfin/sdk/lib/generated-client/models/codec-profile'
import type { SubtitleProfile } from '@jellyfin/sdk/lib/generated-client/models/subtitle-profile'
import { DlnaProfileType } from '@jellyfin/sdk/lib/generated-client/models/dlna-profile-type'
import { MediaStreamProtocol } from '@jellyfin/sdk/lib/generated-client/models/media-stream-protocol'
import { EncodingContext } from '@jellyfin/sdk/lib/generated-client/models/encoding-context'
import { CodecType } from '@jellyfin/sdk/lib/generated-client/models/codec-type'
import { ProfileConditionType } from '@jellyfin/sdk/lib/generated-client/models/profile-condition-type'
import { ProfileConditionValue } from '@jellyfin/sdk/lib/generated-client/models/profile-condition-value'
import { SubtitleDeliveryMethod } from '@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method'

/**
 * The device profile is how the server decides direct play vs. transcode.
 *
 * This is hand-rolled on purpose. `getBrowserDeviceProfile()` from
 * @jellyfin/sdk 0.13.0 returns ONLY SubtitleProfiles -- no DirectPlayProfiles
 * and no TranscodingProfiles. A profile with both lists empty tells the server
 * "this client can play nothing and accepts no transcode", so every media
 * source comes back SupportsDirectPlay/DirectStream/Transcoding = false and
 * playback dies with "neither directly playable nor transcodable".
 *
 * Everything below is probed against the real browser -- canPlayType for the
 * <video> path, MediaSource.isTypeSupported for the hls.js path -- so the
 * server is told what this browser can actually decode and nothing more.
 */

type Options = {
  /** SSA/ASS as a separate track instead of burning them in (which forces a full re-encode). */
  ssaExternal?: boolean
}

let cached: DeviceProfile | undefined

export function getDeviceProfile(options: Options = { ssaExternal: true }): DeviceProfile {
  cached ??= buildDeviceProfile(options)
  return cached
}

/* ------------------------------------------------------------------ *
 * Capability probing                                                  *
 * ------------------------------------------------------------------ */

const video = typeof document === 'undefined' ? undefined : document.createElement('video')

/** Direct <video src> playback. 'probably' | 'maybe' both count -- 'maybe' is how Safari answers for most things. */
function canPlay(type: string): boolean {
  return Boolean(video?.canPlayType(type))
}

/** hls.js path: fragments are fed through MediaSource, which has its own codec support list. */
function canPlayInMediaSource(type: string): boolean {
  const MS = typeof window === 'undefined' ? undefined : window.MediaSource
  return Boolean(MS?.isTypeSupported(type))
}

/** True when a codec works down both paths -- required for HLS transcode targets. */
function supported(type: string): boolean {
  return canPlay(type) || canPlayInMediaSource(type)
}

const has = {
  h264: supported('video/mp4; codecs="avc1.42E01E"'),
  hevc:
    supported('video/mp4; codecs="hvc1.1.6.L123.00"') ||
    supported('video/mp4; codecs="hev1.1.6.L123.00"'),
  av1: supported('video/mp4; codecs="av01.0.08M.08"'),
  vp9: supported('video/webm; codecs="vp9"'),
  vp8: supported('video/webm; codecs="vp8"'),
  webm: canPlay('video/webm'),
  // Chrome and Firefox report matroska; Safari does not.
  mkv: canPlay('video/x-matroska') || canPlay('video/x-matroska; codecs="avc1.42E01E"'),
  aac: supported('audio/mp4; codecs="mp4a.40.2"'),
  mp3: canPlay('audio/mpeg') || supported('audio/mp4; codecs="mp3"'),
  opus: supported('audio/webm; codecs="opus"') || supported('audio/mp4; codecs="opus"'),
  flac: supported('audio/mp4; codecs="flac"') || canPlay('audio/flac'),
  ac3: supported('audio/mp4; codecs="ac-3"'),
  eac3: supported('audio/mp4; codecs="ec-3"'),
  vorbis: supported('audio/webm; codecs="vorbis"'),
  /** fMP4 HLS. Without this, transcodes must target MPEG-TS segments. */
  fmp4Hls: canPlayInMediaSource('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
  /** Safari plays HLS from a plain <video src>, no hls.js needed. */
  nativeHls: canPlay('application/vnd.apple.mpegurl'),
}

function codecList(...entries: Array<[boolean, string]>): string {
  return entries
    .filter(([ok]) => ok)
    .map(([, codec]) => codec)
    .join(',')
}

/* ------------------------------------------------------------------ *
 * Profile construction                                               *
 * ------------------------------------------------------------------ */

function buildDeviceProfile(options: Options): DeviceProfile {
  const mp4Audio = codecList(
    [has.aac, 'aac'],
    [has.mp3, 'mp3'],
    [has.opus, 'opus'],
    [has.flac, 'flac'],
    [has.ac3, 'ac3'],
    [has.eac3, 'eac3'],
  )
  const mp4Video = codecList([has.h264, 'h264'], [has.hevc, 'hevc'], [has.av1, 'av1'], [has.vp9, 'vp9'])
  const webmAudio = codecList([has.opus, 'opus'], [has.vorbis, 'vorbis'])
  const webmVideo = codecList([has.vp8, 'vp8'], [has.vp9, 'vp9'], [has.av1, 'av1'])

  const directPlayProfiles: DirectPlayProfile[] = []

  if (mp4Video && mp4Audio) {
    directPlayProfiles.push({
      Container: 'mp4,m4v',
      Type: DlnaProfileType.Video,
      VideoCodec: mp4Video,
      AudioCodec: mp4Audio,
    })
  }
  if (has.webm && webmVideo && webmAudio) {
    directPlayProfiles.push({
      Container: 'webm',
      Type: DlnaProfileType.Video,
      VideoCodec: webmVideo,
      AudioCodec: webmAudio,
    })
  }
  if (has.mkv && mp4Video && mp4Audio) {
    directPlayProfiles.push({
      Container: 'mkv',
      Type: DlnaProfileType.Video,
      VideoCodec: mp4Video,
      AudioCodec: mp4Audio,
    })
  }
  // Audio-only, for music libraries.
  directPlayProfiles.push(
    { Container: 'mp3', Type: DlnaProfileType.Audio },
    ...(has.aac ? [{ Container: 'm4a,m4b', AudioCodec: 'aac', Type: DlnaProfileType.Audio }] : []),
    ...(has.flac ? [{ Container: 'flac', Type: DlnaProfileType.Audio }] : []),
    ...(has.opus ? [{ Container: 'opus', Type: DlnaProfileType.Audio }] : []),
    ...(has.webm && webmAudio ? [{ Container: 'webma,webm', Type: DlnaProfileType.Audio }] : []),
  )

  /*
    Transcode targets, best first. The server picks the first one it can
    satisfy, so fMP4 HLS leads (seekable, cheap remux) and a static MP4
    progressive stream is the last resort.
  */
  const transcodingProfiles: TranscodingProfile[] = []
  const transcodeAudio = codecList([has.aac, 'aac'], [has.mp3, 'mp3'])

  if (has.fmp4Hls || has.nativeHls) {
    transcodingProfiles.push({
      Container: 'mp4',
      Type: DlnaProfileType.Video,
      VideoCodec: 'h264',
      AudioCodec: transcodeAudio || 'aac',
      Protocol: MediaStreamProtocol.Hls,
      Context: EncodingContext.Streaming,
      MaxAudioChannels: '2',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
      CopyTimestamps: false,
      EnableSubtitlesInManifest: true,
    })
  }
  // MPEG-TS segments: the universally supported HLS shape.
  transcodingProfiles.push({
    Container: 'ts',
    Type: DlnaProfileType.Video,
    VideoCodec: 'h264',
    AudioCodec: transcodeAudio || 'aac',
    Protocol: MediaStreamProtocol.Hls,
    Context: EncodingContext.Streaming,
    MaxAudioChannels: '2',
    MinSegments: 1,
    BreakOnNonKeyFrames: true,
    CopyTimestamps: false,
  })
  // Progressive fallback when HLS is unavailable in this browser.
  transcodingProfiles.push({
    Container: 'mp4',
    Type: DlnaProfileType.Video,
    VideoCodec: 'h264',
    AudioCodec: transcodeAudio || 'aac',
    Protocol: MediaStreamProtocol.Http,
    Context: EncodingContext.Streaming,
    MaxAudioChannels: '2',
  })
  transcodingProfiles.push({
    Container: 'mp3',
    Type: DlnaProfileType.Audio,
    AudioCodec: 'mp3',
    Protocol: MediaStreamProtocol.Http,
    Context: EncodingContext.Streaming,
    MaxAudioChannels: '2',
  })

  /*
    Limits within a codec the container profile cannot express. Without the
    h264 level cap, a High 5.2 file direct-plays into a decoder that stalls.
  */
  const codecProfiles: CodecProfile[] = [
    {
      Type: CodecType.Video,
      Codec: 'h264',
      Conditions: [
        {
          Condition: ProfileConditionType.NotEquals,
          Property: ProfileConditionValue.IsAnamorphic,
          Value: 'true',
          IsRequired: false,
        },
        {
          Condition: ProfileConditionType.EqualsAny,
          Property: ProfileConditionValue.VideoProfile,
          Value: 'high|main|baseline|constrained baseline',
          IsRequired: false,
        },
        {
          Condition: ProfileConditionType.LessThanEqual,
          Property: ProfileConditionValue.VideoLevel,
          Value: '52',
          IsRequired: false,
        },
        {
          Condition: ProfileConditionType.NotEquals,
          Property: ProfileConditionValue.IsInterlaced,
          Value: 'true',
          IsRequired: false,
        },
      ],
    },
    {
      Type: CodecType.VideoAudio,
      Conditions: [
        {
          Condition: ProfileConditionType.NotEquals,
          Property: ProfileConditionValue.IsSecondaryAudio,
          Value: 'true',
          IsRequired: false,
        },
      ],
    },
  ]

  if (has.hevc) {
    codecProfiles.push({
      Type: CodecType.Video,
      Codec: 'hevc',
      Conditions: [
        {
          Condition: ProfileConditionType.EqualsAny,
          Property: ProfileConditionValue.VideoProfile,
          Value: 'main|main 10',
          IsRequired: false,
        },
        {
          Condition: ProfileConditionType.LessThanEqual,
          Property: ProfileConditionValue.VideoLevel,
          Value: '183',
          IsRequired: false,
        },
      ],
    })
  }

  const subtitleProfiles: SubtitleProfile[] = [
    { Format: 'vtt', Method: SubtitleDeliveryMethod.External },
    { Format: 'srt', Method: SubtitleDeliveryMethod.External },
    { Format: 'subrip', Method: SubtitleDeliveryMethod.External },
    options.ssaExternal
      ? { Format: 'ssa', Method: SubtitleDeliveryMethod.External }
      : { Format: 'ssa', Method: SubtitleDeliveryMethod.Encode },
    options.ssaExternal
      ? { Format: 'ass', Method: SubtitleDeliveryMethod.External }
      : { Format: 'ass', Method: SubtitleDeliveryMethod.Encode },
    // Image-based subtitles have no text representation -- they must be burned in.
    { Format: 'pgssub', Method: SubtitleDeliveryMethod.Encode },
    { Format: 'dvdsub', Method: SubtitleDeliveryMethod.Encode },
    { Format: 'dvbsub', Method: SubtitleDeliveryMethod.Encode },
  ]

  return {
    Name: 'Cinema (browser)',
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: transcodingProfiles,
    CodecProfiles: codecProfiles,
    SubtitleProfiles: subtitleProfiles,
    ContainerProfiles: [],
  }
}
