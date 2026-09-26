import type { Api } from '@jellyfin/sdk'
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api'
import { getPlaystateApi } from '@jellyfin/sdk/lib/utils/api/playstate-api'
import { MediaStreamProtocol } from '@jellyfin/sdk/lib/generated-client/models/media-stream-protocol'
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type'
import { PlayMethod } from '@jellyfin/sdk/lib/generated-client/models/play-method'
import { SubtitleDeliveryMethod } from '@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method'
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info'
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream'
import { getDeviceProfile } from './device-profile'

export { PlayMethod }

/**
 * Subtitle languages in the order they are switched on by default. Jellyfin
 * keeps a single preferred language per user, so the fallback lives here.
 */
const SUBTITLE_LANGUAGES = ['ita', 'eng']

export type SubtitleTrack = {
  index: number
  label: string
  language?: string
  url: string
}

export type AudioOption = {
  index: number
  label: string
}

export type SubtitleOption = {
  index: number
  label: string
  /**
   * Image subtitles (PGS, VobSub) cannot be a <track>: picking one means a new
   * session with the server burning it into the picture, which is a transcode.
   */
  burnIn: boolean
}

export type PlaybackSource = {
  /** Feed this to <video src> or hls.js. */
  url: string
  /** DirectPlay | DirectStream | Transcode -- report this back to the server. */
  playMethod: PlayMethod
  playSessionId: string
  mediaSourceId: string
  isHls: boolean
  container?: string
  runTimeTicks?: number
  /** External (sidecar) subtitles, ready for <track>. */
  subtitleTracks: SubtitleTrack[]
  /** Everything the pickers can offer, text and image alike. */
  audioOptions: AudioOption[]
  subtitleOptions: SubtitleOption[]
  /** The audio stream actually coming out of the speakers in this session. */
  audioStreamIndex?: number
  /** Set when the server is painting an image subtitle into the video. */
  burnedSubtitleIndex?: number
  /** Italian, else English, else null: subtitles off. */
  defaultSubtitleIndex: number | null
  mediaSource: MediaSourceInfo
}

export type ResolveOptions = {
  itemId: string
  userId: string
  startTimeTicks?: number
  /** Cap the bitrate to force a transcode -- useful for testing that path. */
  maxStreamingBitrate?: number
  /**
   * Required for the two stream indexes below to take effect: without it the
   * server ignores them and quietly answers with the defaults.
   */
  mediaSourceId?: string
  audioStreamIndex?: number
  /** Only for an image subtitle to burn in; text subtitles never need a new session. */
  subtitleStreamIndex?: number
  /** Internal: set on the retry when direct play would play the wrong audio. */
  enableDirectPlay?: boolean
}

/**
 * THE central negotiation. You never build a stream URL by hand: you tell the
 * server what this browser can decode (device profile) and it answers with
 * either a direct file URL or an HLS transcode URL.
 *
 * Getting this wrong is the difference between a 1% CPU direct play and your
 * server transcoding 4K on every press of play.
 */
