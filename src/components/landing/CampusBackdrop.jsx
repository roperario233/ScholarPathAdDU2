import campusImage from '../../../pictures/background.jpg';

// The Ateneo de Davao University campus photo (the same file the sign-in screen
// uses, so it is already cached for anyone who goes on to sign in). It is purely
// atmosphere: decorative (`alt=""`), veiled to the navy page colour in CSS so no
// text ever sits on the raw photo, and moved only with transform.
export function CampusBackdrop({ className = '' }) {
  return (
    <span className={`lp-campus ${className}`} aria-hidden="true">
      <img src={campusImage} alt="" width="1536" height="1024" decoding="async" draggable="false" className="lp-campus-img" />
      <span className="lp-campus-veil" />
    </span>
  );
}
