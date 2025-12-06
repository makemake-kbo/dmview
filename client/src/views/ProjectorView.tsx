import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { applyHomography, computeHomography, ensureWarp, invertHomography } from '../lib/homography';
import { ensureMapView, normalizeMapView } from '../lib/mapView';
import type { Mat3 } from '../lib/homography';
import type { MapView, Stroke, Token, WarpPoint } from '../types';

const TokenOutlineColors: Record<Token['kind'], string> = {
  pc: '#38bdf8',
  enemy: '#ef4444',
  npc: '#22c55e',
  prop: '#cbd5e1',
};
const getTokenOutlineColor = (token: Token) => TokenOutlineColors[token.kind];

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_position;
  void main() {
    v_position = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision mediump float;
  varying vec2 v_position;
  uniform sampler2D u_texture;
  uniform mat3 u_inverseHomography;
   uniform vec2 u_viewCenter;
   uniform float u_viewZoom;
   uniform float u_viewRotation;
  void main() {
    vec2 ndc = (v_position + 1.0) * 0.5;
    vec3 dest = vec3(ndc, 1.0);
    vec3 src = u_inverseHomography * dest;
    vec2 uv = src.xy / src.z;
    float rad = radians(u_viewRotation);
    float cosR = cos(-rad);
    float sinR = sin(-rad);
    mat2 rot = mat2(cosR, -sinR, sinR, cosR);
    uv = (rot * (uv - u_viewCenter)) / u_viewZoom + u_viewCenter;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      discard;
    }
    gl_FragColor = texture2D(u_texture, uv);
  }
