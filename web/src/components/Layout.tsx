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
  const linkCls =
    'text-[13px] transition-colors duration-150 hover:!text-[var(--amber)]';
  const linkStyle = { color: 'var(--text-after-sec)' };

  return (
    <footer style={{ background: 'var(--bg-after)' }} className="px-6 pb-10">
      {/* Divider */}
      <div
        className="h-px mb-10"
        style={{
          background: 'linear-gradient(to right, transparent, var(--amber), transparent)',
        }}
      />

      <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
        {/* Main row */}
        <div className="flex items-center justify-between flex-wrap gap-4 md:flex-row flex-col text-center md:text-left">
          {/* Left: brand */}
          <span className="font-bold text-base" style={{ color: 'var(--amber)' }}>
            Muxvo
          </span>

          {/* Center: links */}
          <div className="flex items-center gap-5 flex-wrap justify-center">
            <Link to="/#features" className={linkCls} style={linkStyle}>
              功能
            </Link>
            <Link to="/discover" className={linkCls} style={linkStyle}>
              发现
            </Link>
            <a
              href="https://github.com/muxvo/muxvo"
              target="_blank"
              rel="noopener noreferrer"
              className={linkCls}
              style={linkStyle}
            >
              GitHub
            </a>
            <a
              href="https://github.com/muxvo/muxvo/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className={linkCls}
              style={linkStyle}
            >
              MIT License
            </a>
          </div>

          {/* Right: feedback email */}
          <a
            href="mailto:drl330330@gmail.com"
            className={linkCls}
            style={linkStyle}
          >
            drl330330@gmail.com
          </a>
        </div>

        {/* Copyright */}
        <div
          className="pt-4 text-center"
          style={{ borderTop: '1px solid var(--border-after)' }}
        >
          <span className="text-[12px]" style={{ color: 'var(--text-after-sec)', opacity: 0.6 }}>
            &copy; 2026 Muxvo
          </span>
        </div>
      </div>
    </footer>
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
