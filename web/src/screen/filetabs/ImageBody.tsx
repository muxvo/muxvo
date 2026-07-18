/**
 * 图片 tab 内容（data-URI 预览，只读）。照老屏 ImageBody：onLoad 后打 data-fx-loaded（golden 把关约定）。
 */

import { useState } from 'react';

export function ImageBody({ src, alt }: { src: string; alt: string }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="file-tabs-view__image">
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        {...(loaded ? { 'data-fx-loaded': '' } : {})}
      />
    </div>
  );
}
