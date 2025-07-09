import React, { useState, useEffect } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export const FursonaScene = ({ imageUrl, audioUrl, text, wordTimingsUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  // State for word timings
  const [wordTimings, setWordTimings] = useState(null);
  
  // Fetch word timings from R2 URL
  useEffect(() => {
    if (wordTimingsUrl) {
      fetch(wordTimingsUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => setWordTimings(data))
        .catch(error => {
          console.warn('Failed to fetch word timings:', error);
          setWordTimings(null);
        });
    }
  }, [wordTimingsUrl]);

  // Fade in the image
  const imageOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Slide text up from bottom with spring animation
  const textAnimation = spring({
    frame: frame - 15, // Delay text animation by 0.5 seconds
    fps,
    config: {
      damping: 100,
      stiffness: 200,
      mass: 0.5,
    },
  });

  const textY = interpolate(textAnimation, [0, 1], [100, 0]);
  const textOpacity = interpolate(frame, [15, 45], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Background Image or Black Background */}
      {imageUrl ? (
        <>
          <AbsoluteFill>
            <Img
              src={imageUrl}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: imageOpacity,
              }}
            />
          </AbsoluteFill>
          {/* Dark gradient overlay for better text readability */}
          <AbsoluteFill
            style={{
              background: 'linear-gradient(to bottom, transparent 0%, transparent 50%, rgba(0,0,0,0.8) 100%)',
            }}
          />
        </>
      ) : (
        /* Plain black background when no image */
        <AbsoluteFill style={{ backgroundColor: '#000' }} />
      )}

      {/* Text Overlay */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '0 60px 120px 60px',
        }}
      >
        <div
          style={{
            transform: `translateY(${textY}px)`,
            opacity: textOpacity,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '40px',
            borderRadius: '20px',
            backdropFilter: 'blur(10px)',
            maxWidth: '90%',
          }}
        >
          <div
            style={{
              color: 'white',
              fontSize: '48px',
              fontFamily: 'SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif',
              fontWeight: 'bold',
              textAlign: 'center',
              lineHeight: 1.4,
              margin: 0,
              textShadow: '0 2px 10px rgba(0,0,0,0.5)',
            }}
          >
            {text.split(' ').map((word, index) => {
              // Use word timings if available, otherwise fall back to fixed timing
              let wordStartFrame, wordEndFrame;
              
              if (wordTimings && wordTimings[index]) {
                wordStartFrame = wordTimings[index].startFrame;
                wordEndFrame = wordTimings[index].endFrame;
                
                // Ensure frames are valid and monotonic
                if (wordStartFrame >= wordEndFrame) {
                  wordEndFrame = wordStartFrame + 6; // Minimum 6 frame duration
                }
              } else {
                // Fallback to fixed timing
                wordStartFrame = 45 + (index * 6);
                wordEndFrame = wordStartFrame + 12;
              }
              
              // Ensure all timing calculations have valid, monotonic ranges
              const fadeInStart = Math.max(0, wordStartFrame - 3);
              const fadeInEnd = wordStartFrame;
              const scaleStart = Math.max(0, wordStartFrame - 3);
              const scaleEnd = wordStartFrame + 3;
              const highlightStart = wordStartFrame;
              const highlightPeak = wordStartFrame + 6;
              const highlightEnd = Math.max(highlightPeak + 1, wordEndFrame);
              
              // Word opacity (appears slightly before highlight)
              const wordOpacity = fadeInStart < fadeInEnd ? interpolate(
                frame,
                [fadeInStart, fadeInEnd],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              ) : (frame >= fadeInEnd ? 1 : 0);
              
              // Word scale (subtle pop-in effect)
              const wordScale = scaleStart < scaleEnd ? interpolate(
                frame,
                [scaleStart, scaleEnd],
                [0.8, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              ) : (frame >= scaleEnd ? 1 : 0.8);
              
              // Highlight effect (yellow background that fades)
              const highlightOpacity = highlightStart < highlightPeak && highlightPeak < highlightEnd ? interpolate(
                frame,
                [highlightStart, highlightPeak, highlightEnd],
                [0, 1, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              ) : 0;
              
              return (
                <span
                  key={index}
                  style={{
                    display: 'inline-block',
                    opacity: wordOpacity,
                    transform: `scale(${wordScale})`,
                    marginRight: '12px',
                    position: 'relative',
                  }}
                >
                  {/* Highlight background */}
                  <span
                    style={{
                      position: 'absolute',
                      top: '0',
                      left: '-4px',
                      right: '-4px',
                      bottom: '0',
                      backgroundColor: '#FFD700',
                      opacity: highlightOpacity,
                      borderRadius: '6px',
                      zIndex: -1,
                    }}
                  />
                  {/* Word text */}
                  <span style={{ position: 'relative', zIndex: 1 }}>
                    {word}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>

      {/* Audio */}
      {audioUrl && (
        <Audio 
          src={audioUrl} 
          startFrom={0}
          endAt={useVideoConfig().durationInFrames}
          volume={1.0}
        />
      )}
    </AbsoluteFill>
  );
};