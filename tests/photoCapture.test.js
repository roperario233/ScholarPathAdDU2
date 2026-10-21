import { describe, expect, it } from 'vitest';
import {
  PHOTO_GUIDES,
  buildPhotoFileName,
  cropSquareSourceRect,
  getPhotoCaptureMode,
  getPhotoGuide,
  getPhotoRequirementType,
  photoRequirementNeedsCamera,
} from '../src/lib/photoGuide';
import { isPhotoDocumentType, photoDocumentTypes, getDocumentRejectionReasons } from '../src/lib/constants';
import { AVATAR_BUCKET, buildAvatarStoragePath } from '../src/lib/avatarStorage';

describe('photo document types', () => {
  it('recognizes the two camera-capable types', () => {
    expect(photoDocumentTypes).toEqual(['Applicant Photo', 'Photos of Residence']);
    expect(isPhotoDocumentType('Applicant Photo')).toBe(true);
    expect(isPhotoDocumentType('Photos of Residence')).toBe(true);
    expect(isPhotoDocumentType('Transcript')).toBe(false);
    expect(isPhotoDocumentType('')).toBe(false);
  });

  it('offers the camera for a requirement with a photo type', () => {
    expect(photoRequirementNeedsCamera({ documentTypes: ['Applicant Photo'] })).toBe(true);
    expect(photoRequirementNeedsCamera({ documentTypes: ['Grade Report', 'Photos of Residence'] })).toBe(true);
    expect(photoRequirementNeedsCamera({ documentTypes: ['Transcript'] })).toBe(false);
    expect(photoRequirementNeedsCamera({})).toBe(false);
  });

  it('resolves the document type a capture is stored as', () => {
    expect(getPhotoRequirementType({ documentTypes: ['Applicant Photo'] })).toBe('Applicant Photo');
    expect(getPhotoRequirementType({ documentTypes: ['Transcript', 'Photos of Residence'] })).toBe('Photos of Residence');
    expect(getPhotoRequirementType({ documentTypes: ['Transcript'] })).toBe('');
  });
});

describe('photo guides', () => {
  it('omits photo-specific rejection reasons for non-photo files', () => {
    const photoReasons = getDocumentRejectionReasons('Applicant Photo').map((reason) => reason.value);
    expect(photoReasons).toContain('photo-quality');
    expect(photoReasons).toContain('not-recent');
    const transcriptReasons = getDocumentRejectionReasons('Transcript').map((reason) => reason.value);
    expect(transcriptReasons).not.toContain('photo-quality');
    expect(transcriptReasons).not.toContain('not-recent');
    expect(transcriptReasons).toContain('illegible');
  });

  it('gives each application photo type its own bullet list', () => {
    expect(getPhotoGuide('Applicant Photo').points).toBe(PHOTO_GUIDES['Applicant Photo'].points);
    expect(getPhotoGuide('Photos of Residence').points).toBe(PHOTO_GUIDES['Photos of Residence'].points);
    expect(getPhotoGuide('Applicant Photo').points).not.toEqual(getPhotoGuide('Photos of Residence').points);
    expect(getPhotoGuide('Transcript')).toBeNull();
  });

  it('covers the rejection criteria: clean, present, recent, unobstructed', () => {
    const idPoints = getPhotoGuide('Applicant Photo').points.join(' ').toLowerCase();
    expect(idPoints).toContain('face');
    expect(idPoints).toContain('recent');
    expect(idPoints).toContain('presentable');
    expect(idPoints).toContain('filters');
    const residencePoints = getPhotoGuide('Photos of Residence').points.join(' ').toLowerCase();
    expect(residencePoints).toContain('house');
    expect(residencePoints).toContain('people');
  });

  it('keeps every guide non-empty and leaves the profile photo without a guide', () => {
    Object.values(PHOTO_GUIDES).forEach((guide) => {
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.points.length).toBeGreaterThan(0);
      guide.points.forEach((point) => expect(point.trim().length).toBeGreaterThan(0));
    });
    expect(getPhotoGuide('')).toBeNull();
  });
});

describe('photo framing', () => {
  it('uses a square portrait crop for an ID photo and the native aspect for a residence photo', () => {
    expect(getPhotoCaptureMode('Applicant Photo')).toBe('portrait');
    expect(getPhotoCaptureMode('Photos of Residence')).toBe('scene');
    expect(getPhotoCaptureMode('Transcript')).toBe('portrait');
  });

  it('center-crops the largest square from a wide or tall source', () => {
    expect(cropSquareSourceRect({ width: 1920, height: 1080 })).toEqual({ sx: 420, sy: 0, size: 1080 });
    expect(cropSquareSourceRect({ width: 1080, height: 1920 })).toEqual({ sx: 0, sy: 420, size: 1080 });
    expect(cropSquareSourceRect({ width: 800, height: 800 })).toEqual({ sx: 0, sy: 0, size: 800 });
    expect(cropSquareSourceRect({ width: 0, height: 0 })).toEqual({ sx: 0, sy: 0, size: 0 });
  });

  it('biases a portrait crop upward so there is room above the head', () => {
    const rect = cropSquareSourceRect({ width: 1080, height: 1920, verticalBias: 0.42 });
    expect(rect.sx).toBe(0);
    expect(rect.size).toBe(1080);
    expect(rect.sy).toBeLessThan(420);
    expect(rect.sy).toBeGreaterThan(0);
  });
});

describe('captured photo file names', () => {
  it('builds a storage-safe JPEG name with a timestamp', () => {
    const name = buildPhotoFileName({ prefix: 'applicant-photo', at: new Date('2026-10-21T14:30:05.123Z') });
    expect(name).toBe('applicant-photo-20261021-143005Z.jpg');
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('falls back to the default prefix', () => {
    expect(buildPhotoFileName({ at: new Date('2026-01-02T03:04:05Z') })).toBe('photo-20260102-030405Z.jpg');
  });
});

describe('avatar storage paths', () => {
  it('keys the object under the owner with a timestamped name', () => {
    expect(AVATAR_BUCKET).toBe('avatars');
    const path = buildAvatarStoragePath({ ownerId: 'u1', fileName: 'profile-photo-1.jpg', at: 1234 });
    expect(path).toBe('u1/1234-profile-photo-1.jpg');
    expect(path).not.toMatch(/\s/);
  });
});
