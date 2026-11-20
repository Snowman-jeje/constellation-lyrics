import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowsClockwise, Camera, FlipHorizontal, Sun, X } from '@phosphor-icons/react';
import { useSuiteStore } from '../../store/useSuiteStore';
import { AtelierSkeleton, BezelPanel, HairlineSlider } from './AtelierPrimitives';

export function MirrorWidget() {
  const { updateSection, pushToast } = useSuiteStore();
  const reducedMotion = useReducedMotion();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(true);
  const [brightness, setBrightness] = useState(1.0);
  const [retryCount, setRetryCount] = useState(0);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function startCamera() {
      stopStream();
      setLoading(true);
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera API unavailable');
        setLoading(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!active) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setLoading(false);
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Camera permission denied';
        setError(msg);
        setLoading(false);
        pushToast('Mirror camera unavailable', 'warning');
      }
    }

    void startCamera();
    return () => {
      active = false;
      stopStream();
    };
  }, [retryCount, stopStream, pushToast]);

  const handleClose = () => {
    stopStream();
    updateSection('utilities', { mirrorEnabled: false });
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 12 }}
      transition={{ duration: 0.26 }}
      className="fixed bottom-24 right-6 z-30 w-[236px] cursor-grab active:cursor-grabbing"
    >
      <BezelPanel
        radiusClass="rounded-[1.6rem]"
        innerRadiusClass="rounded-[calc(1.6rem-0.375rem)]"
        innerClassName="overflow-hidden p-2.5"
      >
        <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070709]">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover transition-[filter] duration-150"
            style={{
              transform: flipped ? 'scaleX(-1)' : 'scaleX(1)',
              filter: `brightness(${brightness})`,
            }}
          />

          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0E0E12] p-4">
              <Camera size={20} weight="light" className="text-[#8E8A82]" />
              <AtelierSkeleton className="h-2 w-24" />
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0E0E12] p-3 text-center">
              <Camera size={20} weight="light" className="text-[#E07A7A]" />
              <span className="line-clamp-2 text-[11px] text-[#8E8A82]">{error}</span>
              <button
                type="button"
                onClick={() => setRetryCount((c) => c + 1)}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.06] px-2.5 py-1 text-[10px] text-[#F4F2ED] hover:bg-white/[0.12]"
              >
                <ArrowsClockwise size={12} weight="light" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Top Floating Actions */}
          <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              title="Flip horizontal"
              aria-label="Flip mirror horizontally"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0E0E12]/80 text-[#F4F2ED] backdrop-blur-md hover:bg-white/15"
            >
              <FlipHorizontal size={13} weight="light" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              title="Close mirror"
              aria-label="Close mirror"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0E0E12]/80 text-[#F4F2ED] backdrop-blur-md hover:bg-white/15"
            >
              <X size={13} weight="light" />
            </button>
          </div>
        </div>

        {/* Hairline Brightness Control */}
        <div className="mt-2 flex items-center gap-2 px-1">
          <Sun size={13} weight="light" className="shrink-0 text-[#8E8A82]" />
          <HairlineSlider
            value={brightness}
            min={0.6}
            max={1.6}
            step={0.05}
            onChange={setBrightness}
            className="flex-1"
          />
          <span className="w-8 text-right font-mono text-[10px] tabular-nums text-[#8E8A82]">
            {Math.round(brightness * 100)}%
          </span>
        </div>
      </BezelPanel>
    </motion.div>
  );
}
