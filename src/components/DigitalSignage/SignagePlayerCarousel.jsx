// Full-screen digital signage carousel: images + videos, auto-advance.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolvePlaybackUrl, revokeBlobUrl } from '../../utils/signageOfflineCache';



function shuffleCopy(array) {

  const a = [...array];

  for (let i = a.length - 1; i > 0; i -= 1) {

    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j], a[i]];

  }

  return a;

}



/**

 * @param {{ id: string, contentId: string, name: string, type: string, url: string, durationSeconds: number, mimeType?: string }[]} items

 * @param {number} defaultSlideSeconds

 * @param {boolean} shuffle

 */

const SignagePlayerCarousel = ({ items, defaultSlideSeconds = 8, fillMode = 'contain', shuffle = false }) => {

  const sourceItems = Array.isArray(items) ? items : [];

  const itemsKey = useMemo(

    () => sourceItems.map((item) => item.contentId).join(','),

    [sourceItems]

  );



  const [playOrder, setPlayOrder] = useState([]);

  const [index, setIndex] = useState(0);

  const [playbackUrl, setPlaybackUrl] = useState(null);
  const [videoStarted, setVideoStarted] = useState(false);

  const blobRef = useRef(null);

  const videoRef = useRef(null);

  const sourceItemsRef = useRef(sourceItems);



  useEffect(() => {

    sourceItemsRef.current = sourceItems;

  }, [sourceItems]);



  useEffect(() => {

    if (sourceItems.length === 0) {

      setPlayOrder([]);

      setIndex(0);

      return;

    }

    setPlayOrder(shuffle ? shuffleCopy(sourceItems) : sourceItems);

    setIndex(0);

  }, [itemsKey, shuffle]);



  const safeLen = playOrder.length;

  const current = safeLen > 0 ? playOrder[index] : null;

  const isVideo = current?.type === 'video';
  const isHtml = current?.type === 'html';



  useEffect(() => {

    if (safeLen <= 0) return;

    setIndex((i) => ((i % safeLen) + safeLen) % safeLen);

  }, [safeLen]);



  useEffect(() => {

    let cancelled = false;
    setVideoStarted(false);



    (async () => {

      if (blobRef.current) {

        revokeBlobUrl(blobRef.current);

        blobRef.current = null;

      }

      if (!current) {

        setPlaybackUrl(null);

        return;

      }

      const url = await resolvePlaybackUrl(current);

      if (!cancelled) {

        if (url?.startsWith('blob:')) blobRef.current = url;

        setPlaybackUrl(url);

      }

    })();



    return () => {

      cancelled = true;

    };

  }, [current?.contentId, current?.url]);



  useEffect(() => {

    return () => {

      if (blobRef.current) revokeBlobUrl(blobRef.current);

    };

  }, []);



  const advance = useCallback(() => {

    if (safeLen <= 1) return;

    setIndex((i) => {

      const next = i + 1;

      if (next >= safeLen) {

        if (shuffle && sourceItemsRef.current.length > 1) {

          setPlayOrder(shuffleCopy(sourceItemsRef.current));

        }

        return 0;

      }

      return next;

    });

  }, [safeLen, shuffle]);



  useEffect(() => {

    if (safeLen <= 1 || isVideo) return;

    const seconds = Math.max(3, current?.durationSeconds || defaultSlideSeconds);

    const id = setInterval(advance, seconds * 1000);

    return () => clearInterval(id);

  }, [safeLen, isVideo, current?.durationSeconds, defaultSlideSeconds, index, advance]);

  useEffect(() => {
    if (!current || !isVideo || videoStarted) return undefined;
    const id = setTimeout(advance, 20000);
    return () => clearTimeout(id);
  }, [current?.contentId, isVideo, videoStarted, advance]);



  const onVideoEnded = useCallback(() => {

    advance();

  }, [advance]);



  if (!safeLen || !current) return null;



  const objectFit =

    fillMode === 'fill' ? 'fill' : fillMode === 'cover' ? 'cover' : 'contain';



  if (isVideo && playbackUrl) {

    return (

      <div style={styles.frame}>

        <video

          ref={videoRef}

          key={current.contentId}

          src={playbackUrl}

          style={{ ...styles.media, objectFit }}

          autoPlay

          muted

          playsInline

          onCanPlay={() => setVideoStarted(true)}

          onPlaying={() => setVideoStarted(true)}

          onEnded={onVideoEnded}

          onError={advance}

        />

      </div>

    );

  }

  if (isHtml && playbackUrl) {
    return (
      <div style={styles.frame}>
        <iframe
          key={current.contentId}
          src={playbackUrl}
          title={current.name || 'Signage HTML content'}
          style={styles.iframe}
          sandbox="allow-scripts allow-same-origin"
          onError={advance}
        />
      </div>
    );
  }



  if (playbackUrl) {

    return (

      <div style={styles.frame}>

        <img

          key={current.contentId}

          src={playbackUrl}

          alt={current.name || 'Signage content'}

          style={{ ...styles.media, objectFit }}

          draggable={false}

          onError={advance}

        />

      </div>

    );

  }



  return (

    <div style={styles.frame}>

      <div style={styles.loading}>

        Loading…

      </div>

    </div>

  );

};



const styles = {

  frame: {

    width: '100%',

    height: '100%',

    display: 'flex',

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor: '#000',

    overflow: 'hidden'

  },

  media: {

    width: '100%',

    height: '100%',

    display: 'block',

    backgroundColor: '#000'

  },

  iframe: {

    width: '100%',

    height: '100%',

    border: 'none',

    backgroundColor: '#000'

  },

  loading: {

    color: '#888',

    fontSize: '1.1rem'

  }

};



export default SignagePlayerCarousel;

