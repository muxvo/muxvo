export function CompareSkills() {
  return (
    <section className="compare-section" id="skill-discovery">
      <div className="compare-before">
        <div className="compare-inner fade-left">
          <span className="compare-label label-problem">// THE PROBLEM</span>
          <h3 className="compare-title">Skill 靠口口相传</h3>
          <p className="compare-desc">
            GitHub 上搜 "Claude Code skill"，翻了 5 页。不知道质量如何。手动
            clone，手动配置。下载了一个有 bug 的 skill，debug 了两小时。
          </p>
          <div className="mock-github-search">
            <div className="gh-search-bar">
              <span className="gh-search-icon">&#128269;</span>
              <span className="gh-search-text">claude code skill</span>
            </div>
            <div className="gh-results-count">About 1,240 results</div>
            <div className="gh-repo-item">
              <div className="gh-repo-name">random-user/my-awesome-skill</div>
              <div className="gh-repo-meta">
                <span>&#9733; 3</span>
                <span>Updated 8 months ago</span>
                <span className="gh-quality-unknown">Quality: ???</span>
              </div>
            </div>
            <div className="gh-repo-item">
              <div className="gh-repo-name">another-dev/code-helper</div>
              <div className="gh-repo-meta">
                <span>&#9733; 12</span>
                <span>Updated 2 months ago</span>
                <span className="gh-quality-unknown">Quality: ???</span>
              </div>
            </div>
            <div className="gh-repo-item">
              <div className="gh-repo-name">test-account/untested-skill</div>
              <div className="gh-repo-meta">
                <span>&#9733; 0</span>
                <span>Updated 1 year ago</span>
                <span className="gh-quality-unknown">Quality: ???</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="compare-divider" />
      <div className="compare-after">
        <div className="compare-inner fade-right">
          <span className="compare-label label-solution">// THE SOLUTION</span>
          <h3 className="compare-title">AI 评分的 Skill 市场</h3>
          <p className="compare-desc">
            社区驱动的 Skill 市场。每个包经 AI 自动评分（代码清晰度、设计巧思、实用性等
            6 维度），质量一目了然。一键安装，版本管理，自动更新。
          </p>
          <div className="mock-skill-market">
            <div className="skill-card">
              <div className="skill-name">Code Review Pro</div>
              <div className="skill-score">AI Score: 9.2</div>
              <div className="skill-installs">1.2k installs</div>
              <span className="skill-btn">Install</span>
            </div>
            <div className="skill-card">
              <div className="skill-name">Test Generator</div>
              <div className="skill-score">AI Score: 8.7</div>
              <div className="skill-installs">850 installs</div>
              <span className="skill-btn">Install</span>
            </div>
            <div className="skill-card">
              <div className="skill-name">Architecture Advisor</div>
              <div className="skill-score">AI Score: 9.0</div>
              <div className="skill-installs">2.1k installs</div>
              <span className="skill-btn skill-btn--installed">
                Installed &#10003;
              </span>
            </div>
            <div className="skill-card">
              <div className="skill-name">Bug Hunter</div>
              <div className="skill-score">AI Score: 7.8</div>
              <div className="skill-installs">430 installs</div>
              <span className="skill-btn">Install</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