`;

type GLBundle = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  attributes: { position: number };
  uniforms: {
    inverse: WebGLUniformLocation | null;
    texture: WebGLUniformLocation | null;
    viewCenter: WebGLUniformLocation | null;
    viewZoom: WebGLUniformLocation | null;
    viewRotation: WebGLUniformLocation | null;
  };
};

const applyInverseView = (view: MapView, point: { x: number; y: number }) => {
  const angle = (view.rotation * Math.PI) / 180;
  const cosR = Math.cos(angle);
  const sinR = Math.sin(angle);
  const dx = point.x - view.center.x;
  const dy = point.y - view.center.y;
  return {
    x: dx * view.zoom * cosR - dy * view.zoom * sinR + view.center.x,
    y: dx * view.zoom * sinR + dy * view.zoom * cosR + view.center.y,
  };
};

const toProjectionSpace = (point: WarpPoint): WarpPoint => ({ x: point.x, y: 1 - point.y });
const fromProjectionSpace = (point: WarpPoint): WarpPoint => ({ x: point.x, y: 1 - point.y });

const ProjectorView = () => {
  const { sessionId = '' } = useParams();
  const { session, status, connectionState, error } = useSession(sessionId);

  if (!sessionId) {
    return (
      <main className="screen center">
        <p>No session id</p>
        <Link to="/">Back home</Link>
      </main>
    );
  }

  if (status === 'loading' || !session) {
    return (
      <main className="screen center">
        <p>Loading projector…</p>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="screen center">
        <p>Unable to load session.</p>
        {error && <p className="error">{error}</p>}
        <Link to="/">Back home</Link>
      </main>
    );
  }

  return (
    <ProjectionSurface
      mapUrl={session.map.image_url}
      warpCorners={ensureWarp(session.map.warp).corners}
      mapView={session.map.view}
      tokens={session.tokens}
      strokes={session.map.strokes}
      sessionId={session.id}
      connectionState={connectionState}
    />
  );
};

const ProjectionSurface = ({
  mapUrl,
  warpCorners,
  mapView,
  tokens,
  sessionId,
  connectionState,
  strokes,
}: {
  mapUrl?: string | null;
  warpCorners: { x: number; y: number }[];
  mapView?: MapView | null;
  tokens: Token[];
  sessionId: string;
  connectionState: string;
  strokes?: Stroke[] | null;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [glBundle, setGlBundle] = useState<GLBundle | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const [error, setError] = useState<string | null>(null);

  const homography = useMemo(() => computeHomography(warpCorners), [warpCorners]);
  const inverseHomography = useMemo(() => invertHomography(homography), [homography]);
  const visibleTokens = useMemo(() => tokens.filter((token) => token.visible), [tokens]);
  const view = useMemo(() => normalizeMapView(ensureMapView(mapView)), [mapView]);
  const projectedStrokes = useMemo(() => {
    if (!strokes) return [];
    return strokes
      .map((stroke) => {
        const points = stroke.points
          .map((point) => {
            const viewSpace = applyInverseView(view, toProjectionSpace(point));
            const projected = fromProjectionSpace(applyHomography(homography, viewSpace));
            return projected;
          })
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        return { ...stroke, points };
      })
      .filter((stroke) => stroke.points.length > 0);
  }, [strokes, view, homography]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl');
    if (!gl) {
      setError('WebGL not supported');
      return;
    }

    const program = createProgram(gl, vertexSource, fragmentSource);
    if (!program) {
      setError('Failed to compile shaders');
      return;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      setError('Unable to create buffer');
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    const inverseLocation = gl.getUniformLocation(program, 'u_inverseHomography');
    const textureLocation = gl.getUniformLocation(program, 'u_texture');
    const viewCenterLocation = gl.getUniformLocation(program, 'u_viewCenter');
    const viewZoomLocation = gl.getUniformLocation(program, 'u_viewZoom');
    const viewRotationLocation = gl.getUniformLocation(program, 'u_viewRotation');
    gl.useProgram(program);
    gl.uniform1i(textureLocation, 0);

    const handleResize = () => {
      if (!canvas) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    setGlBundle({
      gl,
      program,
      buffer,
      attributes: { position: positionLocation },
      uniforms: {
        inverse: inverseLocation,
        texture: textureLocation,
        viewCenter: viewCenterLocation,
        viewZoom: viewZoomLocation,
        viewRotation: viewRotationLocation,
      },
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      if (textureRef.current) {
        gl.deleteTexture(textureRef.current);
      }
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  useEffect(() => {
    if (!glBundle || !mapUrl) return;
    const gl = glBundle.gl;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      const texture = gl.createTexture();
      if (!texture) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      if (textureRef.current) {
        gl.deleteTexture(textureRef.current);
      }
      textureRef.current = texture;
      drawScene(glBundle, inverseHomography, textureRef.current, view);
    };
    image.onerror = () => setError('Failed to load map image');
    image.src = mapUrl;
    return () => {
      cancelled = true;
    };
  }, [glBundle, mapUrl, inverseHomography, view]);

  useEffect(() => {
    if (!glBundle || !textureRef.current) return;
    drawScene(glBundle, inverseHomography, textureRef.current, view);
  }, [glBundle, inverseHomography, warpCorners, mapUrl, view]);

  if (!mapUrl) {
    return (
      <main className="projector waiting">
        <p>No map yet. Waiting for DM…</p>
      </main>
    );
  }

  return (
    <main className="projector">
      <canvas ref={canvasRef} className="projection" />
      {projectedStrokes.length > 0 && (
        <div className="stroke-overlay" aria-hidden>
          <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            {projectedStrokes.map((stroke) =>
              stroke.points.length === 1 ? (
                <circle
                  key={stroke.id}
                  cx={stroke.points[0].x}
                  cy={stroke.points[0].y}
                  r={stroke.width / 2}
                  fill={stroke.color}
                />
              ) : (
                <polyline
                  key={stroke.id}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
                />
              ),
            )}
          </svg>
        </div>
      )}
      <div className="token-overlay">
        {visibleTokens.map((token) => {
          const glToken = toProjectionSpace({ x: token.x, y: token.y });
          const preWarp = applyInverseView(view, glToken);
          if (preWarp.x < 0 || preWarp.x > 1 || preWarp.y < 0 || preWarp.y > 1) {
            return null;
          }
          const projected = fromProjectionSpace(applyHomography(homography, preWarp));
          if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
            return null;
          }
          const showHp =
            token.kind !== 'npc' &&
            token.stats?.hp !== undefined &&
            token.stats?.max_hp !== undefined;
          const outline = getTokenOutlineColor(token);
          return (
            <div
              key={token.id}
              className="projector-token"
              style={{
                left: `${projected.x * 100}%`,
                top: `${projected.y * 100}%`,
                borderColor: outline,
              }}
            >
              <span>{token.name}</span>
              {showHp && (
                <small>
                  {token.stats.hp}/{token.stats.max_hp}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <div className="projector-meta">
        <span>{sessionId}</span>
        <span>{connectionState}</span>
        {error && <span className="error">{error}</span>}
      </div>
    </main>
  );
};

const createProgram = (gl: WebGLRenderingContext, vertex: string, fragment: string) => {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  return program;
};

const compileShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const drawScene = (glBundle: GLBundle, inverse: Mat3, texture: WebGLTexture | null, view: MapView) => {
  const { gl, uniforms } = glBundle;
  if (!texture || !uniforms.inverse) return;
  gl.useProgram(glBundle.program);
  gl.uniformMatrix3fv(uniforms.inverse, false, new Float32Array(inverse));
  if (uniforms.viewCenter) {
    gl.uniform2f(uniforms.viewCenter, view.center.x, view.center.y);
  }
  if (uniforms.viewZoom) {
    gl.uniform1f(uniforms.viewZoom, view.zoom);
  }
  if (uniforms.viewRotation) {
    gl.uniform1f(uniforms.viewRotation, view.rotation);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

export default ProjectorView;
