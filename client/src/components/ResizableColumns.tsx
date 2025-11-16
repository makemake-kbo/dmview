import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type ResizableColumnsProps = {
  left: ReactNode;
  right: ReactNode;
  initialRatio?: number;
  minLeft?: number;
  minRight?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ResizableColumns = ({
  left,
  right,
  initialRatio = 0.65,
  minLeft = 0.35,
  minRight = 0.2,
}: ResizableColumnsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setRatio(initialRatio);
  }, [initialRatio]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const relative = (event.clientX - rect.left) / rect.width;
      const min = minLeft;
      const max = 1 - minRight;
      setRatio(clamp(relative, min, max));
    };

    const handleUp = () => setDragging(false);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, minLeft, minRight]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
  };

  return (
    <div className="resizable-columns" ref={containerRef}>
      <div className="resizable-columns__pane left" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </div>
      <button
        type="button"
        className={`resizable-columns__handle ${dragging ? 'dragging' : ''}`}
        aria-label="Resize panels"
        onPointerDown={handlePointerDown}
      />
      <div className="resizable-columns__pane right" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
        {right}
      </div>
    </div>
  );
};

export default ResizableColumns;
