import { useState } from 'react';

const initialsOf = (name = '') => String(name)
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || 'SP';

const sizeClasses = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-24 w-24 text-2xl',
};

// The authenticated header, the sidebar identity panel, and My Profile show the
// same avatar: the signed-in user's profile photo when one is stored, otherwise
// the gradient initials placeholder. A signed avatar URL expires, so a failed
// image falls back to initials instead of showing a broken picture.
export default function ProfileAvatar({ src = '', name = '', size = 'md', rounded = 'rounded-full', className = '' }) {
  // Remember which URL failed instead of resetting a boolean in an effect, so a
  // new photo gets a fresh attempt without a cascading render.
  const [failedSrc, setFailedSrc] = useState('');
  const failed = Boolean(src) && failedSrc === src;

  const shared = `${sizeClasses[size] || sizeClasses.md} shrink-0 overflow-hidden border border-white/15 ${rounded} ${className}`;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={`${shared} object-cover`}
        onError={() => setFailedSrc(src)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`grid place-items-center bg-gradient-to-br from-ateneo to-sky-400 font-extrabold text-white ${shared}`}
    >
      {initialsOf(name)}
    </span>
  );
}
