import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, ImagePlus, RefreshCw, SwitchCamera } from 'lucide-react';
import { Button, ModalShell } from './ui';
import PhotoGuide from './PhotoGuide';
import {
  buildPhotoFileName,
  captureVideoFrame,
  getPhotoCaptureMode,
  getPhotoGuide,
  normalizeImageFile,
  PHOTO_ACCEPT,
} from '../lib/photoGuide';

// Camera capture for the applicant photo, the residence photos, and the profile
// photo. The camera opens only from a tap (browsers require a user gesture), and
// every path has a fallback: pick an existing image, or use the device camera
// through the native file input. Captures are normalized to a JPEG before the
// parent uploads them into the Document Vault or the avatars bucket.
//
// Rendered in a portal so it sits above the application workspace or the
// rejected-file replacement modal; a nested fixed overlay inside a
// backdrop-blurred modal would otherwise be clipped and stacked underneath it.
export default function PhotoCaptureModal({
  title = '',
  documentType = '',
  guide = null,
  mode = '',
  fileNamePrefix = '',
  showGuide = true,
  onUsePhoto,
  onClose,
}) {
  const resolvedGuide = guide || getPhotoGuide(documentType) || { title: 'Take a photo', summary: '', points: [], mode: 'portrait' };
  const resolvedMode = mode || getPhotoCaptureMode(documentType);
  const prefix = fileNamePrefix || (documentType === 'Photos of Residence'
    ? 'residence-photo'
    : documentType === 'Applicant Photo' ? 'applicant-photo' : 'photo');

  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [captured, setCaptured] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [facing, setFacing] = useState('user');
  const [isStarting, setIsStarting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isUsing, setIsUsing] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const previewUrlRef = useRef('');

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
  }, []);

  useEffect(() => () => {
    stopStream();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
  }, [stopStream]);

  const startCamera = async (nextFacing = facing) => {
    setError('');
    setFacing(nextFacing);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot open a camera. Upload an existing photo instead.');
      setPhase('idle');
      return;
    }
    stopStream();
    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: nextFacing === 'environment' ? { ideal: 'environment' } : { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase('streaming');
    } catch (cameraError) {
      const blocked = cameraError?.name === 'NotAllowedError' || cameraError?.name === 'SecurityError';
      setError(blocked
        ? 'Camera access was blocked. Allow camera permission in your browser, or upload an existing photo instead.'
        : 'The camera could not be opened. Upload an existing photo, or use your device camera below.');
      setPhase('idle');
    } finally {
      setIsStarting(false);
    }
  };

  const showCaptured = (file) => {
    clearPreview();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setCaptured(file);
    setPhase('review');
  };

  const capture = async () => {
    setError('');
    setIsCapturing(true);
    try {
      const file = await captureVideoFrame(videoRef.current, {
        mode: resolvedMode,
        fileName: buildPhotoFileName({ prefix }),
      });
      stopStream();
      showCaptured(file);
    } catch (captureError) {
      setError(captureError?.message || 'The photo could not be captured. Try again.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handlePickedFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setIsCapturing(true);
    try {
      const normalized = await normalizeImageFile(file, {
        mode: resolvedMode,
        fileName: buildPhotoFileName({ prefix }),
      });
      stopStream();
      showCaptured(normalized);
    } catch (pickedError) {
      setError(pickedError?.message || 'That photo could not be prepared. Try another one.');
    } finally {
      setIsCapturing(false);
    }
  };

  const retake = async () => {
    clearPreview();
    setCaptured(null);
    await startCamera(facing);
  };

  const usePhoto = async () => {
    if (!captured) return;
    setError('');
    setIsUsing(true);
    const result = await onUsePhoto?.(captured);
    setIsUsing(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    onClose?.();
  };

  const close = () => {
    stopStream();
    clearPreview();
    onClose?.();
  };

  const busy = isStarting || isCapturing || isUsing;

  return createPortal(
    <ModalShell
      title={title || resolvedGuide.title}
      onClose={close}
      overlayClassName="photo-capture-overlay"
      className="w-[min(640px,100%)]"
    >
      <div className="grid gap-4">
        {showGuide ? <PhotoGuide guide={resolvedGuide} defaultOpen /> : null}

        <div className={`relative overflow-hidden rounded-2xl border border-app-border bg-slate-950 ${resolvedMode === 'portrait' ? 'aspect-square' : 'aspect-[4/3]'}`}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`h-full w-full object-cover ${phase === 'streaming' ? '' : 'hidden'}`}
            style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
          />
          {phase === 'streaming' && resolvedMode === 'portrait' ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-[19%] bottom-[15%] top-[9%] rounded-[50%] border-2 border-white/70" />
              <div className="absolute inset-x-0 bottom-1/4 h-px bg-white/40" />
              <span className="absolute inset-x-0 top-2 text-center text-[11px] font-semibold text-white/85">Center your face in the oval</span>
            </div>
          ) : null}
          {phase === 'streaming' && resolvedMode === 'scene' ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
            </div>
          ) : null}
          {phase === 'review' && previewUrl ? (
            <img src={previewUrl} alt="Captured photo preview" className="h-full w-full object-contain" />
          ) : null}
          {phase !== 'streaming' && phase !== 'review' ? (
            <div className="grid h-full place-items-center gap-2 p-6 text-center text-sm text-slate-300">
              <CameraOff size={30} aria-hidden="true" />
              <span>Camera off</span>
              <span className="text-xs text-slate-400">Turn on the camera, or choose an existing photo below.</span>
            </div>
          ) : null}
        </div>

        {error ? <p className="form-error m-0" role="alert">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          {phase === 'streaming' ? (
            <>
              <Button variant="primary" type="button" onClick={capture} disabled={busy}>
                <Camera size={16} aria-hidden="true" /> {isCapturing ? 'Capturing...' : 'Take photo'}
              </Button>
              <Button type="button" onClick={() => startCamera(facing === 'user' ? 'environment' : 'user')} disabled={busy}>
                <SwitchCamera size={16} aria-hidden="true" /> Switch camera
              </Button>
            </>
          ) : phase === 'review' ? (
            <>
              <Button variant="primary" type="button" onClick={usePhoto} disabled={busy}>
                {isUsing ? 'Saving...' : 'Use this photo'}
              </Button>
              <Button type="button" onClick={retake} disabled={busy}>
                <RefreshCw size={16} aria-hidden="true" /> Retake
              </Button>
            </>
          ) : (
            <Button variant="primary" type="button" onClick={() => startCamera()} disabled={busy}>
              <Camera size={16} aria-hidden="true" /> {isStarting ? 'Opening camera...' : 'Turn on camera'}
            </Button>
          )}

          <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-app-border bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <ImagePlus size={16} aria-hidden="true" /> Upload an existing photo
            <input type="file" accept={PHOTO_ACCEPT} className="sr-only" onChange={handlePickedFile} disabled={busy} />
          </label>

          <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-app-border bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <Camera size={16} aria-hidden="true" /> Use device camera
            <input type="file" accept={PHOTO_ACCEPT} capture={resolvedMode === 'scene' ? 'environment' : 'user'} className="sr-only" onChange={handlePickedFile} disabled={busy} />
          </label>
        </div>

        <p className="m-0 text-xs text-app-muted">
          Camera access needs a secure connection (HTTPS or localhost) and permission from your browser. If the camera does not open, upload an existing photo instead. The photo is saved as a JPG so it stays within the 10 MB limit.
        </p>

      </div>
    </ModalShell>,
    document.body,
  );
}