export async function resolvePlaybackSource(
  api: Api,
  opts: ResolveOptions,
): Promise<PlaybackSource> {
  const { data } = await getMediaInfoApi(api).getPostedPlaybackInfo({
    itemId: opts.itemId,
    playbackInfoDto: {
      UserId: opts.userId,
      MediaSourceId: opts.mediaSourceId,
      DeviceProfile: getDeviceProfile(),
      StartTimeTicks: opts.startTimeTicks ?? 0,
      MaxStreamingBitrate: opts.maxStreamingBitrate,
      AudioStreamIndex: opts.audioStreamIndex,
      // -1 is "none": left empty, the server applies the user's subtitle mode
      // and may pick an image track, turning a direct play into a transcode.
      SubtitleStreamIndex: opts.subtitleStreamIndex ?? -1,
      EnableDirectPlay: opts.enableDirectPlay ?? true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
    },
  })

  const playSessionId = data.PlaySessionId
  const source = data.MediaSources?.[0]
  if (!source?.Id || !playSessionId) {
    throw new Error('No playable media source returned for this item')
  }

  const streams = source.MediaStreams ?? []
  const audioStreams = streams.filter((s) => s.Type === MediaStreamType.Audio)
  // What a browser plays from the raw file: the flagged track, else the first.
  // It cannot switch tracks inside a container on its own.
  const fileAudioIndex = (audioStreams.find((s) => s.IsDefault) ?? audioStreams[0])?.Index ?? undefined

  if (
    source.SupportsDirectPlay &&
    opts.audioStreamIndex !== undefined &&
    opts.audioStreamIndex !== fileAudioIndex
  ) {
    // Same answer jellyfin-web lands on: remux, so the chosen track is the one
    // in the stream. Video is copied, so this stays cheap.
    return resolvePlaybackSource(api, { ...opts, enableDirectPlay: false })
  }

  const subtitleStreams = streams.filter((s) => s.Type === MediaStreamType.Subtitle)
  const isExternal = (s: MediaStream) =>
    s.DeliveryMethod === SubtitleDeliveryMethod.External && Boolean(s.DeliveryUrl)

  const subtitleTracks = subtitleStreams.filter(isExternal).map<SubtitleTrack>((s) => ({
    index: s.Index ?? 0,
    label: streamLabel(s),
    language: s.Language ?? undefined,
    url: `${api.basePath}${s.DeliveryUrl}`,
  }))

  const burnedSubtitleIndex = subtitleStreams.some(
    (s) => s.Index === opts.subtitleStreamIndex && s.DeliveryMethod === SubtitleDeliveryMethod.Encode,
  )
    ? opts.subtitleStreamIndex
    : undefined

  const shared = {
    playSessionId,
    mediaSourceId: source.Id,
    container: source.Container ?? undefined,
    runTimeTicks: source.RunTimeTicks ?? undefined,
    subtitleTracks,
    audioOptions: audioStreams.map<AudioOption>((s) => ({
      index: s.Index ?? 0,
      label: streamLabel(s),
    })),
    subtitleOptions: subtitleStreams
      .filter((s) => isExternal(s) || s.DeliveryMethod === SubtitleDeliveryMethod.Encode)
      .map<SubtitleOption>((s) => ({
        index: s.Index ?? 0,
        label: streamLabel(s),
        burnIn: !isExternal(s),
      })),
    burnedSubtitleIndex,
    defaultSubtitleIndex: pickDefaultSubtitle(subtitleStreams.filter(isExternal)),
    mediaSource: source,
  }

  // Direct play is always the file's own track. Anything the server touches
  // carries its DefaultAudioStreamIndex -- the one asked for, when it listened.
  const servedAudioIndex = source.DefaultAudioStreamIndex ?? fileAudioIndex

  const staticStreamUrl = () =>
    api.getUri(`/Videos/${opts.itemId}/stream.${source.Container}`, {
      Static: 'true',
      mediaSourceId: source.Id,
      api_key: api.accessToken,
      playSessionId,
      ...(source.ETag ? { Tag: source.ETag } : {}),
    })

  // Best path: the browser can decode the file as it sits on disk. The server
  // streams bytes and burns no CPU.
  if (source.SupportsDirectPlay) {
    return {
      ...shared,
      audioStreamIndex: fileAudioIndex,
      url: staticStreamUrl(),
      isHls: false,
      playMethod: PlayMethod.DirectPlay,
    }
  }

  // Anything else the server answers through TranscodingUrl -- which covers
  // both a cheap remux (DirectStream: streams copied into a new container) and
  // a real re-encode. The URL is relative and already carries its own api_key
  // and session params, so do not rebuild it.
  //
  // Note this must be preferred over the static URL whenever DirectPlay was
  // refused: a .mov or .mkv that needs remuxing will not load from
  // stream.<original container>, however playable its codecs are.
  if (source.TranscodingUrl) {
    return {
      ...shared,
      audioStreamIndex: servedAudioIndex,
      url: `${api.basePath}${source.TranscodingUrl}`,
      isHls: source.TranscodingSubProtocol === MediaStreamProtocol.Hls,
      playMethod: source.SupportsDirectStream ? PlayMethod.DirectStream : PlayMethod.Transcode,
    }
  }

  // Remux advertised without a URL to fetch it from: fall back to the raw file.
  if (source.SupportsDirectStream) {
    return {
      ...shared,
      audioStreamIndex: fileAudioIndex,
      url: staticStreamUrl(),
      isHls: false,
      playMethod: PlayMethod.DirectStream,
    }
  }

  throw new Error('Media source is neither directly playable nor transcodable')
}

function streamLabel(stream: MediaStream) {
  return stream.DisplayTitle ?? stream.Language ?? `Track ${stream.Index}`
}

function matchesLanguage(stream: MediaStream, language: string) {
  // Jellyfin reports ISO 639-2 ("ita"), but a hand-named sidecar can say "it".
  const code = stream.Language?.toLowerCase()
  return code === language || code === language.slice(0, 2)
}

/**
 * Full subtitles in the first preferred language present; forced tracks only
 * cover foreign-language lines, so they never stand in for a language. The
 * file's own default flag is ignored: on a French release of an anime it
 * points at French.
 */
function pickDefaultSubtitle(streams: MediaStream[]): number | null {
  for (const language of SUBTITLE_LANGUAGES) {
    const match = streams.find((s) => !s.IsForced && matchesLanguage(s, language))
    if (match) return match.Index ?? null
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Session reporting. Without these the server never learns where you  *
 * stopped, so "Continue Watching" stays empty and transcodes leak.    *
 * ------------------------------------------------------------------ */

type ReportBase = {
  itemId: string
  source: PlaybackSource
  positionTicks: number
}

export function reportPlaybackStart(api: Api, { itemId, source, positionTicks }: ReportBase) {
  return getPlaystateApi(api).reportPlaybackStart({
    playbackStartInfo: {
      ItemId: itemId,
      MediaSourceId: source.mediaSourceId,
      PlaySessionId: source.playSessionId,
      PlayMethod: source.playMethod,
      PositionTicks: positionTicks,
      CanSeek: true,
      IsPaused: false,
      IsMuted: false,
    },
  })
}

export function reportPlaybackProgress(
  api: Api,
  { itemId, source, positionTicks, isPaused, volumeLevel, isMuted }: ReportBase & {
    isPaused: boolean
    isMuted: boolean
    volumeLevel: number
  },
) {
  return getPlaystateApi(api).reportPlaybackProgress({
    playbackProgressInfo: {
      ItemId: itemId,
      MediaSourceId: source.mediaSourceId,
      PlaySessionId: source.playSessionId,
      PlayMethod: source.playMethod,
      PositionTicks: positionTicks,
      IsPaused: isPaused,
      IsMuted: isMuted,
      VolumeLevel: Math.round(volumeLevel * 100),
      CanSeek: true,
    },
  })
}

/**
 * Critically, this also tells the server to tear down an active transcode.
 * Skip it and ffmpeg keeps running after the tab closes.
 */
export function reportPlaybackStopped(api: Api, { itemId, source, positionTicks }: ReportBase) {
  return getPlaystateApi(api).reportPlaybackStopped({
    playbackStopInfo: {
      ItemId: itemId,
      MediaSourceId: source.mediaSourceId,
      PlaySessionId: source.playSessionId,
      PositionTicks: positionTicks,
    },
  })
}
