import { useEffect, useState } from 'react';

export interface LoadedImage {
  image: HTMLImageElement | null;
  loading: boolean;
  error: string | null;
}

export function useSourceImage(dataUrl: string | null): LoadedImage {
  const [state, setState] = useState<LoadedImage>({ image: null, loading: false, error: null });

  useEffect(() => {
    if (!dataUrl) {
      setState({ image: null, loading: false, error: null });
      return;
    }
    let active = true;
    const image = new Image();
    image.decoding = 'async';
    setState((previous) => ({ image: previous.image, loading: true, error: null }));
    image.onload = () => {
      if (!active) return;
      setState({ image, loading: false, error: null });
    };
    image.onerror = () => {
      if (!active) return;
      setState({ image: null, loading: false, error: 'The photo preview could not be decoded.' });
    };
    image.src = dataUrl;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [dataUrl]);

  return state;
}
