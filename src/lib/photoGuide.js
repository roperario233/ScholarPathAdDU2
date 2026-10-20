import { isPhotoDocumentType } from './constants';

// The camera capture and guide copy for the two photo requirements. The guide is
// shared by the capture modal, the Document Vault upload form, the application
// workspace, and the rejected-file replacement, so a student reads the same
// rules before uploading and a reviewer can reject against those same rules.
// The profile photo reuses the camera and the square framing but deliberately has
// no guide.
//
// A student can either take a photo with the device camera or pick an existing
// image. Both paths are normalized to a JPEG through a canvas so the uploaded
// file is small, upright, and consistent:
//   - portrait (Applicant Photo, profile photo): center-cropped to a square and
//     limited to 1024 px, matching the 2x2 ID photo framing.
//   - scene (Photos of Residence): keeps the camera's aspect ratio and is
//     limited to 1600 px on the long edge.

export const PHOTO_ACCEPT = 'image/jpeg,image/png';
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

// The long-edge limit for each framing mode, in pixels.
export const PHOTO_CAPTURE_SIZE = { portrait: 1024, scene: 1600 };

const PORTRAIT_POINTS = [
  'Use a recent photo (taken within the last six months) that clearly shows your face.',
  'Face the camera directly with a neutral expression, eyes open, and mouth closed.',
  'Keep your whole face visible - no cap, mask, sunglasses, or hair over your eyes.',
  'Use a plain, well-lit background; face a window or light so there are no shadows or glare.',
  'Center your head and shoulders in the frame, leaving a little space above your head.',
  'Wear clean, presentable clothing, as you would for an interview.',
  'Do not use filters, beauty mode, or editing, and do not send a screenshot or a scan of a printed photo.',
  'Make sure only you are in the frame and that the photo is sharp, not blurry.',
  'Keep a square crop and a plain background; the preview is mirrored, the saved photo is not.',
];

const RESIDENCE_POINTS = [
  'Take the photo in daylight or with the lights on; avoid glare and deep shadows.',
  'Show the whole front of the house, including the door and any house number or street sign.',
  "Add one or two interior photos: the living area, the kitchen, and the student's study or sleeping area.",
  'Keep the photos sharp and straight; no filters, screenshots, or photos of a screen.',
  'Do not include people in the frame.',
  'Keep the home tidy and presentable, and do not stage or edit the photo.',
  'Attach 2-3 photos when the scholarship asks for more than one.',
];

export const PHOTO_GUIDES = {
  'Applicant Photo': {
    title: 'How to take a 2x2 ID photo that will pass review',
    summary: 'The Admissions Office verifies this photo. A photo that does not follow these rules can be rejected and will need to be replaced.',
    points: PORTRAIT_POINTS,
    mode: 'portrait',
  },
  'Photos of Residence': {
    title: 'How to photograph your residence',
    summary: 'The Admissions Office verifies these photos as part of your financial-aid case. You can attach more than one photo to this requirement.',
    points: RESIDENCE_POINTS,
    mode: 'scene',
  },
};

// The guide for a photo document type, or null when the type is not a photo.
// The profile photo deliberately has no guide: the bullet-point rules exist for
// the photos submitted with an application, not for the personal avatar.
export const getPhotoGuide = (documentType) => PHOTO_GUIDES[documentType] || null;

// The framing mode a photo type uses. Unknown types fall back to portrait.
export const getPhotoCaptureMode = (documentType) => (
  documentType === 'Photos of Residence' ? 'scene' : 'portrait'
);

// True when a requirement can be satisfied with a camera capture. Requirements
// list every accepted document type, so one photo type is enough to offer it.
export const photoRequirementNeedsCamera = (requirement = {}) => (
  Array.isArray(requirement.documentTypes) && requirement.documentTypes.some(isPhotoDocumentType)
);

// The document type a camera capture should be stored as. A single-type
// requirement uses its own type; a mixed list uses the first photo type.
export const getPhotoRequirementType = (requirement = {}) => (
  (Array.isArray(requirement.documentTypes) ? requirement.documentTypes : []).find(isPhotoDocumentType) || ''
);

// A filesystem- and storage-safe name for a captured or normalized photo.
export const buildPhotoFileName = ({ prefix = 'photo', at = new Date() } = {}) => {
  const date = at instanceof Date ? at : new Date(at);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const stamp = safeDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
  return `${prefix}-${stamp}.jpg`;
};

// The source rectangle a portrait capture crops to. `verticalBias` moves the
// square up or down inside a taller frame; 0.5 is a centered crop, and a
// slightly smaller value leaves more room above the head.
export const cropSquareSourceRect = ({ width = 0, height = 0, verticalBias = 0.5 } = {}) => {
  const sourceWidth = Number(width) || 0;
  const sourceHeight = Number(height) || 0;
  if (!sourceWidth || !sourceHeight) return { sx: 0, sy: 0, size: 0 };
  const size = Math.min(sourceWidth, sourceHeight);
  const bias = Math.min(1, Math.max(0, Number(verticalBias)));
  return {
    sx: Math.round((sourceWidth - size) / 2),
    sy: Math.round((sourceHeight - size) * bias),
    size,
  };
};

const sourceSize = (source) => ({
  width: source?.naturalWidth || source?.videoWidth || source?.width || 0,
  height: source?.naturalHeight || source?.videoHeight || source?.height || 0,
});

// Draws an image, video frame, or bitmap onto a canvas and returns a JPEG File.
// Portrait mode crops a face-friendly square; scene mode keeps the aspect ratio.
export const renderSourceToPhotoFile = async (source, { mode = 'portrait', fileName, maxSize } = {}) => {
  const { width, height } = sourceSize(source);
  if (!width || !height) throw new Error('The photo could not be read. Try again.');
  if (typeof document === 'undefined') throw new Error('Photos can only be prepared in the browser.');

  const resolvedMode = mode === 'scene' ? 'scene' : 'portrait';
  const limit = Number(maxSize) || PHOTO_CAPTURE_SIZE[resolvedMode];
  let sx = 0;
  let sy = 0;
  let sw = width;
  let sh = height;
  if (resolvedMode === 'portrait') {
    ({ sx, sy, size: sw } = cropSquareSourceRect({ width, height, verticalBias: 0.42 }));
    sh = sw;
  }

  const scale = Math.min(1, limit / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the photo.');
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('The photo could not be prepared. Try again.'))),
      'image/jpeg',
      0.9,
    );
  });
  return new File([blob], fileName || buildPhotoFileName(), { type: 'image/jpeg', lastModified: Date.now() });
};

const loadImageSource = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to an <img> decode below.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read. Choose a JPG or PNG photo.'));
    };
    image.src = url;
  });
};

// Normalizes an image the student picked from their device. This is also the
// fallback when the camera is unavailable or blocked.
export const normalizeImageFile = async (file, { mode = 'portrait', fileName } = {}) => {
  if (!(typeof File !== 'undefined' && file instanceof File)) throw new Error('Choose a photo to continue.');
  if (!String(file.type || '').startsWith('image/')) throw new Error('Choose a JPG or PNG photo.');
  const source = await loadImageSource(file);
  try {
    return await renderSourceToPhotoFile(source, { mode, fileName });
  } finally {
    if (typeof source?.close === 'function') source.close();
  }
};

// Captures the current video frame as a JPEG File.
export const captureVideoFrame = async (video, { mode = 'portrait', fileName } = {}) => {
  if (!video) throw new Error('The camera is not ready yet.');
  return renderSourceToPhotoFile(video, { mode, fileName });
};
