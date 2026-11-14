import campusImage from '../../../pictures/background.jpg';
import campusFooterImage from '../../../pictures/background-footer.png';

// The Ateneo de Davao University campus photo (the same file the sign-in screen
// uses, so it is already cached for anyone who goes on to sign in). It is purely
// atmosphere: decorative (`alt=""`), veiled to the navy page colour in CSS so no
// text ever sits on the raw photo, and moved only with transform. The closing band
// passes `variant="footer"` for its own courtyard photo.
const IMAGES = {
  default: { src: campusImage, width: 1536, height: 1024 },
  footer: { src: campusFooterImage, width: 1731, height: 908 },
};

export function CampusBackdrop({ className = '', variant = 'default' }) {
  const image = IMAGES[variant] || IMAGES.default;
  return (
    <span className={`lp-campus ${className}`} aria-hidden="true">
      <img src={image.src} alt="" width={image.width} height={image.height} decoding="async" draggable="false" className="lp-campus-img" />
      <span className="lp-campus-veil" />
    </span>
  );
}
