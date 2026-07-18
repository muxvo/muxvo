// 复合 UI spike 的 web 测试页（模拟产品 chrome）。以字符串内联，loadHTMLString 加载，
// 无外部资源。职责：
//  - html/body 透明；chrome（顶栏/tile 头/边框/间隙）有各自背景色，洞区(.hole)透明，
//    终端从洞区透出（复合的本体）。
//  - 每个 .hole 用 getBoundingClientRect 上报「洞 rect 清单」经 messageHandler `layout`
//    （模拟生产 layoutReport；rects 空数组 = 浮层挂起，native 停穿透）。ResizeObserver +
//    window.resize → rAF 合帧 → diff 才发。
//  - 全屏半透明 modal backdrop（open 时上报空 rects）；顶栏一个 <input> 做焦点交接测试。
//  - window.spike.{openModal,closeModal,setTheme,setDivider} 供 native evaluateJavaScript 驱动。
//  - document mousedown / input focus 经 messageHandler `probe` 回传（S2/S3 web 侧佐证）。
enum ChromePage {
    /// n = tile 数（洞数）。ratio 影响首列宽（分隔条模拟）。
    static func html(tiles n: Int) -> String {
        let cols = max(1, Int(Double(n).squareRootCeil()))
        return """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          html, body { margin:0; padding:0; width:100%; height:100%;
                       background: transparent !important; overflow:hidden;
                       font-family: -apple-system, Menlo, monospace; }
          /* chrome 背景：间隙/根容器有可见色，便于 S5 观察背景缝隙；洞区透明 */
          #root { position:absolute; inset:0; display:flex; flex-direction:column;
                  background: rgba(20,22,28,0.0); }
          #topbar { height:40px; flex:0 0 40px; display:flex; align-items:center;
                    gap:12px; padding:0 12px; box-sizing:border-box;
                    background: rgba(28,30,38,0.92); color:#cdd; border-bottom:1px solid #444; }
          #topbar input { background:#1b1d24; color:#eee; border:1px solid #555;
                          border-radius:6px; padding:4px 8px; font-size:12px; width:180px; }
          #grid { flex:1 1 auto; display:grid; gap:8px; padding:8px; box-sizing:border-box;
                  grid-template-columns: repeat(\(cols), 1fr); }
          /* tile 本体透明：洞区必须一路透到底，终端全亮度透出（legacy 同款）。
             chrome 仅 = 边框 + 头条 + 间隙，不得在洞区上叠任何半透明背景。 */
          .tile { display:flex; flex-direction:column; border:1px solid #3a3d47;
                  border-radius:8px; overflow:hidden; background: transparent; }
          .tilehdr { height:22px; flex:0 0 22px; display:flex; align-items:center;
                     padding:0 8px; font-size:11px; color:#9aa; background: rgba(40,43,52,0.95); }
          /* 洞：完全透明，终端从此透出。绝不放置任何交互元素或祖先背景。 */
          .hole { flex:1 1 auto; background: transparent; }
          #modal { position:absolute; inset:0; display:none; align-items:center;
                   justify-content:center; background: rgba(0,0,0,0.5); }
          #modal.open { display:flex; }
          #dialog { width:360px; background:#232631; color:#eee; border:1px solid #556;
                    border-radius:12px; padding:20px; }
          #dialog input { width:100%; box-sizing:border-box; margin-top:10px;
                          background:#1b1d24; color:#eee; border:1px solid #555; padding:6px; }
          body.light #topbar { background: rgba(240,240,245,0.95); color:#223; }
          body.light .tilehdr { background: rgba(225,227,235,0.97); color:#446; }
          body.light .tile { background: transparent; border-color:#ccd; }
        </style></head>
        <body>
          <div id="root">
            <div id="topbar">
              <b>muxvo composite spike</b>
              <input id="webinput" placeholder="web input (focus handoff)">
              <span id="stat" style="font-size:11px;color:#7a7">holes:?</span>
            </div>
            <div id="grid"></div>
          </div>
          <div id="modal"><div id="dialog"><div>Modal open — holes suspended, all input to web.</div>
            <input id="modalinput" placeholder="modal input"></div></div>
          <script>
            const N = \(n);
            const grid = document.getElementById('grid');
            let divRatio = 1.0;
            for (let i=0;i<N;i++){
              const t=document.createElement('div'); t.className='tile';
              const h=document.createElement('div'); h.className='tilehdr'; h.textContent='term '+i;
              const hole=document.createElement('div'); hole.className='hole'; hole.dataset.idx=i;
              t.appendChild(h); t.appendChild(hole); grid.appendChild(t);
            }
            let stateId=0, lastJSON='';
            function post(name,payload){
              try{ window.webkit.messageHandlers[name].postMessage(payload); }catch(e){}
            }
            function computeRects(){
              const modalOpen = document.getElementById('modal').classList.contains('open');
              if (modalOpen) return {rects:[], modal:true};
              const rects=[];
              document.querySelectorAll('.hole').forEach(h=>{
                const r=h.getBoundingClientRect();
                rects.push({idx:+h.dataset.idx, x:Math.round(r.x*100)/100, y:Math.round(r.y*100)/100,
                            w:Math.round(r.width*100)/100, h:Math.round(r.height*100)/100});
              });
              return {rects, modal:false};
            }
            let scheduled=false;
            function report(){
              if(scheduled) return; scheduled=true;
              requestAnimationFrame(()=>{
                scheduled=false;
                const {rects,modal}=computeRects();
                stateId++;
                const msg={stateId, rects, modal, ts: performance.now()};
                const j=JSON.stringify(rects)+modal;
                if(j===lastJSON && !modal) { /* diff：无变化不发 */ }
                lastJSON=j;
                document.getElementById('stat').textContent='holes:'+rects.length+(modal?' (modal)':'');
                post('layout', msg);
              });
            }
            const ro=new ResizeObserver(()=>report());
            ro.observe(document.body);
            document.querySelectorAll('.hole').forEach(h=>ro.observe(h));
            window.addEventListener('resize', report);
            document.addEventListener('mousedown', e=>{
              post('probe', {kind:'mousedown', x:e.clientX, y:e.clientY,
                             onHole: e.target.classList && e.target.classList.contains('hole')});
            }, true);
            ['webinput','modalinput'].forEach(id=>{
              const el=document.getElementById(id);
              el.addEventListener('focus', ()=>post('probe',{kind:'focus', id}));
            });
            window.spike = {
              openModal(){ document.getElementById('modal').classList.add('open'); report(); },
              closeModal(){ document.getElementById('modal').classList.remove('open'); report(); },
              setTheme(m){ document.body.className = (m==='light'?'light':''); report(); },
              setDivider(r){ divRatio=r;
                grid.style.gridTemplateColumns = 'repeat(\(cols), 1fr)';
                if(\(cols)>1){ const rest=(\(cols)-1);
                  grid.style.gridTemplateColumns = (r).toFixed(3)+'fr ' + Array(rest).fill('1fr').join(' '); }
                report(); },
              focusWebInput(){ document.getElementById('webinput').focus(); },
              ping(){ return 'ok'; }
            };
            // 首帧上报
            report();
            window.addEventListener('load', report);
          </script>
        </body></html>
        """
    }
}

private extension Double {
    func squareRootCeil() -> Double { (self.squareRoot()).rounded(.up) }
}
