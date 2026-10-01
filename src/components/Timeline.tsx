import { formatCount } from '../run/metrics'
import type { Playhead } from '../run/usePlayhead'
import { PauseIcon, PlayIcon } from './Icons'

export const Timeline = ({ playhead, loaded, total, live }: { playhead: Playhead; loaded: number; total: number; live: boolean }) => {
  const empty = loaded === 0
  const position = empty ? 0 : playhead.index + 1
  return (
    <div className="timeline" role="group" aria-label="Replay controls">
      <button className="icon-button solid" type="button" disabled={loaded < 2} onClick={playhead.playing ? playhead.pause : playhead.play} aria-label={playhead.playing ? 'Pause replay' : 'Replay the run'}>
        {playhead.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <input
        type="range"
        aria-label="Position in the run"
        aria-valuetext={empty ? 'No rows yet' : `Row ${formatCount(position)} of ${formatCount(total)}`}
        min={0}
        max={Math.max(0, loaded - 1)}
        value={empty ? 0 : playhead.index}
        disabled={loaded < 2}
        onChange={(event) => playhead.seek(Number(event.currentTarget.value))}
      />
      <span className="timeline-readout">{empty ? 'No rows yet' : <>Row <b>{formatCount(position)}</b> of {formatCount(total)}</>}</span>
      {live && !playhead.following && <button className="button quiet small" type="button" onClick={playhead.toLive}>Jump to live</button>}
    </div>
  )
}
