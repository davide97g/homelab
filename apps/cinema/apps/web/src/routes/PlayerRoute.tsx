import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CircleAlert, HardDriveDownload } from 'lucide-react'
import { useQuackToast } from '@/components/ui/quack-toast'
import { useItem } from '@/lib/jellyfin/queries'
import { useAvailability } from '@/lib/jellyfin/availability'
import { PlayMethod } from '@/lib/jellyfin/playback'
import { PlayerControls } from '@/features/player/PlayerControls'
import { VideoPlayer } from '@/features/player/VideoPlayer'
import { usePlaybackSession } from '@/features/player/usePlaybackSession'

const IDLE_MS = 3000

export function PlayerRoute() {
  const { itemId } = useParams<{ itemId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useQuackToast()

  const startSeconds = Number(params.get('t') ?? 0) || 0
  const { data: item } = useItem(itemId)
  const {
    videoRef,
    source,
    error,
    resumeSeconds,
    switching,
    subtitleIndex,
    selectAudio,
    selectSubtitle,
  } = usePlaybackSession({ itemId, startSeconds })

  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const idleTimer = useRef<number | undefined>(undefined)

  // Hide the chrome when the mouse goes still, like every other player.
  useEffect(() => {
    const wake = () => {
      setControlsVisible(true)
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setControlsVisible(false), IDLE_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(idleTimer.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  // Say it out loud when the server is re-encoding: it is the difference
  // between 1% CPU and a pegged box, and the badge alone is easy to miss.
  useEffect(() => {
    if (source?.playMethod !== PlayMethod.Transcode) return
    toast({
      title: 'Transcoding',
      description: 'The server is re-encoding this file. Direct play was not possible.',
    })
  }, [source?.playMethod, toast])

  const message = error ?? playbackError

  // "The browser could not decode this stream" is a lie when the truth is that
  // someone pulled the drive out. Only worth a round trip once playback has
  // actually failed, so the probe stays disabled until then.
  const { data: availability } = useAvailability(item, Boolean(message))
  const offline = availability === 'offline'

  const goBack = () => navigate(itemId ? `/item/${itemId}` : '/')

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-black"
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      {source ? (
        <>
          <VideoPlayer
            source={source}
            startSeconds={resumeSeconds}
            videoRef={videoRef}
            subtitleIndex={subtitleIndex}
            onError={setPlaybackError}
          />
          <PlayerControls
            videoRef={videoRef}
            title={item?.Type === 'Episode' ? (item.SeriesName ?? '') : (item?.Name ?? '')}
            subtitle={item?.Type === 'Episode' ? (item.Name ?? undefined) : undefined}
            playMethod={source.playMethod}
            visible={controlsVisible || Boolean(message)}
            onBack={goBack}
            audioOptions={source.audioOptions}
            audioIndex={source.audioStreamIndex}
            onSelectAudio={selectAudio}
            subtitleOptions={source.subtitleOptions}
            subtitleIndex={subtitleIndex}
            onSelectSubtitle={selectSubtitle}
            switching={switching}
          />
        </>
      ) : (
        !message && (
          <div className="grid size-full place-items-center gap-3">
            <div className="flex flex-col items-center gap-3">
              <span className="size-6 animate-spin rounded-pill border-2 border-white/20 border-t-primary" />
              <p className="text-sm text-white/60">Negotiating playback…</p>
            </div>
          </div>
        )
      )}

      {message && (
        <div className="absolute inset-0 grid place-items-center bg-black/90 p-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            {offline ? (
              <HardDriveDownload className="size-10 text-amber" />
            ) : (
              <CircleAlert className="size-10 text-destructive" />
            )}
            <p className="text-lg font-semibold">
              {offline ? 'Storage offline' : 'Cannot play this file'}
            </p>
            <p className="text-sm text-white/60">
              {offline
                ? 'The drive holding this film is not reachable. Reconnect it and try again.'
                : message}
            </p>
            <button
              type="button"
              onClick={goBack}
              className="mt-2 inline-flex h-9 items-center rounded-md bg-white/10 px-4 text-sm font-semibold transition-colors hover:bg-white/20"
            >
              Go back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
