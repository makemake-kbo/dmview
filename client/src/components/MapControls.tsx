
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface MapControlsProps {
  currentUrl?: string | null;
  onSetUrl(url: string): Promise<void> | void;
  onUpload(file: File): Promise<void> | void;
}

const MapControls = ({ currentUrl, onSetUrl, onUpload }: MapControlsProps) => {
  const [url, setUrl] = useState(currentUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(currentUrl ?? '');
  }, [currentUrl]);

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
    setUploading(true);
    setError(null);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

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
      <label className="upload">
        <span>Upload image</span>
        <input type="file" accept="image/*" disabled={uploading} onChange={handleUpload} />
      </label>
      {uploading && <p className="muted">Uploading…</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
};

export default MapControls;
