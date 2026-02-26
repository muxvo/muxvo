import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-100 h-16 flex items-center border-b transition-[border-color] duration-300"
      style={{
        background: 'rgba(6,8,12,0.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottomColor: scrolled ? 'var(--border-after)' : 'transparent',
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 w-full flex items-center justify-between">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-bold text-lg" style={{ color: 'var(--amber)' }}>
            Muxvo
          </span>
        </Link>

        {/* Hamburger */}
        <button
          className="md:hidden bg-transparent border-none text-2xl cursor-pointer p-1 leading-none"
          style={{ color: 'var(--text-after)' }}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          &#9776;
        </button>

        {/* Links */}
        <div
          className={`
            md:flex md:gap-8 md:items-center md:static md:bg-transparent md:p-0 md:border-none
            ${menuOpen ? 'flex' : 'hidden'}
            flex-col md:flex-row fixed md:relative top-16 md:top-auto left-0 right-0
            p-6 md:p-0 gap-5 z-99
          `}
          style={{
            background: menuOpen ? 'rgba(6,8,12,0.97)' : undefined,
            borderBottom: menuOpen ? '1px solid var(--border-after)' : undefined,
          }}
        >
          <Link
            to="/#features"
            className="text-sm transition-colors duration-150 hover:!text-[var(--amber)]"
            style={{ color: 'var(--text-after-sec)' }}
          >
            功能
          </Link>
          <Link
            to="/discover"
            className="text-sm transition-colors duration-150 hover:!text-[var(--amber)]"
            style={{ color: 'var(--text-after-sec)' }}
          >
            发现
          </Link>
          <a
            href="https://github.com/muxvo/muxvo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm transition-colors duration-150 hover:!text-[var(--amber)]"
            style={{ color: 'var(--text-after-sec)' }}
          >
            GitHub
          </a>
          <a href="https://muxvo.com/download/Muxvo-arm64.dmg" className="btn-amber">下载</a>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{ background: 'var(--bg-after)' }} className="px-6 pb-12">
      {/* Divider */}
      <div
        className="h-px mb-12"
        style={{
          background: 'linear-gradient(to right, transparent, var(--amber), transparent)',
        }}
      />

      {/* Grid */}
      <div className="max-w-[1200px] mx-auto grid grid-cols-2 md:grid-cols-3 gap-8">
        <div>
          <h5
            className="text-[13px] font-semibold tracking-wide mb-3"
            style={{ color: 'var(--text-after)' }}
          >
            产品
          </h5>
          <FooterLink href="/#features">功能</FooterLink>
          <FooterLink href="/discover">发现</FooterLink>
          <FooterLink href="/#download">下载</FooterLink>
        </div>
        <div>
          <h5
            className="text-[13px] font-semibold tracking-wide mb-3"
            style={{ color: 'var(--text-after)' }}
          >
            资源
          </h5>
          <FooterLink href="https://github.com/muxvo/muxvo" external>
            GitHub
          </FooterLink>
        </div>
        <div>
          <h5
            className="text-[13px] font-semibold tracking-wide mb-3"
            style={{ color: 'var(--text-after)' }}
          >
            法律
          </h5>
          <FooterLink href="https://github.com/muxvo/muxvo/blob/main/LICENSE" external>
            MIT 开源协议
          </FooterLink>
        </div>
      </div>

      {/* Bottom */}
      <div
        className="max-w-[1200px] mx-auto mt-8 pt-6 flex items-center justify-between flex-wrap gap-3 md:flex-row flex-col text-center md:text-left"
        style={{ borderTop: '1px solid var(--border-after)' }}
      >
        <span className="font-bold text-base" style={{ color: 'var(--amber)' }}>
          Muxvo
        </span>
        <span className="text-[13px]" style={{ color: 'var(--text-after-sec)' }}>
          &copy; 2026 Muxvo. MIT License.
        </span>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const className =
    'block text-[13px] py-1 transition-colors duration-150 hover:!text-[var(--amber)]';
  const style = { color: 'var(--text-after-sec)' };

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style}>
        {children}
      </a>
    );
  }

  // Internal links that include hash
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link to={href} className={className} style={style}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  );
}

export function Layout() {
  return (
    <>
      <Nav />
      <main className="pt-16">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
