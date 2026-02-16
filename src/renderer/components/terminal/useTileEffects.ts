/**
 * useTileEffects — 3D mouse-tracking tilt effect for terminal tiles (Module B3)
 */

import { useCallback, useRef } from 'react';

interface TileEffectsOptions {
  enabled?: boolean;
  maxRotation?: number; // default 4 degrees
}

export function useTileEffects(options: TileEffectsOptions = {}) {
  const { enabled = true, maxRotation = 4 } = options;
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;  // 0 to 1
    const y = (e.clientY - rect.top) / rect.height;   // 0 to 1
    const rotateX = (0.5 - y) * maxRotation * 2; // ±maxRotation degrees
    const rotateY = (x - 0.5) * maxRotation * 2;
    containerRef.current.style.setProperty('--rotateX', `${rotateX}deg`);
    containerRef.current.style.setProperty('--rotateY', `${rotateY}deg`);
  }, [enabled, maxRotation]);

  const handleMouseLeave = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.style.setProperty('--rotateX', '0deg');
    containerRef.current.style.setProperty('--rotateY', '0deg');
  }, []);

  return { containerRef, handleMouseMove, handleMouseLeave };
}
