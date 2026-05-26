import { useState } from "react";

interface Props {
  title: string;
  subtitle?: string;
  image?: string;
  badges?: string[];
  body?: React.ReactNode;
  href?: string;
  onOpen?: () => void;
}

export function DataCard({ title, subtitle, image, badges = [], body, href, onOpen }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(image && !imageFailed);
  const content = (
    <>
      {showImage ? (
        <img className="data-card__image" src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} />
      ) : (
        <div className="data-card__sigil" aria-hidden="true">{title.slice(0, 1)}</div>
      )}
      <div className="data-card__body">
        <div className="data-card__title-row">
          <h3 translate="no">{title}</h3>
          {href ? <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span> : null}
        </div>
        {subtitle ? <p>{subtitle}</p> : null}
        {badges.length ? (
          <div className="badges">
            {badges.slice(0, 5).map((badge) => <span key={badge}>{badge}</span>)}
          </div>
        ) : null}
        {body}
      </div>
    </>
  );

  if (href) return <a className="data-card" href={href} onClick={onOpen}>{content}</a>;
  return <article className="data-card">{content}</article>;
}
