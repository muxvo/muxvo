import { useEffect, useRef, useState } from 'react';

const CMD = 'muxvo';

export function HeroSplit() {
  const dividerRef = useRef<HTMLDivElement>(null);
  const [typedText, setTypedText] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    // Divider grow animation
    const timer = setTimeout(() => {
      dividerRef.current?.classList.add('hero-divider--visible');
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const visited = localStorage.getItem('muxvo-visited');

    if (visited || reducedMotion) {
      setTypedText(CMD);
      setCursorVisible(false);
      setFeedbackVisible(true);
      doneRef.current = true;
      return;
    }

    function skipToEnd() {
      if (doneRef.current) return;
      doneRef.current = true;
      setTypedText(CMD);
      setCursorVisible(false);
      setFeedbackVisible(true);
      localStorage.setItem('muxvo-visited', '1');
    }

    const onScroll = () => skipToEnd();
    const onKey = () => skipToEnd();
    window.addEventListener('scroll', onScroll, { once: true });
    document.addEventListener('keydown', onKey, { once: true });

    let charIndex = 0;
    const startTimer = setTimeout(function typeChar() {
      if (doneRef.current) return;
      if (charIndex < CMD.length) {
        setTypedText(CMD.slice(0, charIndex + 1));
        charIndex++;
        setTimeout(typeChar, 100);
      } else {
        setTimeout(() => {
          if (doneRef.current) return;
          setCursorVisible(false);
          setFeedbackVisible(true);
          doneRef.current = true;
          localStorage.setItem('muxvo-visited', '1');
        }, 300);
      }
    }, 500);

    return () => {
      clearTimeout(startTimer);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <section className="hero-split">
      {/* LEFT: Before side */}
      <div className="hero-before">
        <div className="hero-content">
          <div className="label-before">WITHOUT MUXVO</div>
          <h2 className="hero-title-before">
            散落的终端。<br />
            丢失的对话。<br />
            无尽的切换。
          </h2>
          <p className="hero-desc-before">6个窗口 / 3个项目 / 无数次 Cmd+Tab</p>

          <div className="mock-windows">
            <div className="mock-win mock-win--1">
              <div className="mock-win-titlebar">
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
              </div>
              <div className="mock-win-path">~/project-a</div>
              <div className="mock-win-line">$ claude "fix the bug"</div>
              <div className="mock-win-line">Analyzing codebase...</div>
            </div>

            <div className="mock-win mock-win--2">
              <div className="mock-win-titlebar">
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
              </div>
              <div className="mock-win-path">~/project-b</div>
              <div className="mock-win-line">$ codex --task refactor</div>
              <div className="mock-win-line">Processing...</div>
              <div className="mock-win-line">3 files changed</div>
            </div>

            <div className="mock-win mock-win--3">
              <div className="mock-win-titlebar">
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
              </div>
              <div className="mock-win-path">~/project-c</div>
              <div className="mock-win-line">$ gemini chat</div>
              <div className="mock-win-line">How can I help?</div>
            </div>

            <div className="mock-win mock-win--4">
              <div className="mock-win-titlebar">
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
                <span className="mock-win-dot" />
              </div>
              <div className="mock-win-path">~/project-a</div>
              <div className="mock-win-line">$ npm run dev</div>
              <div className="mock-win-line">Server on :3000</div>
            </div>
          </div>
        </div>
      </div>

      {/* DIVIDER: Vertical amber line */}
      <div className="hero-divider" ref={dividerRef}>
        <div className="hero-divider-dot" />
      </div>

      {/* RIGHT: After side */}
      <div className="hero-after">
        <div className="hero-content">
          <div className="label-after">WITH MUXVO</div>
          <h2 className="hero-title-after">
            一个指挥中心。<br />
            尽在掌控。<br />
            一目了然。
          </h2>

          <div className="after-screenshot">
            <div className="after-grid">
              <div className="after-pane">
                <div className="after-pane-title">CLAUDE CODE</div>
                <span className="after-pane-prompt">$</span> claude<br />
                <span className="after-pane-success">Ready.</span> Analyzing src/...
              </div>
              <div className="after-pane">
                <div className="after-pane-title">CODEX</div>
                <span className="after-pane-prompt">$</span> codex<br />
                <span className="after-pane-success">Connected.</span> Listening...
              </div>
              <div className="after-pane">
                <div className="after-pane-title">GEMINI CLI</div>
                <span className="after-pane-prompt">$</span> gemini chat<br />
                Session active. How can I help?
              </div>
              <div className="after-pane">
                <div className="after-pane-title">NPM RUN</div>
                <span className="after-pane-prompt">$</span> npm run dev<br />
                <span className="after-pane-success">Server on :3000</span>
              </div>
            </div>
          </div>

          <div className="typing-block">
            <div>
              <span className="typing-prompt">$ </span>
              <span className="typing-cmd">{typedText}</span>
              {cursorVisible && <span className="typing-cursor" />}
            </div>
            <div className={`typing-feedback${feedbackVisible ? ' typing-feedback--visible' : ''}`}>
              &#10003; Workbench ready. 3 CLIs connected.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
