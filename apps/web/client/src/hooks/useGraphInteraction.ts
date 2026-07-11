import { useCallback, useRef, useState, useEffect } from "react";

type Position = { x: number; y: number };

interface DragState {
  isDragging: boolean;
  startPos: Position;
  currentPos: Position;
  nodeId: string | null;
  initialNodePos: Position;
}

interface PanState {
  isPanning: boolean;
  startPos: Position;
  offset: Position;
  velocity: Position;
  lastTime: number;
}

const ZOOM_DAMPING = 0.15; // Smoothness: 0.08-0.2 (lower = smoother but slower)
const PAN_FRICTION = 0.92; // Momentum decay: 0.9-0.98 (higher = longer inertia)
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

// Easing function for smooth zoom transitions (ease-out-cubic)
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useGraphInteraction(
  onNodeMove: (nodeId: string, pos: Position) => void
) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startPos: { x: 0, y: 0 },
    currentPos: { x: 0, y: 0 },
    nodeId: null,
    initialNodePos: { x: 0, y: 0 },
  });

  const [panState, setPanState] = useState<PanState>({
    isPanning: false,
    startPos: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    lastTime: 0,
  });

  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const lastPanRef = useRef<Position>({ x: 0, y: 0 });
  const zoomVelocityRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const panMomentumRef = useRef<Position>({ x: 0, y: 0 });

  // Get mouse position relative to SVG
  const getMousePos = useCallback(
    (e: MouseEvent | React.MouseEvent): Position => {
      if (!svgRef.current) return { x: 0, y: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / (svgRef.current.clientWidth / 460), // Assuming SVG viewBox="0 0 460 240"
        y: (e.clientY - rect.top) / (svgRef.current.clientHeight / 240),
      };
    },
    []
  );

  // Node drag start
  const startNodeDrag = useCallback(
    (nodeId: string, pos: Position, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mousePos = getMousePos(e.nativeEvent);
      setDragState({
        isDragging: true,
        startPos: mousePos,
        currentPos: mousePos,
        nodeId,
        initialNodePos: pos,
      });
    },
    [getMousePos]
  );

  // Node drag move
  const handleNodeDragMove = useCallback(
    (e: MouseEvent) => {
      if (!dragState.isDragging || !dragState.nodeId) return;

      const mousePos = getMousePos(e);
      const deltaX = mousePos.x - dragState.startPos.x;
      const deltaY = mousePos.y - dragState.startPos.y;

      const newPos = {
        x: dragState.initialNodePos.x + deltaX,
        y: dragState.initialNodePos.y + deltaY,
      };

      setDragState((prev) => ({
        ...prev,
        currentPos: mousePos,
      }));

      onNodeMove(dragState.nodeId, newPos);
    },
    [dragState, getMousePos, onNodeMove]
  );

  // Node drag end
  const endNodeDrag = useCallback(() => {
    setDragState({
      isDragging: false,
      startPos: { x: 0, y: 0 },
      currentPos: { x: 0, y: 0 },
      nodeId: null,
      initialNodePos: { x: 0, y: 0 },
    });
  }, []);

  // Canvas pan start (spacebar + drag or middle mouse)
  const startCanvasPan = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 1 && !e.nativeEvent.getModifierState("Space")) return;
      e.preventDefault();
      panMomentumRef.current = { x: 0, y: 0 };
      const mousePos = getMousePos(e.nativeEvent);
      setPanState({
        isPanning: true,
        startPos: mousePos,
        offset: lastPanRef.current,
        velocity: { x: 0, y: 0 },
        lastTime: Date.now(),
      });
    },
    [getMousePos]
  );

  // Canvas pan move
  const handleCanvasPanMove = useCallback(
    (e: MouseEvent) => {
      if (!panState.isPanning) return;

      const mousePos = getMousePos(e);
      const now = Date.now();
      const dt = (now - panState.lastTime) / 1000; // Delta time in seconds

      const deltaX = mousePos.x - panState.startPos.x;
      const deltaY = mousePos.y - panState.startPos.y;

      const newOffset = {
        x: panState.offset.x + deltaX,
        y: panState.offset.y + deltaY,
      };

      // Calculate velocity for momentum
      const velocity = dt > 0 ? { x: deltaX / dt, y: deltaY / dt } : { x: 0, y: 0 };

      lastPanRef.current = newOffset;
      panMomentumRef.current = velocity;

      setPanState((prev) => ({
        ...prev,
        offset: newOffset,
        velocity,
        lastTime: now,
      }));
    },
    [panState, getMousePos]
  );

  // Apply momentum after pan ends
  const applyPanMomentum = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const animate = () => {
      const velocity = panMomentumRef.current;
      if (Math.abs(velocity.x) < 0.1 && Math.abs(velocity.y) < 0.1) {
        return;
      }

      // Apply friction
      panMomentumRef.current = {
        x: velocity.x * PAN_FRICTION,
        y: velocity.y * PAN_FRICTION,
      };

      lastPanRef.current = {
        x: lastPanRef.current.x + panMomentumRef.current.x,
        y: lastPanRef.current.y + panMomentumRef.current.y,
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, []);

  // Canvas pan end
  const endCanvasPan = useCallback(() => {
    setPanState({
      isPanning: false,
      startPos: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      lastTime: 0,
    });
    applyPanMomentum();
  }, [applyPanMomentum]);

  // Canvas zoom (mouse wheel) - smooth with damping
  const handleZoom = useCallback(
    (e: WheelEvent, onZoom: (newZoom: number) => void) => {
      e.preventDefault();

      // Normalize wheel delta (different browsers report different scales)
      const rawDelta = e.deltaY || e.deltaX || 0;
      const normalizedDelta = rawDelta > 0 ? -0.08 : 0.08;

      // Apply damping for smooth easing
      zoomVelocityRef.current = normalizedDelta;

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      const animateZoom = () => {
        setZoom((prevZoom) => {
          // Apply easing to velocity
          zoomVelocityRef.current *= (1 - ZOOM_DAMPING);

          if (Math.abs(zoomVelocityRef.current) < 0.001) {
            return prevZoom;
          }

          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom + zoomVelocityRef.current));
          onZoom(newZoom);
          return newZoom;
        });

        if (Math.abs(zoomVelocityRef.current) >= 0.001) {
          animationFrameRef.current = requestAnimationFrame(animateZoom);
        }
      };

      animationFrameRef.current = requestAnimationFrame(animateZoom);
    },
    []
  );

  // Cleanup animation frames on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    svgRef,
    dragState,
    panState,
    zoom,
    panOffset: lastPanRef.current,
    startNodeDrag,
    handleNodeDragMove,
    endNodeDrag,
    startCanvasPan,
    handleCanvasPanMove,
    endCanvasPan,
    handleZoom,
  };
}
