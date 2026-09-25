import type { Api } from '@jellyfin/sdk'
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api'
import { getPlaystateApi } from '@jellyfin/sdk/lib/utils/api/playstate-api'
import { MediaStreamProtocol } from '@jellyfin/sdk/lib/generated-client/models/media-stream-protocol'
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type'
import { PlayMethod } from '@jellyfin/sdk/lib/generated-client/models/play-method'
import { SubtitleDeliveryMethod } from '@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method'
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info'
import { getDeviceProfile } from './device-profile'

export { PlayMethod }

export type SubtitleTrack = {
  index: number
  label: string
  language?: string
  url: string
  isDefault: boolean
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
  mediaSource: MediaSourceInfo
}

export type ResolveOptions = {
  itemId: string
  userId: string
  startTimeTicks?: number
  /** Cap the bitrate to force a transcode -- useful for testing that path. */
  maxStreamingBitrate?: number
  audioStreamIndex?: number
  subtitleStreamIndex?: number
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
      DeviceProfile: getDeviceProfile(),
      StartTimeTicks: opts.startTimeTicks ?? 0,
      MaxStreamingBitrate: opts.maxStreamingBitrate,
      AudioStreamIndex: opts.audioStreamIndex,
      SubtitleStreamIndex: opts.subtitleStreamIndex,
      EnableDirectPlay: true,
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

  const subtitleTracks = (source.MediaStreams ?? [])
    .filter(
      (s) =>
        s.Type === MediaStreamType.Subtitle &&
        s.DeliveryMethod === SubtitleDeliveryMethod.External &&
        Boolean(s.DeliveryUrl),
    )
    .map<SubtitleTrack>((s) => ({
      index: s.Index ?? 0,
      label: s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`,
      language: s.Language ?? undefined,
      url: `${api.basePath}${s.DeliveryUrl}`,
      isDefault: Boolean(s.IsDefault),
    }))

  const shared = {
    playSessionId,
    mediaSourceId: source.Id,
    container: source.Container ?? undefined,
    runTimeTicks: source.RunTimeTicks ?? undefined,
    subtitleTracks,
    mediaSource: source,
  }

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
      url: `${api.basePath}${source.TranscodingUrl}`,
      isHls: source.TranscodingSubProtocol === MediaStreamProtocol.Hls,
      playMethod: source.SupportsDirectStream ? PlayMethod.DirectStream : PlayMethod.Transcode,
    }
  }

  // Remux advertised without a URL to fetch it from: fall back to the raw file.
  if (source.SupportsDirectStream) {
    return {
      ...shared,
      url: staticStreamUrl(),
      isHls: false,
      playMethod: PlayMethod.DirectStream,
    }
  }

  throw new Error('Media source is neither directly playable nor transcodable')
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
