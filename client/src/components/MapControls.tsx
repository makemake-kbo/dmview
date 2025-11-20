
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface MapControlsProps {
  currentUrl?: string | null;
  onSetUrl(url: string): Promise<void> | void;
  onUpload(file: File): Promise<void> | void;
}

const findImageFile = (
  files?: FileList | null,
  items?: DataTransferItemList | null,
): File | null => {
  if (files && files.length) {
    const match = Array.from(files).find((file) => file.type.startsWith('image/'));
    if (match) return match;
  }
  if (items && items.length) {
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  return null;
};

const MapControls = ({ currentUrl, onSetUrl, onUpload }: MapControlsProps) => {
  const [url, setUrl] = useState(currentUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);

  useEffect(() => {
    setUrl(currentUrl ?? '');
  }, [currentUrl]);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        await onUpload(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [onUpload],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    try {
      await onSetUrl(url.trim());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingFile(false);
    const file = findImageFile(event.dataTransfer?.files, event.dataTransfer?.items);
    if (file) {
      void uploadFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const hasFiles = event.dataTransfer?.types ? event.dataTransfer.types.contains('Files') : false;
    if (hasFiles) {
      event.preventDefault();
      setDraggingFile(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setDraggingFile(false);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const file = findImageFile(event.clipboardData?.files, event.clipboardData?.items);
    if (file) {
      event.preventDefault();
      void uploadFile(file);
    }
  };

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      const file = findImageFile(event.clipboardData?.files, event.clipboardData?.items);
      if (!file) return;
      event.preventDefault();
      void uploadFile(file);
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => {
      window.removeEventListener('paste', handleWindowPaste);
    };
  }, [uploadFile]);

  return (
    <section className="panel">
      <h2>Battle map</h2>
      <form className="map-url-form" onSubmit={handleSubmit}>
        <label>
          Remote image URL
          <input
            type="url"
            placeholder="https://example.com/map.png"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button type="submit">Load URL</button>
      </form>
      <div className="divider" aria-hidden />
      <div
        className={`drop-target ${draggingFile ? 'active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <label className="upload">
          <span>Upload image</span>
          <input type="file" accept="image/*" disabled={uploading} onChange={handleUpload} />
        </label>
        <p className="muted small">…or drag, drop, and paste images straight into this window.</p>
      </div>
      {uploading && <p className="muted">Uploading…</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
};

export default MapControls;
