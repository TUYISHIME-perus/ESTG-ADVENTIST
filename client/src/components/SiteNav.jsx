import { useMemo } from 'react';

export default function SiteNav() {
  const links = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Morning program', href: '/morning' },
      { label: 'Sabbath School', href: '/school-sabbath' },
      { label: 'Preachers', href: '/preachers' },
      { label: 'Songs of praise of God', href: 'https://www.academia.edu/123429509/Indirimbo_Zo_Guhimbaza_Imana_za_500_SDA_Church_500_', external: true },
      { label: 'Holy bible', href: 'https://bibiliya.com/', external: true },
      { label: 'Admin', href: '/admin' },
    ],
    []
  );

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <div className="brand-lockup">
        <img className="site-logo" src="/church-logo.jpg" alt="Seventh-day Adventist logo" />
        <h3 className="site-brand">ESTG SDA church programs</h3>
      </div>
      <div className="site-links">
        {links.map((link) =>
          link.external ? (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          ) : (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          )
        )}
      </div>
    </nav>
  );
}
